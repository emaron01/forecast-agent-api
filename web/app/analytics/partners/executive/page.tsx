import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { UserTopNav } from "../../../_components/UserTopNav";
import type { QuotaPeriodRow } from "../../../../lib/quotaModels";
import { getDistinctFiscalYears, getQuotaPeriods } from "../../quotas/actions";
import { pool } from "../../../../lib/pool";
import { TopDealsFiltersClient } from "../../quotas/executive/TopDealsFiltersClient";
import { ExportToExcelButton } from "../../../_components/ExportToExcelButton";
import { getHealthAveragesByPeriods } from "../../../../lib/analyticsHealth";
import { AverageHealthScorePanel } from "../../../_components/AverageHealthScorePanel";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { PartnerAiStrategicTakeawayClient } from "./ui/PartnerAiStrategicTakeawayClient";
import { AiSummaryReportClient } from "../../../../components/ai/AiSummaryReportClient";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isIsoDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function normalizeDateRange(startRaw: string, endRaw: string) {
  let start = isIsoDateOnly(startRaw) ? String(startRaw).trim() : "";
  let end = isIsoDateOnly(endRaw) ? String(endRaw).trim() : "";
  if (start && end && start > end) [start, end] = [end, start];
  return { start, end };
}

export const runtime = "nodejs";

type TopPartnerDealRow = {
  opportunity_public_id: string;
  partner_name: string;
  account_name: string | null;
  opportunity_name: string | null;
  product: string | null;
  amount: number;
  create_date: string | null;
  close_date: string | null;
  baseline_health_score: number | null;
  health_score: number | null;
};

type DealSortKey = "amount" | "partner" | "account" | "opportunity" | "product" | "age" | "initial_health" | "final_health";
type DealSortDir = "asc" | "desc";

function clampPctFromScore30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round((n / 30) * 100);
  return Math.max(0, Math.min(100, pct));
}

function healthExport(score: any) {
  const raw = Number(score);
  const pct = clampPctFromScore30(score);
  return { pct: pct == null ? null : pct, raw: Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null };
}

function HealthScorePill(props: { score: any }) {
  const s = Number(props.score);
  const pct = clampPctFromScore30(s);
  const color =
    pct == null
      ? "text-[color:var(--sf-text-disabled)]"
      : pct >= 80
        ? "text-[#2ECC71]"
        : pct >= 50
          ? "text-[#F1C40F]"
          : "text-[#E74C3C]";
  return (
    <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1">
      <span className={color}>{pct == null ? "—" : `${pct}%`}</span>{" "}
      <span className="text-[color:var(--sf-text-secondary)]">({Number.isFinite(s) && s > 0 ? `${Math.round(s)}/30` : "—"})</span>
    </span>
  );
}

function dateOnly(d: any) {
  if (!d) return "";
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct01(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function clampScore100(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 100) return 100;
  return v;
}

// Canonical normalization helper (required).
function normalize(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0.5;
  if (max === min) return 0.5;
  return clamp01((value - min) / (max - min));
}

function health01FromScore30(rawScore: number | null) {
  if (rawScore == null || !Number.isFinite(rawScore)) return null;
  return clamp01(rawScore / 30);
}

function wicBand(score: number) {
  if (!Number.isFinite(score)) return { label: "—", tone: "muted" as const };
  if (score >= 80) return { label: "INVEST AGGRESSIVELY", tone: "good" as const };
  if (score >= 60) return { label: "SCALE SELECTIVELY", tone: "good" as const };
  if (score >= 40) return { label: "MAINTAIN", tone: "warn" as const };
  return { label: "DEPRIORITIZE", tone: "bad" as const };
}

function pillToneClass(tone: "good" | "warn" | "bad" | "muted") {
  if (tone === "good") return "border-[#16A34A]/35 bg-[#16A34A]/10 text-[#16A34A]";
  if (tone === "warn") return "border-[#F1C40F]/50 bg-[#F1C40F]/12 text-[#F1C40F]";
  if (tone === "bad") return "border-[#E74C3C]/45 bg-[#E74C3C]/12 text-[#E74C3C]";
  return "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";
}

function daysBetween(createDate: any, closeDate: any) {
  if (!createDate || !closeDate) return null;
  const a = new Date(createDate).getTime();
  const b = new Date(closeDate).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.round((b - a) / 86400000);
  return Number.isFinite(d) ? d : null;
}

type MotionStatsRow = {
  motion: "direct" | "partner";
  opps: number;
  won_opps: number;
  lost_opps: number;
  win_rate: number | null;
  aov: number | null;
  avg_days: number | null;
  avg_health_score: number | null; // raw (0..30)
  won_amount: number;
  lost_amount: number;
};

type PartnerRollupRow = {
  partner_name: string;
  opps: number;
  won_opps: number;
  lost_opps: number;
  win_rate: number | null;
  aov: number | null;
  avg_days: number | null;
  avg_health_score: number | null; // raw (0..30)
  won_amount: number;
};

async function loadMotionStats(args: {
  orgId: number;
  quotaPeriodId: string;
  dateStart?: string | null;
  dateEnd?: string | null;
  repIds: number[] | null;
}): Promise<MotionStatsRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<MotionStatsRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($4::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($5::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    base AS (
      SELECT
        CASE
          WHEN o.partner_name IS NOT NULL AND btrim(o.partner_name) <> '' THEN 'partner'
          ELSE 'direct'
        END AS motion,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.create_date::timestamptz AS create_date,
        o.close_date::date AS close_date,
        o.health_score::float8 AS health_score,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $6::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.range_start
        AND o.close_date <= qp.range_end
        AND (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    ),
    scored AS (
      SELECT
        motion,
        amount,
        health_score,
        CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END AS is_won,
        CASE WHEN ((' ' || fs || ' ') LIKE '% lost %' OR (' ' || fs || ' ') LIKE '% loss %') THEN 1 ELSE 0 END AS is_lost,
        CASE WHEN create_date IS NOT NULL AND close_date IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int ELSE NULL END AS age_days
      FROM base
    )
    SELECT
      motion,
      COUNT(*)::int AS opps,
      SUM(is_won)::int AS won_opps,
      SUM(is_lost)::int AS lost_opps,
      CASE WHEN COUNT(*) > 0 THEN (SUM(is_won)::float8 / COUNT(*)::float8) ELSE NULL END AS win_rate,
      AVG(NULLIF(amount, 0))::float8 AS aov,
      AVG(age_days)::float8 AS avg_days,
      AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
      SUM(CASE WHEN is_won = 1 THEN amount ELSE 0 END)::float8 AS won_amount,
      SUM(CASE WHEN is_lost = 1 THEN amount ELSE 0 END)::float8 AS lost_amount
    FROM scored
    GROUP BY motion
    ORDER BY motion ASC
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], args.dateStart || null, args.dateEnd || null, useRepFilter]
  );
  return rows || [];
}

