import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "../../../../lib/pool";
import { getAuth } from "../../../../lib/auth";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { isAdmin, isSalesLeader } from "../../../../lib/roleHelpers";
import { crmBucketCaseSql } from "../../../../lib/crmBucketCaseSql";

export const runtime = "nodejs";

function jsonError(status: number, error: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.kind !== "user") return jsonError(403, "Forbidden");

  // Keep this as a "power-user" debug endpoint (exec/admin/manager only).
  if (!isAdmin(auth.user) && !isSalesLeader(auth.user)) {
    return jsonError(403, "Forbidden");
  }

  const url = new URL(req.url);
  const quotaPeriodId = z
    .string()
    .regex(/^\d+$/)
    .parse(String(url.searchParams.get("quota_period_id") || "").trim() || "");

  const scope = await getScopedRepDirectory({
    orgId: auth.user.org_id,
    user: auth.user,
  }).catch(() => ({
    repDirectory: [],
    allowedRepIds: auth.user.hierarchy_level === 0 ? (null as number[] | null) : ([] as number[]),
    myRepId: null as number | null,
  }));

  const useRepFilter = scope.allowedRepIds !== null;
  const repIds = useRepFilter ? (scope.allowedRepIds ?? []) : [];

  // 1) Quota period bounds (ground truth for filtering)
  const qp = await pool
    .query(
      `
      SELECT
        id::text AS id,
        period_start::date AS period_start,
        period_end::date AS period_end,
        COALESCE(NULLIF(btrim(period_name), ''), (period_start::text || ' → ' || period_end::text)) AS period_name,
        COALESCE(NULLIF(btrim(fiscal_year), ''), substring(period_start::text from 1 for 4)) AS fiscal_year,
        fiscal_quarter::text AS fiscal_quarter
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
      `,
      [auth.user.org_id, quotaPeriodId]
    )
    .then((r) => r.rows?.[0] || null)
    .catch(() => null);

  if (!qp) return jsonError(404, "Quota period not found");

  // 2) Open pipeline snapshot (same logic as executive dashboard)
  type SnapshotRow = {
    commit_amount: number;
    commit_count: number;
    best_case_amount: number;
    best_case_count: number;
    pipeline_amount: number;
    pipeline_count: number;
    total_amount: number;
    total_count: number;
  };

  const snapshot: SnapshotRow =
    (await pool
      .query<SnapshotRow>(
        `
        WITH qp AS (
          SELECT period_start::date AS period_start, period_end::date AS period_end
            FROM quota_periods
           WHERE org_id = $1::bigint
             AND id = $2::bigint
           LIMIT 1
        ),
        deals AS (
          SELECT
            COALESCE(o.amount, 0)::float8 AS amount,
            o.forecast_stage,
            o.sales_stage,
            (${crmBucketCaseSql("o")}) AS crm_bucket,
            lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
            o.close_date::date AS close_d,
            o.rep_id
          FROM opportunities o
          LEFT JOIN org_stage_mappings stm
            ON stm.org_id = o.org_id
           AND stm.field = 'stage'
           AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
          LEFT JOIN org_stage_mappings fcm
            ON fcm.org_id = o.org_id
           AND fcm.field = 'forecast_category'
           AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
          WHERE o.org_id = $1
            AND (
              NOT $4::boolean
              OR (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
            )
        ),
        deals_in_qtr AS (
          SELECT d.*
            FROM deals d
            JOIN qp ON TRUE
           WHERE d.close_d IS NOT NULL
             AND d.close_d >= qp.period_start
             AND d.close_d <= qp.period_end
        ),
        open_deals AS (
          SELECT *
            FROM deals_in_qtr d
           WHERE d.crm_bucket IN ('commit', 'best_case', 'pipeline')
        )
        SELECT
          COALESCE(SUM(CASE WHEN crm_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
          COALESCE(SUM(CASE WHEN crm_bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS commit_count,
          COALESCE(SUM(CASE WHEN crm_bucket = 'best_case' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
          COALESCE(SUM(CASE WHEN crm_bucket = 'best_case' THEN 1 ELSE 0 END), 0)::int AS best_case_count,
          COALESCE(SUM(CASE WHEN crm_bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
          COALESCE(SUM(CASE WHEN crm_bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
          COALESCE(SUM(amount), 0)::float8 AS total_amount,
          COUNT(*)::int AS total_count
        FROM open_deals
        `,
        [auth.user.org_id, quotaPeriodId, repIds, useRepFilter]
      )
      .then((r) => (r.rows?.[0] as any) || null)
      .catch(() => null)) || {
      commit_amount: 0,
      commit_count: 0,
      best_case_amount: 0,
      best_case_count: 0,
      pipeline_amount: 0,
      pipeline_count: 0,
      total_amount: 0,
      total_count: 0,
    };

  // 3) Counts + samples to pinpoint why totals are zero
  const counts = await pool
    .query(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      base AS (
        SELECT
          o.amount,
          o.close_date,
          o.create_date,
          o.rep_id,
          o.rep_name,
          o.sales_stage,
          o.forecast_stage,
          (${crmBucketCaseSql("o")}) AS crm_bucket,
          lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        WHERE o.org_id = $1
      ),
      in_qtr AS (
        SELECT b.*
          FROM base b
          JOIN qp ON TRUE
         WHERE b.close_date IS NOT NULL
           AND b.close_date::date >= qp.period_start
           AND b.close_date::date <= qp.period_end
      ),
      open_in_qtr AS (
        SELECT *
          FROM in_qtr
         WHERE crm_bucket IN ('commit', 'best_case', 'pipeline')
      ),
      scoped_open AS (
        SELECT *
          FROM open_in_qtr
         WHERE (
           NOT $4::boolean
           OR (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND rep_id = ANY($3::bigint[]))
         )
      )
      SELECT
        (SELECT COUNT(*)::int FROM base) AS opps_total_org,
        (SELECT COUNT(*)::int FROM base WHERE close_date IS NULL) AS opps_missing_close_date,
        (SELECT COUNT(*)::int FROM in_qtr) AS opps_close_date_in_period,
        (SELECT COUNT(*)::int FROM open_in_qtr) AS opps_open_in_period,
        (SELECT COUNT(*)::int FROM scoped_open) AS opps_open_in_period_scoped,
        (SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)::float8 FROM scoped_open) AS amount_open_in_period_scoped
      `,
      [auth.user.org_id, quotaPeriodId, repIds, useRepFilter]
    )
    .then((r) => r.rows?.[0] || null)
    .catch(() => null);

  const samples = await pool
    .query(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      base AS (
        SELECT
          public_id::text AS id,
          COALESCE(amount, 0)::float8 AS amount,
          close_date::date AS close_date,
          create_date::timestamptz AS create_date,
          rep_id::text AS rep_id,
          rep_name,
          sales_stage,
          forecast_stage,
          (${crmBucketCaseSql("opportunities")}) AS crm_bucket,
          lower(regexp_replace(COALESCE(NULLIF(btrim(forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
        FROM opportunities
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = opportunities.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(opportunities.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = opportunities.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(opportunities.forecast_stage::text, '')))
        WHERE org_id = $1
      ),
      open_in_qtr AS (
        SELECT b.*
          FROM base b
          JOIN qp ON TRUE
         WHERE b.close_date IS NOT NULL
           AND b.close_date >= qp.period_start
           AND b.close_date <= qp.period_end
           AND b.crm_bucket IN ('commit', 'best_case', 'pipeline')
      ),
      scoped AS (
        SELECT *
          FROM open_in_qtr
         WHERE (
           NOT $4::boolean
           OR (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND rep_id::bigint = ANY($3::bigint[]))
         )
      )
      SELECT *
        FROM scoped
       ORDER BY amount DESC, id DESC
       LIMIT 25
      `,
      [auth.user.org_id, quotaPeriodId, repIds, useRepFilter]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const stageStats = await pool
    .query(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      base AS (
        SELECT
          COALESCE(NULLIF(btrim(forecast_stage), ''), '(blank)') AS forecast_stage,
          sales_stage,
          (${crmBucketCaseSql("opportunities")}) AS crm_bucket,
          lower(regexp_replace(COALESCE(NULLIF(btrim(forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
          close_date::date AS close_date,
          rep_id
        FROM opportunities
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = opportunities.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(opportunities.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = opportunities.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(opportunities.forecast_stage::text, '')))
        WHERE org_id = $1
      ),
      open_in_qtr AS (
        SELECT b.*
          FROM base b
          JOIN qp ON TRUE
         WHERE b.close_date IS NOT NULL
           AND b.close_date >= qp.period_start
           AND b.close_date <= qp.period_end
           AND b.crm_bucket IN ('commit', 'best_case', 'pipeline')
      ),
      scoped AS (
        SELECT *
          FROM open_in_qtr
         WHERE (
           NOT $4::boolean
           OR (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND rep_id = ANY($3::bigint[]))
         )
      )
      SELECT forecast_stage, COUNT(*)::int AS opps
        FROM scoped
       GROUP BY forecast_stage
       ORDER BY opps DESC, forecast_stage ASC
       LIMIT 40
      `,
      [auth.user.org_id, quotaPeriodId, repIds, useRepFilter]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  return NextResponse.json({
    ok: true,
    quota_period: qp,
    scope: {
      useRepFilter,
      repIdsCount: repIds.length,
    },
    counts,
    snapshot,
    stageStats,
    samples,
  });
}

