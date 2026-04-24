BEGIN;

CREATE TABLE IF NOT EXISTS public.rep_scoring_telemetry (
  id                    bigserial PRIMARY KEY,
  org_id                bigint NOT NULL,
  rep_id                bigint NOT NULL,
  opportunity_id        uuid NOT NULL,
  category              text NOT NULL,
  session_score         integer NOT NULL,
  evidence_strength     text,
  forecast_stage        text NOT NULL,
  prior_forecast_stage  text,
  trigger_event         text NOT NULL,
  outcome               text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rst_category_chk
    CHECK (length(trim(category)) > 0),
  CONSTRAINT rst_score_chk
    CHECK (session_score BETWEEN 0 AND 3),
  CONSTRAINT rst_trigger_chk
    CHECK (trigger_event IN (
      'stage_regression',
      'closed_won',
      'closed_lost'
    ))
);

CREATE INDEX IF NOT EXISTS idx_rst_org_rep
  ON public.rep_scoring_telemetry (org_id, rep_id, category);

CREATE INDEX IF NOT EXISTS idx_rst_org_outcome
  ON public.rep_scoring_telemetry (org_id, outcome, created_at);

CREATE OR REPLACE FUNCTION public.forecast_stage_rank(
  p_stage text
) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(p_stage))
    WHEN 'pipeline'    THEN 1
    WHEN 'best case'   THEN 2
    WHEN 'best_case'   THEN 2
    WHEN 'bestcase'    THEN 2
    WHEN 'commit'      THEN 3
    WHEN 'closed'      THEN 4
    WHEN 'closed won'  THEN 4
    WHEN 'closed_won'  THEN 4
    WHEN 'closed lost' THEN 4
    WHEN 'closed_lost' THEN 4
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.capture_rep_scoring_telemetry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_trigger_event text;
  v_outcome       text;
  v_old_rank      integer;
  v_new_rank      integer;
  v_categories    text[] := ARRAY[
    'pain','metrics','champion','economic_buyer',
    'criteria','process','competition','paper',
    'timing','budget'
  ];
  v_cat           text;
  v_prefix        text;
  v_score         integer;
  v_evidence      text;
BEGIN
  IF OLD.forecast_stage IS NOT DISTINCT FROM NEW.forecast_stage THEN
    RETURN NEW;
  END IF;

  v_old_rank := public.forecast_stage_rank(OLD.forecast_stage);
  v_new_rank := public.forecast_stage_rank(NEW.forecast_stage);

  IF lower(trim(NEW.forecast_stage)) IN (
    'closed','closed won','closed_won'
  ) THEN
    v_trigger_event := 'closed_won';
    v_outcome := 'won';
  ELSIF lower(trim(NEW.forecast_stage)) IN (
    'closed lost','closed_lost'
  ) THEN
    v_trigger_event := 'closed_lost';
    v_outcome := 'lost';
  ELSIF v_new_rank < v_old_rank AND v_old_rank > 0 THEN
    v_trigger_event := 'stage_regression';
    v_outcome := NULL;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.rep_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_cat IN ARRAY v_categories LOOP
    v_prefix := CASE
      WHEN v_cat = 'economic_buyer' THEN 'eb'
      ELSE v_cat
    END;

    EXECUTE format(
      'SELECT ($1).%I_score, ($1).%I_evidence_strength',
      v_prefix, v_prefix
    ) INTO v_score, v_evidence USING NEW;

    IF v_score IS NOT NULL THEN
      INSERT INTO public.rep_scoring_telemetry (
        org_id,
        rep_id,
        opportunity_id,
        category,
        session_score,
        evidence_strength,
        forecast_stage,
        prior_forecast_stage,
        trigger_event,
        outcome
      ) VALUES (
        NEW.org_id,
        NEW.rep_id,
        NEW.public_id,
        v_cat,
        v_score,
        v_evidence,
        NEW.forecast_stage,
        OLD.forecast_stage,
        v_trigger_event,
        v_outcome
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rep_scoring_telemetry
  ON public.opportunities;

CREATE TRIGGER trg_rep_scoring_telemetry
  AFTER UPDATE OF forecast_stage ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_rep_scoring_telemetry();

CREATE OR REPLACE FUNCTION public.get_rep_calibration_profile(
  p_org_id bigint,
  p_rep_id bigint,
  p_min_samples integer DEFAULT 5
)
RETURNS TABLE (
  category          text,
  avg_score         numeric,
  sample_size       bigint,
  regression_count  bigint,
  won_count         bigint,
  lost_count        bigint,
  calibration_note  text
) LANGUAGE sql STABLE AS $$
  SELECT
    rst.category,
    round(AVG(rst.session_score), 2) AS avg_score,
    COUNT(*) AS sample_size,
    COUNT(*) FILTER (WHERE rst.trigger_event = 'stage_regression') AS regression_count,
    COUNT(*) FILTER (WHERE rst.outcome = 'won') AS won_count,
    COUNT(*) FILTER (WHERE rst.outcome = 'lost') AS lost_count,
    CASE
      WHEN COUNT(*) < p_min_samples
        THEN 'insufficient_data'
      WHEN COUNT(*) FILTER (WHERE rst.trigger_event = 'stage_regression') > COUNT(*) * 0.4
        THEN 'frequently_overstates'
      WHEN AVG(rst.session_score) > 2.5
           AND COUNT(*) FILTER (WHERE rst.outcome = 'won') < COUNT(*) * 0.3
        THEN 'scores_high_low_close_rate'
      ELSE 'calibrated'
    END AS calibration_note
  FROM public.rep_scoring_telemetry rst
  WHERE rst.org_id = p_org_id
    AND rst.rep_id = p_rep_id
  GROUP BY rst.category
  ORDER BY rst.category;
$$;

COMMIT;