async function listPartnerRollup(args: {
  orgId: number;
  quotaPeriodId: string;
  limit: number;
  dateStart?: string | null;
  dateEnd?: string | null;
  repIds: number[] | null;
}): Promise<PartnerRollupRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<PartnerRollupRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($4::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($5::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    base AS (
      SELECT
        btrim(o.partner_name) AS partner_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.create_date::timestamptz AS create_date,
        o.close_date::date AS close_date,
        o.health_score::float8 AS health_score,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $6::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.range_start
        AND o.close_date <= qp.range_end
        AND (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    ),
    scored AS (
      SELECT
        partner_name,
        amount,
        health_score,
        CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END AS is_won,
        CASE WHEN ((' ' || fs || ' ') LIKE '% lost %' OR (' ' || fs || ' ') LIKE '% loss %') THEN 1 ELSE 0 END AS is_lost,
        CASE WHEN create_date IS NOT NULL AND close_date IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int ELSE NULL END AS age_days
      FROM base
    )
    SELECT
      partner_name,
      COUNT(*)::int AS opps,
      SUM(is_won)::int AS won_opps,
      SUM(is_lost)::int AS lost_opps,
      CASE WHEN COUNT(*) > 0 THEN (SUM(is_won)::float8 / COUNT(*)::float8) ELSE NULL END AS win_rate,
      AVG(NULLIF(amount, 0))::float8 AS aov,
      AVG(age_days)::float8 AS avg_days,
      AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
      SUM(CASE WHEN is_won = 1 THEN amount ELSE 0 END)::float8 AS won_amount
    FROM scored
    GROUP BY partner_name
    ORDER BY won_amount DESC NULLS LAST, opps DESC, partner_name ASC
    LIMIT $7::int
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], args.dateStart || null, args.dateEnd || null, useRepFilter, args.limit]
  );
  return rows || [];
}

type OpenPipelineMotionRow = { motion: "direct" | "partner"; open_opps: number; open_amount: number };
type OpenPipelinePartnerRow = { partner_name: string; open_opps: number; open_amount: number };

async function loadOpenPipelineByMotion(args: {
  orgId: number;
  quotaPeriodId: string;
  dateStart?: string | null;
  dateEnd?: string | null;
  repIds: number[] | null;
}): Promise<OpenPipelineMotionRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<OpenPipelineMotionRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($4::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($5::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    base AS (
      SELECT
        CASE
          WHEN o.partner_name IS NOT NULL AND btrim(o.partner_name) <> '' THEN 'partner'
          ELSE 'direct'
        END AS motion,
        COALESCE(o.amount, 0)::float8 AS amount,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $6::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.range_start
        AND o.close_date <= qp.range_end
        AND NOT (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    )
    SELECT
      motion,
      COUNT(*)::int AS open_opps,
      SUM(amount)::float8 AS open_amount
    FROM base
    GROUP BY motion
    ORDER BY motion ASC
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], args.dateStart || null, args.dateEnd || null, useRepFilter]
  );
  return rows || [];
}

async function listOpenPipelineByPartner(args: {
  orgId: number;
  quotaPeriodId: string;
  limit: number;
  dateStart?: string | null;
  dateEnd?: string | null;
  repIds: number[] | null;
}): Promise<OpenPipelinePartnerRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<OpenPipelinePartnerRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($4::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($5::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    base AS (
      SELECT
        btrim(o.partner_name) AS partner_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $6::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.range_start
        AND o.close_date <= qp.range_end
        AND NOT (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    )
    SELECT
      partner_name,
      COUNT(*)::int AS open_opps,
      SUM(amount)::float8 AS open_amount
    FROM base
    GROUP BY partner_name
    ORDER BY open_amount DESC NULLS LAST, open_opps DESC, partner_name ASC
    LIMIT $7::int
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], args.dateStart || null, args.dateEnd || null, useRepFilter, args.limit]
  );
  return rows || [];
}

