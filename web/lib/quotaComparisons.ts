import { z } from "zod";
import { pool } from "./pool";

const zOrganizationId = z.coerce.number().int().positive();
const zQuotaPeriodId = z.string().regex(/^\d+$/);

export type StageComparisonRow = {
  opportunity_public_id: string;
  rep_id: number | null;
  rep_name: string | null;
  account_name: string | null;
  opportunity_name: string | null;
  close_date: string | null;
  partner_name: string | null;
  deal_registration: boolean | null;
  amount: number | null;
  crm_forecast_stage: string | null;
  ai_forecast_stage: string | null;
  stage_match: boolean;
  updated_at: string | null;
};

export type CompanyAttainmentRow = {
  fiscal_year: string;
  period_start: string;
  period_end: string;
  quarterly_actual_amount: number;
  quarterly_company_quota_amount: number;
  quarterly_attainment: number | null;
  annual_actual_amount: number;
  annual_company_quota_amount: number;
  annual_attainment: number | null;
};

export type RepAttainmentRow = {
  rep_id: number;
  rep_name: string | null;
  quota_amount: number;
  actual_amount: number;
  attainment: number | null;
};

export async function listStageComparisonsForPeriod(args: {
  orgId: number;
  quotaPeriodId: string;
  limit?: number;
  onlyMismatches?: boolean;
}): Promise<StageComparisonRow[]> {
  const orgId = zOrganizationId.parse(args.orgId);
  const quotaPeriodId = zQuotaPeriodId.parse(args.quotaPeriodId);
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 200) || 200));
  const onlyMismatches = Boolean(args.onlyMismatches ?? false);

  const { rows } = await pool.query<StageComparisonRow>(
    `
    WITH qp AS (
      SELECT period_start, period_end
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND id = $2::bigint
       LIMIT 1
    ),
    deals AS (
      SELECT
        o.public_id::text AS opportunity_public_id,
        o.rep_id,
        o.rep_name,
        o.account_name,
        o.opportunity_name,
        o.close_date::text AS close_date,
        o.partner_name,
        o.deal_registration,
        o.amount,
        o.forecast_stage AS crm_forecast_stage,
        COALESCE(o.ai_verdict, o.ai_forecast) AS ai_forecast_stage,
        o.updated_at::text AS updated_at
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
    )
    SELECT
      opportunity_public_id,
      rep_id,
      rep_name,
      account_name,
      opportunity_name,
      close_date,
      partner_name,
      deal_registration,
      amount,
      crm_forecast_stage,
      ai_forecast_stage,
      (
        lower(btrim(COALESCE(crm_forecast_stage, ''))) = lower(btrim(COALESCE(ai_forecast_stage, '')))
      ) AS stage_match,
      updated_at
    FROM deals
    WHERE ($3::bool IS FALSE)
       OR (
         lower(btrim(COALESCE(crm_forecast_stage, ''))) <> lower(btrim(COALESCE(ai_forecast_stage, '')))
       )
    ORDER BY updated_at DESC NULLS LAST, opportunity_public_id DESC
    LIMIT $4
    `,
    [orgId, quotaPeriodId, onlyMismatches, limit]
  );

  return rows as StageComparisonRow[];
}

