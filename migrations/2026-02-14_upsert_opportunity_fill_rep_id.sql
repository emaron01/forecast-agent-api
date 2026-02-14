-- Fill opportunities.rep_id during ingestion.
--
-- Context:
-- - The ingestion pipeline calls public.upsert_opportunity(jsonb, integer) wrapper.
-- - The repo intentionally does NOT embed public.upsert_opportunity(jsonb, bigint) implementation.
-- - Many environments ingest opportunities without populating opportunities.rep_id, which breaks
--   rep-id–scoped rollups (Sales Forecast module).
--
-- This migration:
-- 1) Updates the wrapper public.upsert_opportunity(jsonb, integer) to backfill opportunities.rep_id
--    for the upserted row using reps table matching on rep_name / crm_owner_name.
-- 2) Backfills existing opportunities with rep_id IS NULL using the same matching logic.
--
-- Safe to run multiple times (CREATE OR REPLACE + UPDATE ... WHERE rep_id IS NULL).

-- Update the canonical wrapper used by the ingestion pipeline.
-- NOTE: This wrapper still delegates to public.upsert_opportunity(jsonb, bigint) owned by the DB.
CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  res integer;
  v_rep_name text;
BEGIN
  IF to_regprocedure('public.upsert_opportunity(jsonb,bigint)') IS NULL THEN
    RAISE EXCEPTION 'function public.upsert_opportunity(jsonb,bigint) does not exist';
  END IF;

  v_rep_name := NULLIF(btrim(COALESCE(p_row->>'rep_name', '')), '');

  EXECUTE 'SELECT public.upsert_opportunity($1, $2::bigint)::int'
    INTO res
    USING p_row, p_org_id;

  -- Backfill rep_id for this opportunity if missing.
  IF res IS NOT NULL AND v_rep_name IS NOT NULL THEN
    UPDATE public.opportunities o
       SET rep_id = (
         SELECT r.id
           FROM public.reps r
          WHERE COALESCE(r.organization_id, r.org_id::bigint) = p_org_id::bigint
            AND (
              lower(btrim(COALESCE(r.crm_owner_name, ''))) = lower(v_rep_name)
              OR lower(btrim(COALESCE(r.rep_name, ''))) = lower(v_rep_name)
              OR lower(btrim(COALESCE(r.display_name, ''))) = lower(v_rep_name)
            )
          ORDER BY
            CASE
              WHEN lower(btrim(COALESCE(r.crm_owner_name, ''))) = lower(v_rep_name) THEN 0
              WHEN lower(btrim(COALESCE(r.rep_name, ''))) = lower(v_rep_name) THEN 1
              WHEN lower(btrim(COALESCE(r.display_name, ''))) = lower(v_rep_name) THEN 2
              ELSE 3
            END,
            r.id ASC
          LIMIT 1
       )
     WHERE o.org_id = p_org_id
       AND o.id = res
       AND o.rep_id IS NULL;
  END IF;

  RETURN res;
END;
$$;

-- Backfill existing opportunities missing rep_id (idempotent).
-- Pass 1: match opportunities.rep_name -> reps.crm_owner_name (preferred)
WITH rep_by_crm_owner_name AS (
  SELECT DISTINCT ON (COALESCE(r.organization_id, r.org_id::bigint), lower(btrim(r.crm_owner_name)))
    COALESCE(r.organization_id, r.org_id::bigint) AS org_key,
    lower(btrim(r.crm_owner_name)) AS name_key,
    r.id
  FROM public.reps r
  WHERE NULLIF(btrim(COALESCE(r.crm_owner_name, '')), '') IS NOT NULL
  ORDER BY COALESCE(r.organization_id, r.org_id::bigint), lower(btrim(r.crm_owner_name)), r.id ASC
)
UPDATE public.opportunities o
   SET rep_id = r.id
  FROM rep_by_crm_owner_name r
 WHERE o.rep_id IS NULL
   AND NULLIF(btrim(COALESCE(o.rep_name, '')), '') IS NOT NULL
   AND r.org_key = o.org_id::bigint
   AND r.name_key = lower(btrim(o.rep_name));

-- Pass 2: match opportunities.rep_name -> reps.rep_name
WITH rep_by_rep_name AS (
  SELECT DISTINCT ON (COALESCE(r.organization_id, r.org_id::bigint), lower(btrim(r.rep_name)))
    COALESCE(r.organization_id, r.org_id::bigint) AS org_key,
    lower(btrim(r.rep_name)) AS name_key,
    r.id
  FROM public.reps r
  WHERE NULLIF(btrim(COALESCE(r.rep_name, '')), '') IS NOT NULL
  ORDER BY COALESCE(r.organization_id, r.org_id::bigint), lower(btrim(r.rep_name)), r.id ASC
)
UPDATE public.opportunities o
   SET rep_id = r.id
  FROM rep_by_rep_name r
 WHERE o.rep_id IS NULL
   AND NULLIF(btrim(COALESCE(o.rep_name, '')), '') IS NOT NULL
   AND r.org_key = o.org_id::bigint
   AND r.name_key = lower(btrim(o.rep_name));

-- Pass 3: match opportunities.rep_name -> reps.display_name (last resort)
WITH rep_by_display_name AS (
  SELECT DISTINCT ON (COALESCE(r.organization_id, r.org_id::bigint), lower(btrim(r.display_name)))
    COALESCE(r.organization_id, r.org_id::bigint) AS org_key,
    lower(btrim(r.display_name)) AS name_key,
    r.id
  FROM public.reps r
  WHERE NULLIF(btrim(COALESCE(r.display_name, '')), '') IS NOT NULL
  ORDER BY COALESCE(r.organization_id, r.org_id::bigint), lower(btrim(r.display_name)), r.id ASC
)
UPDATE public.opportunities o
   SET rep_id = r.id
  FROM rep_by_display_name r
 WHERE o.rep_id IS NULL
   AND NULLIF(btrim(COALESCE(o.rep_name, '')), '') IS NOT NULL
   AND r.org_key = o.org_id::bigint
   AND r.name_key = lower(btrim(o.rep_name));

