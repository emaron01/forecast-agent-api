-- Patch ingestion functions to:
-- - avoid any remaining name resolution issues via explicit schema qualification
-- - avoid confusion by using a local v_mapping_set_id var in normalize_row
--
-- Safe to run multiple times.

CREATE OR REPLACE FUNCTION public.normalize_row(p_row jsonb, p_org_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  out jsonb := '{}'::jsonb;
  r record;
  tgt text;
  val jsonb;
  -- NOTE: p_org_id is used as mapping_set_id in this ingestion pipeline.
  v_mapping_set_id bigint := p_org_id;
BEGIN
  FOR r IN
    SELECT fm.source_field, fm.target_field
      FROM public.field_mappings fm
     WHERE fm.mapping_set_id = v_mapping_set_id
     ORDER BY fm.id ASC
  LOOP
    tgt := BTRIM(COALESCE(r.target_field, ''));
    IF tgt = '' THEN
      CONTINUE;
    END IF;
    IF tgt = 'stage' THEN
      tgt := 'sales_stage';
    END IF;

    val := NULL;
    IF p_row IS NOT NULL THEN
      val := p_row -> r.source_field;
    END IF;

    out := jsonb_set(out, ARRAY[tgt], COALESCE(val, 'null'::jsonb), true);
  END LOOP;

  RETURN out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_ingestion_batch(p_org_id integer, p_mapping_set_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  s record;
  norm jsonb;
  msg text;
  processed int := 0;
  errored int := 0;
BEGIN
  FOR s IN
    SELECT st.id, st.raw_row
      FROM public.ingestion_staging st
     WHERE st.organization_id = p_org_id
       AND st.mapping_set_id = p_mapping_set_id
       AND st.normalized_row IS NULL
       AND st.error_message IS NULL
     ORDER BY st.id ASC
  LOOP
    BEGIN
      norm := public.normalize_row(s.raw_row, p_mapping_set_id);
      msg := public.validate_row(norm, p_org_id::bigint);
      IF msg IS NOT NULL THEN
        UPDATE public.ingestion_staging st
           SET normalized_row = norm,
               error_message = msg,
               status = 'error'
         WHERE st.id = s.id;
        errored := errored + 1;
      ELSE
        PERFORM public.upsert_opportunity(norm, p_org_id::bigint);
        UPDATE public.ingestion_staging st
           SET normalized_row = norm,
               status = 'processed'
         WHERE st.id = s.id;
        processed := processed + 1;
      END IF;
    EXCEPTION WHEN others THEN
      UPDATE public.ingestion_staging st
         SET normalized_row = COALESCE(norm, public.normalize_row(s.raw_row, p_mapping_set_id)),
             error_message = COALESCE(SQLERRM, 'Unknown error'),
             status = 'error'
       WHERE st.id = s.id;
      errored := errored + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', processed, 'error', errored);
END;
$function$;

-- Ensure wrappers are schema-qualified too.
CREATE OR REPLACE FUNCTION public.validate_row(p_row jsonb, p_org_id integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.validate_row($1, $2::bigint);
$$;

CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id integer)
RETURNS integer
LANGUAGE sql
VOLATILE
AS $$
  SELECT public.upsert_opportunity($1, $2::bigint);
$$;