export async function getCompanyAttainmentForPeriod(args: { orgId: number; quotaPeriodId: string }): Promise<CompanyAttainmentRow | null> {
  const orgId = zOrganizationId.parse(args.orgId);
  const quotaPeriodId = zQuotaPeriodId.parse(args.quotaPeriodId);

  const { rows } = await pool.query<CompanyAttainmentRow>(
    `
    WITH qp AS (
      SELECT period_start, period_end, fiscal_year
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND id = $2::bigint
       LIMIT 1
    ),
    year_bounds AS (
      SELECT MIN(period_start) AS year_start, MAX(period_end) AS year_end, (SELECT fiscal_year FROM qp) AS fiscal_year
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND fiscal_year = (SELECT fiscal_year FROM qp)
    ),
    quarterly_actual AS (
      SELECT COALESCE(SUM(o.amount), 0)::float8 AS amt
        FROM opportunities o
        JOIN qp ON TRUE
       WHERE o.org_id = $1
         AND o.close_date IS NOT NULL
         AND o.close_date >= qp.period_start
         AND o.close_date <= qp.period_end
    ),
    quarterly_company_quota AS (
      SELECT COALESCE(SUM(q.quota_amount), 0)::float8 AS amt
        FROM quotas q
       WHERE q.org_id = $1::bigint
         AND q.quota_period_id = $2::bigint
         AND q.role_level = 0
    ),
    annual_actual AS (
      SELECT COALESCE(SUM(o.amount), 0)::float8 AS amt
        FROM opportunities o
        JOIN year_bounds y ON TRUE
       WHERE o.org_id = $1
         AND o.close_date IS NOT NULL
         AND o.close_date >= y.year_start
         AND o.close_date <= y.year_end
    ),
    annual_company_quota AS (
      SELECT COALESCE(SUM(q.quota_amount), 0)::float8 AS amt
        FROM quotas q
        JOIN quota_periods p ON p.id = q.quota_period_id
       WHERE q.org_id = $1::bigint
         AND q.role_level = 0
         AND p.org_id = $1::bigint
         AND p.fiscal_year = (SELECT fiscal_year FROM qp)
    )
    SELECT
      (SELECT fiscal_year FROM qp) AS fiscal_year,
      (SELECT period_start::text FROM qp) AS period_start,
      (SELECT period_end::text FROM qp) AS period_end,
      (SELECT amt FROM quarterly_actual) AS quarterly_actual_amount,
      (SELECT amt FROM quarterly_company_quota) AS quarterly_company_quota_amount,
      CASE WHEN (SELECT amt FROM quarterly_company_quota) = 0 THEN NULL
           ELSE (SELECT amt FROM quarterly_actual) / (SELECT amt FROM quarterly_company_quota)
      END AS quarterly_attainment,
      (SELECT amt FROM annual_actual) AS annual_actual_amount,
      (SELECT amt FROM annual_company_quota) AS annual_company_quota_amount,
      CASE WHEN (SELECT amt FROM annual_company_quota) = 0 THEN NULL
           ELSE (SELECT amt FROM annual_actual) / (SELECT amt FROM annual_company_quota)
      END AS annual_attainment
    `,
    [orgId, quotaPeriodId]
  );

  return (rows?.[0] as CompanyAttainmentRow | undefined) || null;
}

export async function listRepAttainmentForPeriod(args: {
  orgId: number;
  quotaPeriodId: string;
  limit?: number;
}): Promise<RepAttainmentRow[]> {
  const orgId = zOrganizationId.parse(args.orgId);
  const quotaPeriodId = zQuotaPeriodId.parse(args.quotaPeriodId);
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 200) || 200));

  const { rows } = await pool.query<RepAttainmentRow>(
    `
    WITH qp AS (
      SELECT period_start, period_end
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND id = $2::bigint
       LIMIT 1
    ),
    actuals AS (
      SELECT
        o.rep_id,
        COALESCE(SUM(o.amount), 0)::float8 AS actual_amount
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND o.rep_id IS NOT NULL
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
      GROUP BY o.rep_id
    )
    SELECT
      q.rep_id::int AS rep_id,
      r.rep_name,
      q.quota_amount::float8 AS quota_amount,
      COALESCE(a.actual_amount, 0)::float8 AS actual_amount,
      CASE WHEN q.quota_amount = 0 THEN NULL
           ELSE COALESCE(a.actual_amount, 0)::float8 / q.quota_amount::float8
      END AS attainment
    FROM quotas q
    LEFT JOIN reps r
      ON r.id = q.rep_id
     AND r.organization_id = $1
    LEFT JOIN actuals a
      ON a.rep_id = q.rep_id::int
    WHERE q.org_id = $1::bigint
      AND q.quota_period_id = $2::bigint
      AND q.rep_id IS NOT NULL
      AND q.role_level = 3
    ORDER BY attainment DESC NULLS LAST, quota_amount DESC, rep_id ASC
    LIMIT $3
    `,
    [orgId, quotaPeriodId, limit]
  );

  return rows as RepAttainmentRow[];
}

