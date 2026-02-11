-- Fix ingestion pipeline functions.
-- Replaces broken DB-side functions that can throw:
--   column reference "mapping_set_id" is ambiguous
--
-- Functions expected by /api/db-check:
-- - normalize_row(jsonb,bigint)
-- - validate_row(jsonb,integer)
-- - upsert_opportunity(jsonb,integer)
-- - process_ingestion_batch(integer,bigint)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------
-- Helpers
-- ----------------------------

CREATE OR REPLACE FUNCTION try_parse_date_from_any(v jsonb)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  n double precision;
  d date;
BEGIN
  IF v IS NULL OR v = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(v) = 'number' THEN
    n := (v::text)::double precision;
    -- Excel serial date (days since 1899-12-30)
    IF n >= 20000 AND n <= 90000 THEN
      RETURN (date '1899-12-30' + (n::int));
    END IF;
    -- Epoch seconds / ms aren't valid DATE directly; ignore here.
    RETURN NULL;
  END IF;

  s := NULLIF(BTRIM(v #>> '{}'), '');
  IF s IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    d := s::date;
    RETURN d;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION try_parse_numeric_from_any(v jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  cleaned text;
  n numeric;
BEGIN
  IF v IS NULL OR v = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(v) = 'number' THEN
    BEGIN
      RETURN (v::text)::numeric;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
  END IF;

  s := NULLIF(BTRIM(v #>> '{}'), '');
  IF s IS NULL THEN
    RETURN NULL;
  END IF;

  -- Strip $ and commas before casting.
  cleaned := BTRIM(replace(replace(s, '$', ''), ',', ''));
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- Reject partial parses (e.g. "123abc")
  IF cleaned !~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
    RETURN NULL;
  END IF;

  BEGIN
    n := cleaned::numeric;
    RETURN n;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

-- ----------------------------
-- normalize_row(p_row, p_org_id) -> normalized jsonb
-- ----------------------------

CREATE OR REPLACE FUNCTION normalize_row(p_row jsonb, p_org_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  out jsonb := '{}'::jsonb;
  r record;
  tgt text;
  val jsonb;
BEGIN
  FOR r IN
    SELECT fm.source_field, fm.target_field
      FROM field_mappings fm
     WHERE fm.mapping_set_id = p_org_id
     ORDER BY fm.id ASC
  LOOP
    tgt := BTRIM(COALESCE(r.target_field, ''));
    IF tgt = '' THEN
      CONTINUE;
    END IF;
    -- Back-compat: "stage" is now "sales_stage".
    IF tgt = 'stage' THEN
      tgt := 'sales_stage';
    END IF;

    -- Preserve the original raw value type (number/string/date-ish).
    val := NULL;
    IF p_row IS NOT NULL THEN
      val := p_row -> r.source_field;
    END IF;

    out := jsonb_set(out, ARRAY[tgt], COALESCE(val, 'null'::jsonb), true);
  END LOOP;

  RETURN out;
END;
$$;

-- ----------------------------
-- validate_row(normalized_row, org_id) -> error text or NULL
-- ----------------------------

CREATE OR REPLACE FUNCTION validate_row(p_row jsonb, p_org_id bigint)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  account_name text;
  opportunity_name text;
  rep_name text;
  crm_opp_id text;
  create_date_raw text;
  amount_val numeric;
  close_date_val date;
  create_ts timestamptz;
BEGIN
  account_name := NULLIF(BTRIM(COALESCE(p_row->>'account_name','')), '');
  IF account_name IS NULL THEN
    RETURN 'Missing required field: account_name';
  END IF;

  opportunity_name := NULLIF(BTRIM(COALESCE(p_row->>'opportunity_name','')), '');
  IF opportunity_name IS NULL THEN
    RETURN 'Missing required field: opportunity_name';
  END IF;

  rep_name := NULLIF(BTRIM(COALESCE(p_row->>'rep_name','')), '');
  IF rep_name IS NULL THEN
    RETURN 'Missing required field: rep_name';
  END IF;

  crm_opp_id := NULLIF(BTRIM(COALESCE(p_row->>'crm_opp_id','')), '');
  IF crm_opp_id IS NULL THEN
    RETURN 'Missing required field: crm_opp_id';
  END IF;

  create_date_raw := NULLIF(BTRIM(COALESCE(p_row->>'create_date_raw','')), '');
  IF create_date_raw IS NULL THEN
    RETURN 'Missing required field: create_date_raw';
  END IF;
  -- use try_parse_timestamptz() if present (from create_date migration)
  BEGIN
    create_ts := try_parse_timestamptz(create_date_raw);
  EXCEPTION WHEN undefined_function THEN
    create_ts := NULL;
  END;
  IF create_ts IS NULL THEN
    RETURN 'Invalid create_date_raw (could not parse timestamp)';
  END IF;

  amount_val := try_parse_numeric_from_any(p_row->'amount');
  IF amount_val IS NULL THEN
    RETURN 'Revenue must be a number.';
  END IF;

  close_date_val := try_parse_date_from_any(p_row->'close_date');
  IF close_date_val IS NULL THEN
    RETURN 'Missing or invalid close_date';
  END IF;

  RETURN NULL;
END;
$$;

-- Back-compat overload (some environments call validate_row(jsonb, integer))
CREATE OR REPLACE FUNCTION validate_row(p_row jsonb, p_org_id integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT validate_row($1, $2::bigint);
$$;

-- ----------------------------
-- upsert_opportunity(normalized_row, org_id) -> opportunity id
-- ----------------------------

CREATE OR REPLACE FUNCTION upsert_opportunity(p_row jsonb, p_org_id bigint)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  -- IMPORTANT: prefix locals with v_ to avoid ambiguity with table columns.
  v_org_id int := p_org_id::int;
  v_crm_opp_id text := NULLIF(BTRIM(COALESCE(p_row->>'crm_opp_id','')), '');
  v_crm_norm text := lower(BTRIM(COALESCE(v_crm_opp_id,'')));
  v_existing_id integer;
  v_amount numeric;
  v_close_date date;
  v_create_date_raw text;
  v_account_name text;
  v_opportunity_name text;
  v_rep_name text;
  v_forecast_stage text;
  v_sales_stage text;
  v_product text;
BEGIN
  IF v_org_id IS NULL OR v_org_id <= 0 THEN
    RAISE EXCEPTION 'upsert_opportunity requires org_id';
  END IF;
  IF v_crm_opp_id IS NULL THEN
    RAISE EXCEPTION 'upsert_opportunity requires crm_opp_id';
  END IF;

  v_amount := try_parse_numeric_from_any(p_row->'amount');
  v_close_date := try_parse_date_from_any(p_row->'close_date');
  v_create_date_raw := NULLIF(BTRIM(COALESCE(p_row->>'create_date_raw','')), '');
  v_account_name := NULLIF(BTRIM(COALESCE(p_row->>'account_name','')), '');
  v_opportunity_name := NULLIF(BTRIM(COALESCE(p_row->>'opportunity_name','')), '');
  v_rep_name := NULLIF(BTRIM(COALESCE(p_row->>'rep_name','')), '');
  v_forecast_stage := NULLIF(BTRIM(COALESCE(p_row->>'forecast_stage','')), '');
  v_sales_stage := NULLIF(BTRIM(COALESCE(p_row->>'sales_stage','')), '');
  v_product := NULLIF(BTRIM(COALESCE(p_row->>'product','')), '');

  -- Update existing (prefer crm_opp_id_norm if present).
  BEGIN
    SELECT o.id
      INTO v_existing_id
      FROM opportunities o
     WHERE o.org_id = v_org_id
       AND o.crm_opp_id_norm = v_crm_norm
     LIMIT 1;
  EXCEPTION WHEN undefined_column THEN
    v_existing_id := NULL;
  END;

  IF v_existing_id IS NOT NULL THEN
    UPDATE opportunities o
       SET account_name = COALESCE(v_account_name, o.account_name),
           opportunity_name = COALESCE(v_opportunity_name, o.opportunity_name),
           rep_name = COALESCE(v_rep_name, o.rep_name),
           forecast_stage = COALESCE(v_forecast_stage, o.forecast_stage),
           sales_stage = COALESCE(v_sales_stage, o.sales_stage),
           product = COALESCE(v_product, o.product),
           amount = COALESCE(v_amount, o.amount),
           close_date = COALESCE(v_close_date, o.close_date),
           create_date_raw = COALESCE(v_create_date_raw, o.create_date_raw),
           crm_opp_id = COALESCE(v_crm_opp_id, o.crm_opp_id),
           crm_opp_id_norm = v_crm_norm,
           updated_at = NOW()
     WHERE o.id = v_existing_id
       AND o.org_id = v_org_id;
    RETURN v_existing_id;
  END IF;

  -- Insert new
  INSERT INTO opportunities (
    org_id,
    account_name,
    opportunity_name,
    rep_name,
    crm_opp_id,
    crm_opp_id_norm,
    amount,
    close_date,
    create_date_raw,
    forecast_stage,
    sales_stage,
    product,
    created_at,
    updated_at
  ) VALUES (
    v_org_id,
    COALESCE(v_account_name, ''),
    COALESCE(v_opportunity_name, ''),
    v_rep_name,
    v_crm_opp_id,
    v_crm_norm,
    v_amount,
    v_close_date,
    v_create_date_raw,
    v_forecast_stage,
    v_sales_stage,
    v_product,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END;
$$;

-- Back-compat overload (some environments call upsert_opportunity(jsonb, integer))
CREATE OR REPLACE FUNCTION upsert_opportunity(p_row jsonb, p_org_id integer)
RETURNS integer
LANGUAGE sql
VOLATILE
AS $$
  SELECT upsert_opportunity($1, $2::bigint);
$$;

-- ----------------------------
-- process_ingestion_batch(org_id, mapping_set_id) -> jsonb summary
-- ----------------------------

CREATE OR REPLACE FUNCTION process_ingestion_batch(p_org_id integer, p_mapping_set_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  s record;
  norm jsonb;
  msg text;
  processed int := 0;
  errored int := 0;
BEGIN
  FOR s IN
    SELECT st.id, st.raw_row
      FROM ingestion_staging st
     WHERE st.organization_id = p_org_id
       AND st.mapping_set_id = p_mapping_set_id
       AND st.normalized_row IS NULL
       AND st.error_message IS NULL
     ORDER BY st.id ASC
  LOOP
    BEGIN
      norm := normalize_row(s.raw_row, p_mapping_set_id);
      msg := validate_row(norm, p_org_id::bigint);
      IF msg IS NOT NULL THEN
        UPDATE ingestion_staging st
           SET normalized_row = norm,
               error_message = msg,
               status = 'error'
         WHERE st.id = s.id;
        errored := errored + 1;
      ELSE
        PERFORM upsert_opportunity(norm, p_org_id::bigint);
        UPDATE ingestion_staging st
           SET normalized_row = norm,
               status = 'processed'
         WHERE st.id = s.id;
        processed := processed + 1;
      END IF;
    EXCEPTION WHEN others THEN
      UPDATE ingestion_staging st
         SET normalized_row = COALESCE(norm, normalize_row(s.raw_row, p_mapping_set_id)),
             error_message = COALESCE(SQLERRM, 'Unknown error'),
             status = 'error'
       WHERE st.id = s.id;
      errored := errored + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', processed, 'error', errored);
END;
$$;

