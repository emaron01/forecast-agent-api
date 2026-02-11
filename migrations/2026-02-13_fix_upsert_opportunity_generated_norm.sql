-- Fix upsert_opportunity for DBs where crm_opp_id_norm is GENERATED.
-- Do not insert/update crm_opp_id_norm at all; let the DB compute it.
-- Safe to run multiple times.

CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id bigint)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v_org_id int := p_org_id::int;
  v_crm_opp_id text := NULLIF(BTRIM(COALESCE(p_row->>'crm_opp_id','')), '');
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

  v_amount := public.try_parse_numeric_from_any(p_row->'amount');
  v_close_date := public.try_parse_date_from_any(p_row->'close_date');
  v_create_date_raw := NULLIF(BTRIM(COALESCE(p_row->>'create_date_raw','')), '');
  v_account_name := NULLIF(BTRIM(COALESCE(p_row->>'account_name','')), '');
  v_opportunity_name := NULLIF(BTRIM(COALESCE(p_row->>'opportunity_name','')), '');
  v_rep_name := NULLIF(BTRIM(COALESCE(p_row->>'rep_name','')), '');
  v_forecast_stage := NULLIF(BTRIM(COALESCE(p_row->>'forecast_stage','')), '');
  v_sales_stage := NULLIF(BTRIM(COALESCE(p_row->>'sales_stage','')), '');
  v_product := NULLIF(BTRIM(COALESCE(p_row->>'product','')), '');

  -- Find existing by org + crm_opp_id.
  SELECT o.id
    INTO v_existing_id
    FROM public.opportunities o
   WHERE o.org_id = v_org_id
     AND o.crm_opp_id = v_crm_opp_id
   LIMIT 1;

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
    RETURN v_existing_id;
  END IF;

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

  RETURN v_existing_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id integer)
RETURNS integer
LANGUAGE sql
VOLATILE
AS $$
  SELECT public.upsert_opportunity($1, $2::bigint);
$$;

