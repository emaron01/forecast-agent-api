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
-- NOTE:
-- This repo must not embed a definition of upsert_opportunity(jsonb, bigint).
-- Application and ingestion code should call the integer wrapper only:
--   upsert_opportunity(p_row jsonb, p_org_id integer) -> delegates to (jsonb, bigint) on the DB.

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
      msg := validate_row(norm, p_org_id);
      IF msg IS NOT NULL THEN
        UPDATE ingestion_staging st
           SET normalized_row = norm,
               error_message = msg,
               status = 'error'
         WHERE st.id = s.id;
        errored := errored + 1;
      ELSE
        PERFORM upsert_opportunity(norm, p_org_id);
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