async function listTopPartnerDeals(args: {
  orgId: number;
  quotaPeriodId: string;
  outcome: "won" | "lost";
  limit: number;
  dateStart?: string | null;
  dateEnd?: string | null;
  repIds: number[] | null;
}): Promise<TopPartnerDealRow[]> {
  const wantWon = args.outcome === "won";
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<TopPartnerDealRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    )
    SELECT
      o.public_id::text AS opportunity_public_id,
      btrim(o.partner_name) AS partner_name,
      o.account_name,
      o.opportunity_name,
      o.product,
      COALESCE(o.amount, 0)::float8 AS amount,
      o.create_date::timestamptz::text AS create_date,
      o.close_date::date::text AS close_date,
      o.baseline_health_score::float8 AS baseline_health_score,
      o.health_score::float8 AS health_score
    FROM opportunities o
    JOIN qp ON TRUE
    WHERE o.org_id = $1
      AND (NOT $8::boolean OR o.rep_id = ANY($7::bigint[]))
      AND o.partner_name IS NOT NULL
      AND btrim(o.partner_name) <> ''
      AND o.close_date IS NOT NULL
      AND o.close_date >= qp.range_start
      AND o.close_date <= qp.range_end
      AND (
        CASE
          WHEN $3::boolean THEN ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          ELSE (
            ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
            OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
          )
        END
      )
    ORDER BY amount DESC NULLS LAST, o.id DESC
    LIMIT $4
    `,
    [args.orgId, args.quotaPeriodId, wantWon, args.limit, args.dateStart || null, args.dateEnd || null, args.repIds || [], useRepFilter]
  );
  return rows || [];
}

function sortDeals(list: TopPartnerDealRow[], sort: DealSortKey, dir: DealSortDir) {
  const mult = dir === "asc" ? 1 : -1;
  const v = (d: TopPartnerDealRow) => {
    if (sort === "amount") return Number(d.amount || 0) || 0;
    if (sort === "partner") return String(d.partner_name || "").toLowerCase();
    if (sort === "account") return String(d.account_name || "").toLowerCase();
    if (sort === "opportunity") return String(d.opportunity_name || "").toLowerCase();
    if (sort === "product") return String(d.product || "").toLowerCase();
    if (sort === "age") return daysBetween(d.create_date, d.close_date) ?? -1;
    if (sort === "initial_health") return Number(d.baseline_health_score ?? -1);
    return Number(d.health_score ?? -1);
  };

  return list.slice().sort((a, b) => {
    const av = v(a) as any;
    const bv = v(b) as any;
    if (typeof av === "number" && typeof bv === "number") {
      if (bv !== av) return (bv - av) * mult;
      return String(a.opportunity_public_id).localeCompare(String(b.opportunity_public_id));
    }
    const as = String(av);
    const bs = String(bv);
    if (bs !== as) return bs.localeCompare(as) * mult;
    return String(a.opportunity_public_id).localeCompare(String(b.opportunity_public_id));
  });
}

export default async function AnalyticsTopPartnersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN" && !ctx.user.admin_has_full_analytics_access) redirect("/admin");
  if (ctx.user.role !== "EXEC_MANAGER" && ctx.user.role !== "MANAGER" && ctx.user.role !== "ADMIN") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const quotaPeriodId = String(sp(searchParams.quota_period_id) || "").trim();
  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();
  const { start: start_date, end: end_date } = normalizeDateRange(String(sp(searchParams.start_date) || "").trim(), String(sp(searchParams.end_date) || "").trim());
  const won_sort = String(sp(searchParams.won_sort) || "amount").trim() as DealSortKey;
  const won_dir = String(sp(searchParams.won_dir) || "desc").trim() as DealSortDir;
  const lost_sort = String(sp(searchParams.lost_sort) || "amount").trim() as DealSortKey;
  const lost_dir = String(sp(searchParams.lost_dir) || "desc").trim() as DealSortDir;

  const fyRes = await getDistinctFiscalYears().catch(() => ({ ok: true as const, data: [] as Array<{ fiscal_year: string }> }));
  const fiscalYears = fyRes.ok ? fyRes.data : [];

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const fiscalYearValues = Array.from(new Set(allPeriods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean))).sort((a, b) => b.localeCompare(a));

  const todayIso = new Date().toISOString().slice(0, 10);
  const periodContainingToday =
    allPeriods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultYear = periodContainingToday ? String(periodContainingToday.fiscal_year) : fiscalYearValues[0] || "";
  const yearToUse = fiscal_year || defaultYear;

  const periods = yearToUse ? allPeriods.filter((p) => String(p.fiscal_year) === yearToUse) : allPeriods;
  const currentForYear = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const selected = (quotaPeriodId && periods.find((p) => String(p.id) === quotaPeriodId)) || currentForYear || periods[0] || null;

  const scope =
    ctx.user.role === "ADMIN"
      ? { allowedRepIds: null as number[] | null }
      : await getScopedRepDirectory({ orgId: ctx.user.org_id, userId: ctx.user.id, role: ctx.user.role as "EXEC_MANAGER" | "MANAGER" }).catch(() => ({
          repDirectory: [],
          allowedRepIds: [0] as number[],
          myRepId: null as number | null,
        }));
  const scopeRepIds = ctx.user.role === "ADMIN" ? null : (scope as any).allowedRepIds;

  const topWonRaw = selected
    ? await listTopPartnerDeals({
        orgId: ctx.user.org_id,
        quotaPeriodId: String(selected.id),
        outcome: "won",
        limit: 10,
        dateStart: start_date || null,
        dateEnd: end_date || null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];
  const topLostRaw = selected
    ? await listTopPartnerDeals({
        orgId: ctx.user.org_id,
        quotaPeriodId: String(selected.id),
        outcome: "lost",
        limit: 10,
        dateStart: start_date || null,
        dateEnd: end_date || null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];

  const safeSortKey = (k: string): DealSortKey =>
    k === "partner" || k === "account" || k === "opportunity" || k === "product" || k === "age" || k === "initial_health" || k === "final_health" || k === "amount"
      ? (k as DealSortKey)
      : "amount";
  const safeDir = (d: string): DealSortDir => (d === "asc" || d === "desc" ? (d as DealSortDir) : "desc");

  const wonSortKey = safeSortKey(won_sort);
  const wonDir = safeDir(won_dir);
  const lostSortKey = safeSortKey(lost_sort);
  const lostDir = safeDir(lost_dir);

  const topWon = sortDeals(topWonRaw, wonSortKey, wonDir);
  const topLost = sortDeals(topLostRaw, lostSortKey, lostDir);

  const motionStats = selected
    ? await loadMotionStats({
        orgId: ctx.user.org_id,
        quotaPeriodId: String(selected.id),
        dateStart: start_date || null,
        dateEnd: end_date || null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];
  const statsByMotion = new Map<string, MotionStatsRow>();
  for (const r of motionStats) statsByMotion.set(String(r.motion), r);
  const directStats = statsByMotion.get("direct") || null;
  const partnerStats = statsByMotion.get("partner") || null;
  const partnerSharePct =
    directStats && partnerStats
      ? (() => {
          const denom = Number(directStats.won_amount || 0) + Number(partnerStats.won_amount || 0);
          if (!Number.isFinite(denom) || denom <= 0) return null;
          return Number(partnerStats.won_amount || 0) / denom;
        })()
      : null;
  const directSharePct = partnerSharePct == null ? null : Math.max(0, Math.min(1, 1 - partnerSharePct));

  const topPartners = selected
    ? await listPartnerRollup({
        orgId: ctx.user.org_id,
        quotaPeriodId: String(selected.id),
        limit: 30,
        dateStart: start_date || null,
        dateEnd: end_date || null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];

  const prevQuotaPeriodId = (() => {
    if (!selected) return "";
    const sorted = allPeriods
      .slice()
      .sort((a, b) => String(b.period_start || "").localeCompare(String(a.period_start || "")) || Number(b.id) - Number(a.id));
    const idx = sorted.findIndex((p) => String(p.id) === String(selected.id));
    const prev = idx >= 0 ? sorted[idx + 1] || null : null;
    return prev ? String(prev.id) : "";
  })();

  const prevMotionStats = prevQuotaPeriodId
    ? await loadMotionStats({
        orgId: ctx.user.org_id,
        quotaPeriodId: prevQuotaPeriodId,
        dateStart: null,
        dateEnd: null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];
  const prevByMotion = new Map<string, MotionStatsRow>();
  for (const r of prevMotionStats) prevByMotion.set(String(r.motion), r);
  const prevDirect = prevByMotion.get("direct") || null;
  const prevPartner = prevByMotion.get("partner") || null;

  const ceiPrevPartnerIndex = (() => {
    if (!prevDirect || !prevPartner) return null;
    const directDays = prevDirect.avg_days == null ? null : Number(prevDirect.avg_days);
    const partnerDays = prevPartner.avg_days == null ? null : Number(prevPartner.avg_days);
    const directWon = Number(prevDirect.won_amount || 0) || 0;
    const partnerWon = Number(prevPartner.won_amount || 0) || 0;
    const directWin = prevDirect.win_rate == null ? null : Number(prevDirect.win_rate);
    const partnerWin = prevPartner.win_rate == null ? null : Number(prevPartner.win_rate);
    const directH = prevDirect.avg_health_score == null ? null : Number(prevDirect.avg_health_score) / 30;
    const partnerH = prevPartner.avg_health_score == null ? null : Number(prevPartner.avg_health_score) / 30;

    const RV_direct = directDays && directDays > 0 ? directWon / directDays : 0;
    const RV_partner = partnerDays && partnerDays > 0 ? partnerWon / partnerDays : 0;
    const QM_direct = directWin == null ? 0 : directH == null ? directWin : directWin * directH;
    const QM_partner = partnerWin == null ? 0 : partnerH == null ? partnerWin : partnerWin * partnerH;
    const CEI_raw_direct = RV_direct * QM_direct;
    const CEI_raw_partner = RV_partner * QM_partner;
    if (!(CEI_raw_direct > 0)) return null;
    return (CEI_raw_partner / CEI_raw_direct) * 100;
  })();

  const openByMotion = selected
    ? await loadOpenPipelineByMotion({
        orgId: ctx.user.org_id,
        quotaPeriodId: String(selected.id),
        dateStart: start_date || null,
        dateEnd: end_date || null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];
  const openMotionMap = new Map<string, OpenPipelineMotionRow>();
  for (const r of openByMotion) openMotionMap.set(String(r.motion), r);

  const openByPartner = selected
    ? await listOpenPipelineByPartner({
        orgId: ctx.user.org_id,
        quotaPeriodId: String(selected.id),
        limit: 60,
        dateStart: start_date || null,
        dateEnd: end_date || null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];
  const openPartnerMap = new Map<string, OpenPipelinePartnerRow>();
  for (const r of openByPartner) openPartnerMap.set(String(r.partner_name), r);

  type MotionScoreRow = {
    key: string;
    label: string;
    open_pipeline: number;
    win_rate: number | null;
    avg_health_01: number | null;
    avg_days: number | null;
    aov: number | null;
    deal_count: number;
    wic: number;
    wic_band: ReturnType<typeof wicBand>;
    pqs: number | null;
  };

  const directOpen = openMotionMap.get("direct")?.open_amount ?? 0;
  const partnerOpenAgg = openMotionMap.get("partner")?.open_amount ?? 0;

  const rowsForWicBase = [
    {
      key: "direct",
      label: "Direct",
      open_pipeline: Number(directOpen || 0) || 0,
      win_rate: directStats?.win_rate ?? null,
      avg_health_01: health01FromScore30(directStats?.avg_health_score ?? null),
      avg_days: directStats?.avg_days ?? null,
      aov: directStats?.aov ?? null,
      deal_count: directStats?.opps ?? 0,
    },
    ...topPartners.map((p) => ({
      key: `partner:${String(p.partner_name)}`,
      label: String(p.partner_name),
      open_pipeline: Number(openPartnerMap.get(String(p.partner_name))?.open_amount ?? 0) || 0,
      win_rate: p.win_rate ?? null,
      avg_health_01: health01FromScore30(p.avg_health_score ?? null),
      avg_days: p.avg_days ?? null,
      aov: p.aov ?? null,
      deal_count: p.opps ?? 0,
    })),
  ];

  const gcVals = rowsForWicBase.map((r) => r.open_pipeline).filter((v) => Number.isFinite(v));
  const aovValsAll = rowsForWicBase.map((r) => Number(r.aov ?? NaN)).filter((v) => Number.isFinite(v));
  const daysValsAll = rowsForWicBase.map((r) => Number(r.avg_days ?? NaN)).filter((v) => Number.isFinite(v));
  const gcMin = gcVals.length ? Math.min(...gcVals) : 0;
  const gcMax = gcVals.length ? Math.max(...gcVals) : 0;
  const aovMin = aovValsAll.length ? Math.min(...aovValsAll) : 0;
  const aovMax = aovValsAll.length ? Math.max(...aovValsAll) : 0;
  const daysMin = daysValsAll.length ? Math.min(...daysValsAll) : 0;
  const daysMax = daysValsAll.length ? Math.max(...daysValsAll) : 0;

  // Partner-only ranges (PQS canonical).
  const partnerOnly = rowsForWicBase.filter((r) => r.key.startsWith("partner:"));
  const partnerAovVals = partnerOnly.map((r) => Number(r.aov ?? NaN)).filter((v) => Number.isFinite(v));
  const partnerDaysVals = partnerOnly.map((r) => Number(r.avg_days ?? NaN)).filter((v) => Number.isFinite(v));
  const pAovMin = partnerAovVals.length ? Math.min(...partnerAovVals) : 0;
  const pAovMax = partnerAovVals.length ? Math.max(...partnerAovVals) : 0;
  const pDaysMin = partnerDaysVals.length ? Math.min(...partnerDaysVals) : 0;
  const pDaysMax = partnerDaysVals.length ? Math.max(...partnerDaysVals) : 0;

  const motionScoreRows: MotionScoreRow[] = rowsForWicBase.map((r) => {
    // STEP 2 — WIC (canonical).
    const GC = normalize(r.open_pipeline, gcMin, gcMax);
    const win = r.win_rate != null && Number.isFinite(r.win_rate) ? clamp01(r.win_rate) : null;
    const health01 = r.avg_health_01 != null && Number.isFinite(r.avg_health_01) ? clamp01(r.avg_health_01) : null;
    const WQ = win == null ? 0 : health01 == null ? win : win * health01;
    const VE = 1 - normalize(Number(r.avg_days ?? 0) || 0, daysMin, daysMax);
    const DE = normalize(Number(r.aov ?? 0) || 0, aovMin, aovMax);
    const WIC_raw = GC * 0.35 + WQ * 0.3 + VE * 0.2 + DE * 0.15;
    const WIC = clampScore100(WIC_raw * 100);

    // STEP 3 — PQS (partner only; canonical).
    let PQS: number | null = null;
    if (r.key.startsWith("partner:")) {
      const WRF = win == null ? 0 : win;
      const DSF = normalize(Number(r.aov ?? 0) || 0, pAovMin, pAovMax);
      const VP = normalize(Number(r.avg_days ?? 0) || 0, pDaysMin, pDaysMax);
      const dc = Math.max(0, Number(r.deal_count || 0) || 0);
      const CF = Math.min(1, Math.log(dc + 1) / Math.log(10));
      const PQS_raw = WRF * 0.4 + DSF * 0.25 + CF * 0.2 - VP * 0.15;
      PQS = clampScore100(PQS_raw * 100);
    }

    return {
      ...r,
      wic: WIC,
      wic_band: wicBand(WIC),
      pqs: PQS,
    };
  });

  // STEP 4 — CEI (canonical, indexed to Direct=100).
  const cei = (() => {
    const directDays = directStats?.avg_days == null ? null : Number(directStats.avg_days);
    const partnerDays = partnerStats?.avg_days == null ? null : Number(partnerStats.avg_days);
    const directWon = Number(directStats?.won_amount || 0) || 0;
    const partnerWon = Number(partnerStats?.won_amount || 0) || 0;
    const directWin = directStats?.win_rate == null ? null : clamp01(Number(directStats.win_rate));
    const partnerWin = partnerStats?.win_rate == null ? null : clamp01(Number(partnerStats.win_rate));
    const directH = health01FromScore30(directStats?.avg_health_score ?? null);
    const partnerH = health01FromScore30(partnerStats?.avg_health_score ?? null);

    const RV_direct = directDays && directDays > 0 ? directWon / directDays : 0;
    const RV_partner = partnerDays && partnerDays > 0 ? partnerWon / partnerDays : 0;
    const QM_direct = directWin == null ? 0 : directH == null ? directWin : directWin * directH;
    const QM_partner = partnerWin == null ? 0 : partnerH == null ? partnerWin : partnerWin * partnerH;
    const CEI_raw_direct = RV_direct * QM_direct;
    const CEI_raw_partner = RV_partner * QM_partner;
    const CEI_index_partner = CEI_raw_direct > 0 ? (CEI_raw_partner / CEI_raw_direct) * 100 : null;
    return { direct_index: 100, partner_index: CEI_index_partner == null ? null : Number(CEI_index_partner) };
  })();

  // STEP 5 — Auto executive narrative (one sentence).
  const executiveNarrative = (() => {
    const aovD = directStats?.aov == null ? null : Number(directStats.aov);
    const aovP = partnerStats?.aov == null ? null : Number(partnerStats.aov);
    const daysD = directStats?.avg_days == null ? null : Number(directStats.avg_days);
    const daysP = partnerStats?.avg_days == null ? null : Number(partnerStats.avg_days);
    const mix = partnerSharePct == null ? null : Math.round(Number(partnerSharePct) * 100);
    const sizeDeltaPct =
      aovD != null && aovP != null && aovD > 0 ? Math.round(((aovP - aovD) / aovD) * 100) : null;
    const velDeltaDays = daysD != null && daysP != null ? Math.round(daysP - daysD) : null;

    const sizePhrase =
      sizeDeltaPct == null
        ? "Deal size is mixed across motions"
        : sizeDeltaPct === 0
          ? "Partners and Direct are similar in deal size"
          : sizeDeltaPct > 0
            ? `Partners run ~${Math.abs(sizeDeltaPct)}% larger than Direct`
            : `Partners run ~${Math.abs(sizeDeltaPct)}% smaller than Direct`;

    const velPhrase =
      velDeltaDays == null
        ? "velocity differs by segment"
        : velDeltaDays === 0
          ? "with similar cycle time"
          : velDeltaDays > 0
            ? `but are ~${Math.abs(velDeltaDays)} days slower`
            : `but are ~${Math.abs(velDeltaDays)} days faster`;

    const mixPhrase = mix == null ? "with unclear channel contribution" : `and contribute ~${mix}% of closed-won`;

    return `${sizePhrase} ${velPhrase} ${mixPhrase} in this period.`;
  })();

  const topWonExport = topWon.map((d) => {
    const age = daysBetween(d.create_date, d.close_date);
    const i = healthExport(d.baseline_health_score);
    const f = healthExport(d.health_score);
    return {
      partner_name: d.partner_name,
      account: d.account_name || "",
      opportunity: d.opportunity_name || "",
      product: d.product || "",
      revenue: Number(d.amount || 0) || 0,
      age_days: age == null ? "" : age,
      initial_health_pct: i.pct == null ? "" : i.pct,
      initial_health_raw_30: i.raw == null ? "" : i.raw,
      final_health_pct: f.pct == null ? "" : f.pct,
      final_health_raw_30: f.raw == null ? "" : f.raw,
      create_date: d.create_date || "",
      close_date: d.close_date || "",
      opportunity_public_id: d.opportunity_public_id,
    };
  });
  const topLostExport = topLost.map((d) => {
    const age = daysBetween(d.create_date, d.close_date);
    const i = healthExport(d.baseline_health_score);
    const f = healthExport(d.health_score);
    return {
      partner_name: d.partner_name,
      account: d.account_name || "",
      opportunity: d.opportunity_name || "",
      product: d.product || "",
      revenue: Number(d.amount || 0) || 0,
      age_days: age == null ? "" : age,
      initial_health_pct: i.pct == null ? "" : i.pct,
      initial_health_raw_30: i.raw == null ? "" : i.raw,
      final_health_pct: f.pct == null ? "" : f.pct,
      final_health_raw_30: f.raw == null ? "" : f.raw,
      create_date: d.create_date || "",
      close_date: d.close_date || "",
      opportunity_public_id: d.opportunity_public_id,
    };
  });

  const healthRows = selected
    ? await getHealthAveragesByPeriods({ orgId: ctx.user.org_id, periodIds: [String(selected.id)], repIds: scopeRepIds, dateStart: start_date || null, dateEnd: end_date || null }).catch(() => [])
    : [];
  const health = (healthRows && healthRows[0]) ? (healthRows[0] as any) : null;

  const sortLabelClass = (active: boolean) => (active ? "text-yellow-700" : "");
  const sortCellClass = (active: boolean) => (active ? "bg-yellow-50 text-yellow-800" : "");

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6 num-tabular">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">Top Partners</h1>
            <p className="mt-1 text-body text-[color:var(--sf-text-secondary)]">
              Top 10 deals by revenue in the quarter (Won + Closed Loss) with a partner. Health colors match the Opportunity Score Cards view.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-sectionTitle text-[color:var(--sf-text-primary)]">Filters</h2>
          <TopDealsFiltersClient
            basePath="/analytics/partners/executive"
            fiscalYears={fiscalYearValues}
            periods={allPeriods.map((p) => ({
              id: String(p.id),
              period_name: String(p.period_name),
              period_start: String(p.period_start),
              period_end: String(p.period_end),
              fiscal_year: String(p.fiscal_year),
              fiscal_quarter: String(p.fiscal_quarter),
            }))}
            selectedFiscalYear={yearToUse}
            selectedPeriodId={selected ? String(selected.id) : ""}
            showDateRange={true}
          />
        </section>

        {selected ? <AverageHealthScorePanel row={health} /> : null}

        {selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sectionTitle text-[color:var(--sf-text-primary)]">Direct vs Partner performance (this quarter)</h2>
                <p className="mt-1 text-body text-[color:var(--sf-text-secondary)]">
                  Compares closed outcomes in the selected date range. Use this to validate “channel efficiency” and coverage decisions.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
              <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Executive narrative</div>
              <div className="mt-2 text-body font-[600] text-[color:var(--sf-text-primary)]">{executiveNarrative}</div>
            </div>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
              <table className="min-w-[980px] w-full table-auto border-collapse">
                <thead className="bg-[color:var(--sf-surface)] text-tableLabel">
                  <tr>
                    <th className="px-4 py-3 text-left">motion</th>
                    <th className="px-4 py-3 text-right"># opps</th>
                    <th className="px-4 py-3 text-right">won</th>
                    <th className="px-4 py-3 text-right">lost</th>
                    <th className="px-4 py-3 text-right">close rate</th>
                    <th className="px-4 py-3 text-right">avg health</th>
                    <th className="px-4 py-3 text-right">avg days</th>
                    <th className="px-4 py-3 text-right">AOV</th>
                    <th className="px-4 py-3 text-right">closed-won</th>
                    <th className="px-4 py-3 text-right">revenue mix</th>
                  </tr>
                </thead>
                <tbody className="text-tableValue text-[color:var(--sf-text-primary)]">
                  {[
                    { k: "Direct", r: directStats },
                    { k: "Partner", r: partnerStats },
                  ].map((row) => (
                    <tr key={row.k} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-semibold">{row.k}</td>
                      <td className="px-4 py-3 text-right num-tabular">{row.r ? String(row.r.opps) : "—"}</td>
                      <td className="px-4 py-3 text-right num-tabular">{row.r ? String(row.r.won_opps) : "—"}</td>
                      <td className="px-4 py-3 text-right num-tabular">{row.r ? String(row.r.lost_opps) : "—"}</td>
                      <td className="px-4 py-3 text-right num-tabular">{row.r ? fmtPct01(row.r.win_rate) : "—"}</td>
                      <td className="px-4 py-3 text-right num-tabular">
                        {row.r?.avg_health_score == null ? "—" : `${Math.round((Number(row.r.avg_health_score) / 30) * 100)}%`}
                      </td>
                      <td className="px-4 py-3 text-right num-tabular">{row.r?.avg_days == null ? "—" : String(Math.round(Number(row.r.avg_days)))}</td>
                      <td className="px-4 py-3 text-right num-tabular">{row.r?.aov == null ? "—" : fmtMoney(row.r.aov)}</td>
                      <td className="px-4 py-3 text-right num-tabular">{row.r ? fmtMoney(row.r.won_amount) : "—"}</td>
                      <td className="px-4 py-3 text-right num-tabular">
                        {row.k === "Direct" ? fmtPct01(directSharePct) : row.k === "Partner" ? fmtPct01(partnerSharePct) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">CRO decision engine (WIC / PQS / CEI)</div>
                  <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                    Canonical scoring models (WIC, PQS, CEI) computed from this report’s numbers. Direct is CEI baseline = 100.
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                  {(() => {
                    const ceiCur = cei.partner_index == null ? null : Number(cei.partner_index);
                    const ceiPrev = ceiPrevPartnerIndex == null ? null : Number(ceiPrevPartnerIndex);
                    const delta = ceiCur != null && ceiPrev != null ? ceiCur - ceiPrev : null;

                    const status =
                      ceiCur == null
                        ? { label: "—", tone: "muted" as const }
                        : ceiCur >= 120
                          ? { label: "HIGH", tone: "good" as const }
                          : ceiCur >= 90
                            ? { label: "MEDIUM", tone: "warn" as const }
                            : ceiCur >= 70
                              ? { label: "LOW", tone: "bad" as const }
                              : { label: "CRITICAL", tone: "bad" as const };

                    const partnerWon = partnerStats ? Number(partnerStats.won_opps || 0) || 0 : 0;
                    const sampleFactor = Math.min(1, partnerWon / 12);
                    const revenueShare = partnerSharePct == null ? 0 : Number(partnerSharePct);
                    const revenueFactor = Math.min(1, revenueShare / 0.4);
                    const volatilityFactor = delta != null ? 1 - normalize(Math.abs(delta), 0, 100) : 0.6;
                    const conf01 = sampleFactor * 0.5 + revenueFactor * 0.3 + volatilityFactor * 0.2;
                    const conf = clampScore100(conf01 * 100);
                    const confBand =
                      conf >= 75 ? "HIGH CONFIDENCE" : conf >= 50 ? "MODERATE CONFIDENCE" : conf >= 30 ? "LOW CONFIDENCE" : "PRELIMINARY";

                    const trend =
                      delta == null
                        ? { label: "—", arrow: "→", tone: "muted" as const }
                        : delta >= 15
                          ? { label: "Improving", arrow: "↑", tone: "good" as const }
                          : delta <= -15
                            ? { label: "Declining", arrow: "↓", tone: "bad" as const }
                            : { label: "Stable", arrow: "→", tone: "muted" as const };

                    return (
                      <>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">CEI Performance</div>
                        <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)]">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[color:var(--sf-text-secondary)]">CEI Status</span>
                            <span className={["inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", pillToneClass(status.tone)].join(" ")}>
                              {status.label}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[color:var(--sf-text-secondary)]">Partner CEI</span>
                            <span className="font-mono font-semibold">{ceiCur == null ? "—" : `${Math.round(ceiCur).toLocaleString()} (Direct = 100)`}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[color:var(--sf-text-secondary)]">Confidence</span>
                            <span className="font-mono font-semibold">{confBand}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[color:var(--sf-text-secondary)]">Trend</span>
                            <span
                              className={[
                                "flex items-center gap-1 font-mono font-semibold",
                                trend.tone === "good" ? "text-[#16A34A]" : trend.tone === "bad" ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]",
                              ].join(" ")}
                            >
                              <span aria-hidden="true">{trend.arrow}</span>
                              <span>{trend.label}</span>
                            </span>
                          </div>
                          <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Based on {partnerWon.toLocaleString()} partner closed-won deal(s).</div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 lg:col-span-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">WIC + PQS (top partners)</div>
                  <div className="mt-3 grid gap-2">
                    {motionScoreRows.slice(0, 1 + Math.min(15, topPartners.length)).map((r) => {
                      const pill = r.wic_band;
                      return (
                        <div key={r.key} className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">{r.label}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--sf-text-secondary)]">
                                <span>
                                  Open <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(r.open_pipeline)}</span>
                                </span>
                                <span>
                                  Win <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct01(r.win_rate)}</span>
                                </span>
                                <span>
                                  Health{" "}
                                  <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                                    {r.avg_health_01 == null ? "—" : `${Math.round(r.avg_health_01 * 100)}%`}
                                  </span>
                                </span>
                                <span>
                                  Days{" "}
                                  <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                                    {r.avg_days == null ? "—" : String(Math.round(Number(r.avg_days)))}
                                  </span>
                                </span>
                                <span>
                                  AOV{" "}
                                  <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                                    {r.aov == null ? "—" : fmtMoney(r.aov)}
                                  </span>
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <div className="grid justify-items-end">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">WIC</div>
                                <div className="font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{Math.round(r.wic).toLocaleString()}</div>
                              </div>
                              <span className={["inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", pillToneClass(pill.tone)].join(" ")}>
                                {pill.label}
                              </span>
                              <div className="grid justify-items-end">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">PQS</div>
                                <div className="font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">
                                  {r.pqs == null ? "—" : Math.round(r.pqs).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                    WIC computed for Direct + each partner. PQS computed per partner only. Scores are clamped 0–100.
                  </div>
                </div>
              </div>
            </section>

            <div className="mt-4">
              <PartnerAiStrategicTakeawayClient
                payload={{
                  page: "analytics/partners/executive",
                  quota_period: selected ? { id: String(selected.id), name: String(selected.period_name), start: dateOnly(selected.period_start), end: dateOnly(selected.period_end) } : null,
                  date_range: { start: start_date || null, end: end_date || null },
                  direct: directStats,
                  partner: partnerStats,
                  partner_mix_pct: partnerSharePct,
                  decision_engine: {
                    executive_narrative: executiveNarrative,
                    cei_performance: {
                      cei_partner_index: cei.partner_index,
                      cei_prev_partner_index: ceiPrevPartnerIndex,
                      partner_closed_won_count: partnerStats ? Number(partnerStats.won_opps || 0) || 0 : 0,
                      partner_revenue_share_pct01: partnerSharePct,
                    },
                    wic: motionScoreRows.map((r) => ({ label: r.label, wic: r.wic, band: r.wic_band.label, open_pipeline: r.open_pipeline })),
                    pqs: motionScoreRows.filter((r) => r.key.startsWith("partner:")).map((r) => ({ label: r.label, pqs: r.pqs })),
                  },
                  top_partners: topPartners,
                }}
              />
            </div>
          </section>
        ) : null}

        {!selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a `quota_period_id` to view top partner deals.</p>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Top partner deals won (top 10 by revenue)</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  Period: <span className="font-mono text-xs">{dateOnly(selected.period_start)}</span> →{" "}
                  <span className="font-mono text-xs">{dateOnly(selected.period_end)}</span>
                </p>
              </div>
              <form method="GET" action="/analytics/partners/executive" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="fiscal_year" value={yearToUse} />
                <input type="hidden" name="quota_period_id" value={String(selected.id)} />
                {start_date ? <input type="hidden" name="start_date" value={start_date} /> : null}
                {end_date ? <input type="hidden" name="end_date" value={end_date} /> : null}
                <input type="hidden" name="lost_sort" value={lostSortKey} />
                <input type="hidden" name="lost_dir" value={lostDir} />
                <div className="grid gap-1">
                  <label className="text-xs text-[color:var(--sf-text-secondary)]">Sort</label>
                  <select name="won_sort" defaultValue={wonSortKey} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm">
                    <option value="amount">Amount</option>
                    <option value="partner">Partner</option>
                    <option value="account">Account</option>
                    <option value="opportunity">Opportunity</option>
                    <option value="product">Product</option>
                    <option value="age">Age</option>
                    <option value="initial_health">Initial health</option>
                    <option value="final_health">Final health</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-[color:var(--sf-text-secondary)]">Dir</label>
                  <select name="won_dir" defaultValue={wonDir} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm">
                    <option value="desc">desc</option>
                    <option value="asc">asc</option>
                  </select>
                </div>
                <button className="h-[40px] rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                  Apply sort
                </button>
              </form>
            </div>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className={`px-4 py-3 ${sortLabelClass(wonSortKey === "partner")}`}>partner</th>
                    <th className={`px-4 py-3 ${sortLabelClass(wonSortKey === "account")}`}>account</th>
                    <th className={`px-4 py-3 ${sortLabelClass(wonSortKey === "opportunity")}`}>opportunity</th>
                    <th className={`px-4 py-3 ${sortLabelClass(wonSortKey === "product")}`}>product</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(wonSortKey === "amount")}`}>revenue</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(wonSortKey === "age")}`}>age</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(wonSortKey === "initial_health")}`}>initial health</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(wonSortKey === "final_health")}`}>final health</th>
                  </tr>
                </thead>
                <tbody>
                  {topWon.length ? (
                    topWon.map((d) => (
                      <tr key={d.opportunity_public_id} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                        <td className={`px-4 py-3 font-medium ${sortCellClass(wonSortKey === "partner")}`}>{d.partner_name}</td>
                        <td className={`px-4 py-3 ${sortCellClass(wonSortKey === "account")}`}>{d.account_name || ""}</td>
                        <td className={`px-4 py-3 ${sortCellClass(wonSortKey === "opportunity")}`}>{d.opportunity_name || ""}</td>
                        <td className={`px-4 py-3 ${sortCellClass(wonSortKey === "product")}`}>{d.product || ""}</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortCellClass(wonSortKey === "amount")}`}>{fmtMoney(d.amount)}</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortCellClass(wonSortKey === "age")}`}>
                          {daysBetween(d.create_date, d.close_date) == null ? "—" : String(daysBetween(d.create_date, d.close_date))}
                        </td>
                        <td className={`px-4 py-3 text-right ${sortCellClass(wonSortKey === "initial_health")}`}>
                          <HealthScorePill score={d.baseline_health_score} />
                        </td>
                        <td className={`px-4 py-3 text-right ${sortCellClass(wonSortKey === "final_health")}`}>
                          <HealthScorePill score={d.health_score} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                        No partner Won deals found for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end">
              <ExportToExcelButton fileName={`Top Partners Won - ${selected.period_name}`} sheets={[{ name: "Top Won", rows: topWonExport }]} />
            </div>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Closed Loss (top 10 by revenue)</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  Period: <span className="font-mono text-xs">{dateOnly(selected.period_start)}</span> →{" "}
                  <span className="font-mono text-xs">{dateOnly(selected.period_end)}</span>
                </p>
              </div>
              <form method="GET" action="/analytics/partners/executive" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="fiscal_year" value={yearToUse} />
                <input type="hidden" name="quota_period_id" value={String(selected.id)} />
                {start_date ? <input type="hidden" name="start_date" value={start_date} /> : null}
                {end_date ? <input type="hidden" name="end_date" value={end_date} /> : null}
                <input type="hidden" name="won_sort" value={wonSortKey} />
                <input type="hidden" name="won_dir" value={wonDir} />
                <div className="grid gap-1">
                  <label className="text-xs text-[color:var(--sf-text-secondary)]">Sort</label>
                  <select name="lost_sort" defaultValue={lostSortKey} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm">
                    <option value="amount">Amount</option>
                    <option value="partner">Partner</option>
                    <option value="account">Account</option>
                    <option value="opportunity">Opportunity</option>
                    <option value="product">Product</option>
                    <option value="age">Age</option>
                    <option value="initial_health">Initial health</option>
                    <option value="final_health">Final health</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-[color:var(--sf-text-secondary)]">Dir</label>
                  <select name="lost_dir" defaultValue={lostDir} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm">
                    <option value="desc">desc</option>
                    <option value="asc">asc</option>
                  </select>
                </div>
                <button className="h-[40px] rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                  Apply sort
                </button>
              </form>
            </div>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className={`px-4 py-3 ${sortLabelClass(lostSortKey === "partner")}`}>partner</th>
                    <th className={`px-4 py-3 ${sortLabelClass(lostSortKey === "account")}`}>account</th>
                    <th className={`px-4 py-3 ${sortLabelClass(lostSortKey === "opportunity")}`}>opportunity</th>
                    <th className={`px-4 py-3 ${sortLabelClass(lostSortKey === "product")}`}>product</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(lostSortKey === "amount")}`}>revenue</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(lostSortKey === "age")}`}>age</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(lostSortKey === "initial_health")}`}>initial health</th>
                    <th className={`px-4 py-3 text-right ${sortLabelClass(lostSortKey === "final_health")}`}>final health</th>
                  </tr>
                </thead>
                <tbody>
                  {topLost.length ? (
                    topLost.map((d) => (
                      <tr key={d.opportunity_public_id} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                        <td className={`px-4 py-3 font-medium ${sortCellClass(lostSortKey === "partner")}`}>{d.partner_name}</td>
                        <td className={`px-4 py-3 ${sortCellClass(lostSortKey === "account")}`}>{d.account_name || ""}</td>
                        <td className={`px-4 py-3 ${sortCellClass(lostSortKey === "opportunity")}`}>{d.opportunity_name || ""}</td>
                        <td className={`px-4 py-3 ${sortCellClass(lostSortKey === "product")}`}>{d.product || ""}</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortCellClass(lostSortKey === "amount")}`}>{fmtMoney(d.amount)}</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortCellClass(lostSortKey === "age")}`}>
                          {daysBetween(d.create_date, d.close_date) == null ? "—" : String(daysBetween(d.create_date, d.close_date))}
                        </td>
                        <td className={`px-4 py-3 text-right ${sortCellClass(lostSortKey === "initial_health")}`}>
                          <HealthScorePill score={d.baseline_health_score} />
                        </td>
                        <td className={`px-4 py-3 text-right ${sortCellClass(lostSortKey === "final_health")}`}>
                          <HealthScorePill score={d.health_score} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                        No partner Closed Loss deals found for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end">
              <ExportToExcelButton fileName={`Top Partners Closed Loss - ${selected.period_name}`} sheets={[{ name: "Top Closed Loss", rows: topLostExport }]} />
            </div>
          </section>
        ) : null}

        {selected ? (
          <div className="mt-5">
            <AiSummaryReportClient
              entries={[
                { label: "Partner executive takeaways", surface: "partners_executive", quotaPeriodId: String(selected.id) },
              ]}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

