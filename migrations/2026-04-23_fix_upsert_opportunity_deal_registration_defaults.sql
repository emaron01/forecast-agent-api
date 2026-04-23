-- Tighten deal_registration normalization so blank/missing values are always false.
-- Safe to re-run: CREATE OR REPLACE FUNCTION only.

CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id bigint)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v_org_id integer := p_org_id::integer;
  v_crm_opp_id text;
  v_id integer;

  v_account_name text;
  v_opportunity_name text;
  v_rep_name text;
  v_product text;
  v_sales_stage text;
  v_forecast_stage text;
  v_partner_name text;
  v_create_date_raw text;

  v_amount numeric;
  v_close_date date;

  v_deal_registration boolean := false;
  v_deal_reg_date date;
  v_deal_reg_id text;

  v_existing_rep_name text;
  v_rep_name_changed boolean;
  v_resolved_rep_id bigint;
  v_deal_registration_raw text;
BEGIN
  -- Required identifiers.
  v_crm_opp_id := NULLIF(btrim(COALESCE(p_row->>'crm_opp_id', '')), '');
  IF v_crm_opp_id IS NULL THEN
    RAISE EXCEPTION 'crm_opp_id is required';
  END IF;

  -- Strings (trimmed).
  v_account_name := NULLIF(btrim(COALESCE(p_row->>'account_name', '')), '');
  v_opportunity_name := NULLIF(btrim(COALESCE(p_row->>'opportunity_name', '')), '');
  v_rep_name := NULLIF(btrim(COALESCE(p_row->>'rep_name', '')), '');
  v_product := NULLIF(btrim(COALESCE(p_row->>'product', '')), '');
  v_sales_stage := NULLIF(btrim(COALESCE(p_row->>'sales_stage', '')), '');
  v_forecast_stage := NULLIF(btrim(COALESCE(p_row->>'forecast_stage', '')), '');
  v_partner_name := NULLIF(btrim(COALESCE(p_row->>'partner_name', '')), '');
  v_create_date_raw := NULLIF(btrim(COALESCE(p_row->>'create_date_raw', '')), '');

  -- Typed fields.
  v_amount := try_parse_numeric_from_any(p_row->'amount');
  v_close_date := try_parse_date_from_any(p_row->'close_date');

  -- deal_registration (boolean) — explicit false-by-default normalization.
  IF p_row ? 'deal_registration' THEN
    v_deal_registration_raw := NULLIF(btrim(COALESCE(p_row->>'deal_registration', '')), '');
    v_deal_registration := CASE
      WHEN v_deal_registration_raw IS NULL THEN false
      WHEN lower(v_deal_registration_raw) IN
        ('true', 'yes', 'y', '1', 'registered', 'approved', 'active', 'pending') THEN true
      WHEN lower(v_deal_registration_raw) IN
        ('false', 'f', 'no', 'n', '0', 'null', 'none', 'expired') THEN false
      WHEN try_parse_date_from_any(to_jsonb(v_deal_registration_raw)) IS NOT NULL THEN true
      ELSE false
    END;
  END IF;

  -- deal_reg_date (date) — customer maps their date field here
  IF p_row ? 'deal_reg_date' THEN
    BEGIN
      v_deal_reg_date := (p_row->>'deal_reg_date')::date;
      -- If date is present, also set boolean to true
      IF v_deal_reg_date IS NOT NULL THEN
        v_deal_registration := true;
      END IF;
    EXCEPTION WHEN others THEN
      v_deal_reg_date := NULL;
    END;
  END IF;

  -- deal_reg_id (text) — customer maps their reg number/ID field here
  IF p_row ? 'deal_reg_id' THEN
    v_deal_reg_id := btrim(COALESCE(p_row->>'deal_reg_id', ''));
    IF v_deal_reg_id = '' THEN
      v_deal_reg_id := NULL;
    ELSE
      -- If ID is present, also set boolean to true
      v_deal_registration := true;
    END IF;
  END IF;

  -- Find existing record by (org_id, crm_opp_id). If duplicates exist, update the most recent.
  SELECT o.id
    INTO v_id
    FROM public.opportunities o
   WHERE o.org_id = v_org_id
     AND NULLIF(btrim(COALESCE(o.crm_opp_id, '')), '') = v_crm_opp_id
   ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.opportunities (
      org_id,
      crm_opp_id,
      account_name,
      opportunity_name,
      rep_name,
      product,
      amount,
      create_date_raw,
      close_date,
      sales_stage,
      forecast_stage,
      partner_name,
      deal_registration,
      deal_reg_date,
      deal_reg_id,
      rep_id,
      created_at,
      updated_at
    )
    VALUES (
      v_org_id,
      v_crm_opp_id,
      v_account_name,
      v_opportunity_name,
      v_rep_name,
      v_product,
      v_amount,
      v_create_date_raw,
      v_close_date,
      v_sales_stage,
      v_forecast_stage,
      v_partner_name,
      v_deal_registration,
      v_deal_reg_date,
      v_deal_reg_id,
      NULL,
      now(),
      now()
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT o.rep_name
      INTO v_existing_rep_name
      FROM public.opportunities o
     WHERE o.org_id = v_org_id
       AND o.id = v_id;

    v_rep_name_changed :=
      lower(COALESCE(NULLIF(btrim(v_rep_name), ''), ''))
      IS DISTINCT FROM
      lower(COALESCE(NULLIF(btrim(v_existing_rep_name), ''), ''));

    v_resolved_rep_id := NULL;
    IF v_rep_name_changed AND v_rep_name IS NOT NULL THEN
      SELECT r.id
        INTO v_resolved_rep_id
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
       LIMIT 1;
    END IF;

    UPDATE public.opportunities o
       SET account_name = v_account_name,
           opportunity_name = v_opportunity_name,
           rep_name = v_rep_name,
           product = v_product,
           amount = v_amount,
           create_date_raw = v_create_date_raw,
           close_date = v_close_date,
           sales_stage = v_sales_stage,
           forecast_stage = v_forecast_stage,
           partner_name = v_partner_name,
           deal_registration = v_deal_registration,
           deal_reg_date = v_deal_reg_date,
           deal_reg_id = v_deal_reg_id,
           rep_id = CASE
             WHEN v_rep_name_changed AND v_resolved_rep_id IS NOT NULL THEN v_resolved_rep_id
             ELSE o.rep_id
           END,
           updated_at = now()
     WHERE o.org_id = v_org_id
       AND o.id = v_id;
  END IF;

  RETURN v_id;
END;
$function$;
