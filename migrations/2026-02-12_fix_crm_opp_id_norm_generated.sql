-- Fix ingestion upsert for generated crm_opp_id_norm.
-- Some DBs define crm_opp_id_norm as a GENERATED column, so we must not write to it.
-- Safe to run multiple times.

CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id bigint)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $function$
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
  v_can_write_norm boolean := false;
BEGIN
  IF v_org_id IS NULL OR v_org_id <= 0 THEN
    RAISE EXCEPTION 'upsert_opportunity requires org_id';
  END IF;
  IF v_crm_opp_id IS NULL THEN
    RAISE EXCEPTION 'upsert_opportunity requires crm_opp_id';
  END IF;

  -- Determine whether crm_opp_id_norm is writable (not generated).
  SELECT COALESCE((
    SELECT (c.is_generated = 'NEVER')
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'opportunities'
       AND c.column_name = 'crm_opp_id_norm'
     LIMIT 1
  ), false) INTO v_can_write_norm;

  v_amount := public.try_parse_numeric_from_any(p_row->'amount');
  v_close_date := public.try_parse_date_from_any(p_row->'close_date');
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
      FROM public.opportunities o
     WHERE o.org_id = v_org_id
       AND o.crm_opp_id_norm = v_crm_norm
     LIMIT 1;
  EXCEPTION WHEN undefined_column THEN
    v_existing_id := NULL;
  END;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.opportunities o
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
           updated_at = NOW()
     WHERE o.id = v_existing_id
       AND o.org_id = v_org_id;

    IF v_can_write_norm THEN
      UPDATE public.opportunities o
         SET crm_opp_id_norm = v_crm_norm
       WHERE o.id = v_existing_id
         AND o.org_id = v_org_id;
    END IF;

    RETURN v_existing_id;
  END IF;

  -- Insert new (do NOT set crm_opp_id_norm if generated).
  INSERT INTO public.opportunities (
    org_id,
    account_name,
    opportunity_name,
    rep_name,
    crm_opp_id,
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

  IF v_can_write_norm THEN
    UPDATE public.opportunities o
       SET crm_opp_id_norm = v_crm_norm
     WHERE o.id = v_existing_id
       AND o.org_id = v_org_id;
  END IF;

  RETURN v_existing_id;
END;
$function$;

-- Keep the integer overload in sync.
CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id integer)
RETURNS integer
LANGUAGE sql
VOLATILE
AS $$
  SELECT public.upsert_opportunity($1, $2::bigint);
$$;

