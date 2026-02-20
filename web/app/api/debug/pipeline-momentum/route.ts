import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "../../../../lib/pool";
import { getAuth } from "../../../../lib/auth";
import { getScopedRepDirectory } from "../../../../lib/repScope";

export const runtime = "nodejs";

function normalizeNameKey(s: any) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function jsonError(status: number, error: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.kind !== "user") return jsonError(403, "Forbidden");

  // Keep this as a "power-user" debug endpoint (exec/admin/manager only).
  const role = String(auth.user.role || "").trim().toUpperCase();
  if (role !== "ADMIN" && role !== "EXEC_MANAGER" && role !== "MANAGER") {
    return jsonError(403, "Forbidden");
  }

  const url = new URL(req.url);
  const quotaPeriodId = z
    .string()
    .regex(/^\d+$/)
    .parse(String(url.searchParams.get("quota_period_id") || "").trim() || "");

  const scopedRole =
    role === "ADMIN" || role === "EXEC_MANAGER" || role === "MANAGER" || role === "REP"
      ? (role as "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP")
      : ("REP" as const);

  const scope = await getScopedRepDirectory({
    orgId: auth.user.org_id,
    userId: auth.user.id,
    role: scopedRole,
  }).catch(() => ({
    repDirectory: [],
    allowedRepIds: role === "ADMIN" ? (null as number[] | null) : ([] as number[]),
    myRepId: null as number | null,
  }));

  const useRepFilter = scope.allowedRepIds !== null;
  const repIds = useRepFilter ? (scope.allowedRepIds ?? []) : [];
  const repNameKeys = useRepFilter
    ? Array.from(new Set((scope.repDirectory || []).map((r: any) => normalizeNameKey(r?.name)).filter(Boolean)))
    : [];

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
            lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
            o.close_date::date AS close_d,
            o.rep_id,
            lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) AS rep_name_key
          FROM opportunities o
          WHERE o.org_id = $1
            AND (
              NOT $5::boolean
              OR (
                (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                OR (
                  COALESCE(array_length($4::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                )
              )
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
           WHERE NOT ((' ' || d.fs || ' ') LIKE '% won %')
             AND NOT ((' ' || d.fs || ' ') LIKE '% lost %')
             AND NOT ((' ' || d.fs || ' ') LIKE '% closed %')
        )
        SELECT
          COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
          COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN 1 ELSE 0 END), 0)::int AS commit_count,
          COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
          COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS best_case_count,
          COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
          COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
          COALESCE(SUM(amount), 0)::float8 AS total_amount,
          COUNT(*)::int AS total_count
        FROM open_deals
        `,
        [auth.user.org_id, quotaPeriodId, repIds, repNameKeys, useRepFilter]
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
          lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
          lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) AS rep_name_key
        FROM opportunities o
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
         WHERE NOT ((' ' || fs || ' ') LIKE '% won %')
           AND NOT ((' ' || fs || ' ') LIKE '% lost %')
           AND NOT ((' ' || fs || ' ') LIKE '% closed %')
      ),
      scoped_open AS (
        SELECT *
          FROM open_in_qtr
         WHERE (
           NOT $5::boolean
           OR (
             (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND rep_id = ANY($3::bigint[]))
             OR (COALESCE(array_length($4::text[], 1), 0) > 0 AND rep_name_key = ANY($4::text[]))
           )
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
      [auth.user.org_id, quotaPeriodId, repIds, repNameKeys, useRepFilter]
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
          lower(regexp_replace(COALESCE(NULLIF(btrim(forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
          lower(regexp_replace(btrim(COALESCE(rep_name, '')), '\\s+', ' ', 'g')) AS rep_name_key
        FROM opportunities
        WHERE org_id = $1
      ),
      open_in_qtr AS (
        SELECT b.*
          FROM base b
          JOIN qp ON TRUE
         WHERE b.close_date IS NOT NULL
           AND b.close_date >= qp.period_start
           AND b.close_date <= qp.period_end
           AND NOT ((' ' || b.fs || ' ') LIKE '% won %')
           AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
           AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
      ),
      scoped AS (
        SELECT *
          FROM open_in_qtr
         WHERE (
           NOT $5::boolean
           OR (
             (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND rep_id::bigint = ANY($3::bigint[]))
             OR (COALESCE(array_length($4::text[], 1), 0) > 0 AND rep_name_key = ANY($4::text[]))
           )
         )
      )
      SELECT *
        FROM scoped
       ORDER BY amount DESC, id DESC
       LIMIT 25
      `,
      [auth.user.org_id, quotaPeriodId, repIds, repNameKeys, useRepFilter]
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
          lower(regexp_replace(COALESCE(NULLIF(btrim(forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
          close_date::date AS close_date,
          rep_id,
          lower(regexp_replace(btrim(COALESCE(rep_name, '')), '\\s+', ' ', 'g')) AS rep_name_key
        FROM opportunities
        WHERE org_id = $1
      ),
      open_in_qtr AS (
        SELECT b.*
          FROM base b
          JOIN qp ON TRUE
         WHERE b.close_date IS NOT NULL
           AND b.close_date >= qp.period_start
           AND b.close_date <= qp.period_end
           AND NOT ((' ' || b.fs || ' ') LIKE '% won %')
           AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
           AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
      ),
      scoped AS (
        SELECT *
          FROM open_in_qtr
         WHERE (
           NOT $5::boolean
           OR (
             (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND rep_id = ANY($3::bigint[]))
             OR (COALESCE(array_length($4::text[], 1), 0) > 0 AND rep_name_key = ANY($4::text[]))
           )
         )
      )
      SELECT forecast_stage, COUNT(*)::int AS opps
        FROM scoped
       GROUP BY forecast_stage
       ORDER BY opps DESC, forecast_stage ASC
       LIMIT 40
      `,
      [auth.user.org_id, quotaPeriodId, repIds, repNameKeys, useRepFilter]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  return NextResponse.json({
    ok: true,
    quota_period: qp,
    scope: {
      useRepFilter,
      repIdsCount: repIds.length,
      repNameKeysCount: repNameKeys.length,
    },
    counts,
    snapshot,
    stageStats,
    samples,
  });
}

