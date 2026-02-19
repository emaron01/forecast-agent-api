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
  if (ctx.user.role !== "EXEC_MANAGER" && ctx.user.role !== "ADMIN") redirect("/dashboard");

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
      : await getScopedRepDirectory({ orgId: ctx.user.org_id, userId: ctx.user.id, role: "EXEC_MANAGER" }).catch(() => ({
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

  const topPartners = selected
    ? await listPartnerRollup({
        orgId: ctx.user.org_id,
        quotaPeriodId: String(selected.id),
        limit: 15,
        dateStart: start_date || null,
        dateEnd: end_date || null,
        repIds: scopeRepIds,
      }).catch(() => [])
    : [];

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
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Top Partners</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
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
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
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
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Direct vs Partner performance (this quarter)</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  Compares closed outcomes in the selected date range. Use this to validate “channel efficiency” and coverage decisions.
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
              <table className="min-w-[980px] w-full table-auto border-collapse text-sm">
                <thead className="bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3 text-left">motion</th>
                    <th className="px-4 py-3 text-right"># opps</th>
                    <th className="px-4 py-3 text-right">won</th>
                    <th className="px-4 py-3 text-right">lost</th>
                    <th className="px-4 py-3 text-right">close rate</th>
                    <th className="px-4 py-3 text-right">avg days</th>
                    <th className="px-4 py-3 text-right">AOV</th>
                    <th className="px-4 py-3 text-right">closed-won</th>
                    <th className="px-4 py-3 text-right">partner mix</th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--sf-text-primary)]">
                  {[
                    { k: "Direct", r: directStats },
                    { k: "Partner", r: partnerStats },
                  ].map((row) => (
                    <tr key={row.k} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-semibold">{row.k}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.r ? String(row.r.opps) : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.r ? String(row.r.won_opps) : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.r ? String(row.r.lost_opps) : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.r ? fmtPct01(row.r.win_rate) : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.r?.avg_days == null ? "—" : String(Math.round(Number(row.r.avg_days)))}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.r?.aov == null ? "—" : fmtMoney(row.r.aov)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.r ? fmtMoney(row.r.won_amount) : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.k === "Partner" ? fmtPct01(partnerSharePct) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <PartnerAiStrategicTakeawayClient
                payload={{
                  page: "analytics/partners/executive",
                  quota_period: selected ? { id: String(selected.id), name: String(selected.period_name), start: dateOnly(selected.period_start), end: dateOnly(selected.period_end) } : null,
                  date_range: { start: start_date || null, end: end_date || null },
                  direct: directStats,
                  partner: partnerStats,
                  partner_mix_pct: partnerSharePct,
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
      </main>
    </div>
  );
}

