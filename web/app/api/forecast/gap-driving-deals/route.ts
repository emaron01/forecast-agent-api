import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";
import { getVisibleUsers } from "../../../../lib/db";
import { resolvePublicId, zPublicId } from "../../../../lib/publicId";
import { getForecastStageProbabilities } from "../../../../lib/forecastStageProbabilities";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function parseBool(raw: string | null) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function normalizeNameKey(s: any) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v: number, lo: number, hi: number) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function healthPctFromScore30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clamp(Math.round((n / 30) * 100), 0, 100);
}

function computeAiFromHealthScore(healthScore: any): "Commit" | "Best Case" | "Pipeline" | null {
  const n = Number(healthScore);
  if (!Number.isFinite(n)) return null;
  if (n >= 24) return "Commit";
  if (n >= 18) return "Best Case";
  return "Pipeline";
}

type ScoreLabelMap = Record<string, Record<number, string>>;

async function loadScoreLabelMap(orgId: number): Promise<ScoreLabelMap> {
  // Best-effort: some environments use global score_definitions without org_id.
  try {
    const { rows } = await pool.query<{ category: string; score: number; label: string | null }>(
      `
      SELECT category, score, label
        FROM score_definitions
       WHERE org_id = $1::bigint
       ORDER BY category ASC, score ASC
      `,
      [orgId]
    );
    const out: ScoreLabelMap = {};
    for (const r of rows || []) {
      const cat = String(r.category || "").trim();
      const score = Number(r.score);
      const label = String(r.label || "").trim();
      if (!cat || !Number.isFinite(score)) continue;
      if (!out[cat]) out[cat] = {};
      out[cat][score] = label;
    }
    return out;
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code !== "42703" && code !== "42P01") throw e; // undefined_column | undefined_table
  }

  try {
    const { rows } = await pool.query<{ category: string; score: number; label: string | null }>(
      `
      SELECT category, score, label
        FROM score_definitions
       ORDER BY category ASC, score ASC
      `,
      []
    );
    const out: ScoreLabelMap = {};
    for (const r of rows || []) {
      const cat = String(r.category || "").trim();
      const score = Number(r.score);
      const label = String(r.label || "").trim();
      if (!cat || !Number.isFinite(score)) continue;
      if (!out[cat]) out[cat] = {};
      out[cat][score] = label;
    }
    return out;
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "42P01") return {};
    throw e;
  }
}

type RiskCategoryKey =
  | "pain"
  | "metrics"
  | "champion"
  | "criteria"
  | "competition"
  | "timing"
  | "budget"
  | "economic_buyer"
  | "process"
  | "paper"
  | "suppressed";

const RiskCategorySchema = z.enum([
  "pain",
  "metrics",
  "champion",
  "criteria",
  "competition",
  "timing",
  "budget",
  "economic_buyer",
  "process",
  "paper",
  "suppressed",
]);

type DealRow = {
  id: string; // public_id text
  rep_id: string | null;
  rep_public_id: string | null;
  rep_name: string | null;
  account_name: string | null;
  opportunity_name: string | null;
  amount: number | null;
  close_date: string | null;
  forecast_stage: string | null;
  crm_bucket: "commit" | "best_case" | "pipeline" | null;
  health_score: number | null;
  suppression: boolean;
  probability_modifier: number;
  health_modifier: number;
  risk_summary: string | null;
  next_steps: string | null;
  pain_score: number | null;
  metrics_score: number | null;
  champion_score: number | null;
  eb_score: number | null;
  paper_score: number | null;
  process_score: number | null;
  criteria_score: number | null;
  competition_score: number | null;
  timing_score: number | null;
  budget_score: number | null;
  pain_summary: string | null;
  metrics_summary: string | null;
  champion_summary: string | null;
  eb_summary: string | null;
  paper_summary: string | null;
  process_summary: string | null;
  criteria_summary: string | null;
  competition_summary: string | null;
  timing_summary: string | null;
  budget_summary: string | null;
  pain_tip: string | null;
  metrics_tip: string | null;
  champion_tip: string | null;
  eb_tip: string | null;
  paper_tip: string | null;
  process_tip: string | null;
  criteria_tip: string | null;
  competition_tip: string | null;
  timing_tip: string | null;
  budget_tip: string | null;
};

function bucketLabel(b: DealRow["crm_bucket"]) {
  if (b === "commit") return "Commit";
  if (b === "best_case") return "Best Case";
  if (b === "pipeline") return "Pipeline";
  return "Pipeline";
}

function stageProbabilityForBucket(probs: { commit: number; best_case: number; pipeline: number }, b: DealRow["crm_bucket"]) {
  if (b === "commit") return probs.commit;
  if (b === "best_case") return probs.best_case;
  return probs.pipeline;
}

function scoreAsInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i;
}

function isRiskScore(score: number | null) {
  // Deterministic heuristic:
  // - 0 / null: not established => risk
  // - 1: weak => risk
  // - 2/3: acceptable
  if (score == null) return true;
  if (!Number.isFinite(score)) return true;
  return score <= 1;
}

function labelForScore(labels: ScoreLabelMap, category: RiskCategoryKey, score: number | null) {
  const s = score == null ? null : scoreAsInt(score);
  if (s == null) return "";
  const byScore = labels?.[category];
  const label = byScore ? String(byScore[s] || "").trim() : "";
  return label;
}

type RiskFlag = {
  key: RiskCategoryKey;
  label: string;
  tip: string | null;
};

function extractRiskFlags(deal: DealRow, labels: ScoreLabelMap): RiskFlag[] {
  const out: RiskFlag[] = [];

  const push = (key: RiskCategoryKey, displayName: string, score: number | null, tip: string | null) => {
    if (!isRiskScore(score)) return;
    const lbl = labelForScore(labels, key, score);
    const scorePart = score == null ? "unscored" : `score ${scoreAsInt(score) ?? score}`;
    const labelPart = lbl ? lbl : scorePart;
    out.push({
      key,
      label: `${displayName}: ${labelPart}`,
      tip: tip && String(tip).trim() ? String(tip).trim() : null,
    });
  };

  if (deal.suppression) {
    out.push({
      key: "suppressed",
      label: "Suppressed: excluded by health score rules",
      tip: "Deal is suppressed by health score rules for this CRM bucket.",
    });
  }

  push("economic_buyer", "Economic Buyer", deal.eb_score, deal.eb_tip);
  push("paper", "Paper Process", deal.paper_score, deal.paper_tip);
  push("champion", "Internal Sponsor", deal.champion_score, deal.champion_tip);
  push("process", "Decision Process", deal.process_score, deal.process_tip);
  push("timing", "Timing", deal.timing_score, deal.timing_tip);
  push("criteria", "Criteria", deal.criteria_score, deal.criteria_tip);
  push("competition", "Competition", deal.competition_score, deal.competition_tip);
  push("budget", "Budget", deal.budget_score, deal.budget_tip);
  push("pain", "Pain", deal.pain_score, deal.pain_tip);
  push("metrics", "Metrics", deal.metrics_score, deal.metrics_tip);

  return out;
}

function uniqueNonEmpty(lines: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines || []) {
    const s = String(raw || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

type MeddpiccCategoryKey =
  | "pain"
  | "metrics"
  | "champion"
  | "economic_buyer"
  | "criteria"
  | "process"
  | "paper"
  | "competition"
  | "timing"
  | "budget";

type MeddpiccCategoryRow = {
  key: MeddpiccCategoryKey;
  score: number | null;
  score_label: string;
  tip: string | null;
  evidence: string | null;
};

function cleanText(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function buildMeddpiccCategories(deal: DealRow, labels: ScoreLabelMap): MeddpiccCategoryRow[] {
  const scoreLabel = (key: MeddpiccCategoryKey, score: number | null) => {
    const lbl = labelForScore(labels, key as any, score);
    return lbl || "";
  };

  return [
    { key: "pain", score: deal.pain_score, score_label: scoreLabel("pain", deal.pain_score), tip: cleanText(deal.pain_tip), evidence: cleanText(deal.pain_summary) },
    { key: "metrics", score: deal.metrics_score, score_label: scoreLabel("metrics", deal.metrics_score), tip: cleanText(deal.metrics_tip), evidence: cleanText(deal.metrics_summary) },
    { key: "champion", score: deal.champion_score, score_label: scoreLabel("champion", deal.champion_score), tip: cleanText(deal.champion_tip), evidence: cleanText(deal.champion_summary) },
    { key: "criteria", score: deal.criteria_score, score_label: scoreLabel("criteria", deal.criteria_score), tip: cleanText(deal.criteria_tip), evidence: cleanText(deal.criteria_summary) },
    { key: "competition", score: deal.competition_score, score_label: scoreLabel("competition", deal.competition_score), tip: cleanText(deal.competition_tip), evidence: cleanText(deal.competition_summary) },
    { key: "timing", score: deal.timing_score, score_label: scoreLabel("timing", deal.timing_score), tip: cleanText(deal.timing_tip), evidence: cleanText(deal.timing_summary) },
    { key: "budget", score: deal.budget_score, score_label: scoreLabel("budget", deal.budget_score), tip: cleanText(deal.budget_tip), evidence: cleanText(deal.budget_summary) },
    { key: "economic_buyer", score: deal.eb_score, score_label: scoreLabel("economic_buyer", deal.eb_score), tip: cleanText(deal.eb_tip), evidence: cleanText(deal.eb_summary) },
    { key: "process", score: deal.process_score, score_label: scoreLabel("process", deal.process_score), tip: cleanText(deal.process_tip), evidence: cleanText(deal.process_summary) },
    { key: "paper", score: deal.paper_score, score_label: scoreLabel("paper", deal.paper_score), tip: cleanText(deal.paper_tip), evidence: cleanText(deal.paper_summary) },
  ];
}

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return jsonError(401, "Unauthorized");
    if (auth.kind !== "user") return jsonError(403, "Forbidden");

    const url = new URL(req.url);
    const quotaPeriodIdRaw = String(url.searchParams.get("quota_period_id") || "").trim();

    const repPublicId = zPublicId.optional().catch(undefined).parse(
      String(url.searchParams.get("rep_public_id") || url.searchParams.get("repPublicId") || "").trim() || undefined
    );
    const repNameLike = String(url.searchParams.get("rep_name") || "").trim();

    const stageFilter = z
      .enum(["Commit", "Best Case", "Pipeline"])
      .optional()
      .catch(undefined)
      .parse(String(url.searchParams.get("stage") || "").trim() || undefined);

    const bucketCommitParam = url.searchParams.get("bucket_commit");
    const bucketBestCaseParam = url.searchParams.get("bucket_best_case");
    const bucketPipelineParam = url.searchParams.get("bucket_pipeline");
    const hasBucketParams = bucketCommitParam != null || bucketBestCaseParam != null || bucketPipelineParam != null;
    const bucketCommit = hasBucketParams ? parseBool(bucketCommitParam) : null;
    const bucketBestCase = hasBucketParams ? parseBool(bucketBestCaseParam) : null;
    const bucketPipeline = hasBucketParams ? parseBool(bucketPipelineParam) : null;

    const hiEnabledParam = url.searchParams.get("hi_enabled");
    const hiEnabled = hiEnabledParam == null ? null : parseBool(hiEnabledParam);
    const hiCommitHealthLt = z.coerce.number().min(0).max(30).optional().catch(undefined).parse(url.searchParams.get("hi_commit_health_lt"));
    const hiBestCaseSuppressed = parseBool(url.searchParams.get("hi_best_case_suppressed"));
    const hiEbMax = z.coerce.number().int().min(0).max(3).optional().catch(undefined).parse(url.searchParams.get("hi_eb_max"));
    const hiBudgetMax = z.coerce.number().int().min(0).max(3).optional().catch(undefined).parse(url.searchParams.get("hi_budget_max"));
    const hiPaperMax = z.coerce.number().int().min(0).max(3).optional().catch(undefined).parse(url.searchParams.get("hi_paper_max"));

    const riskCategory = RiskCategorySchema.optional()
      .catch(undefined)
      .parse(String(url.searchParams.get("risk_category") || url.searchParams.get("riskType") || "").trim() || undefined);

    const suppressedOnly = parseBool(url.searchParams.get("suppressed_only") || url.searchParams.get("suppressedOnly"));

    const healthMinPct = z.coerce.number().min(0).max(100).optional().catch(undefined).parse(url.searchParams.get("health_min_pct"));
    const healthMaxPct = z.coerce.number().min(0).max(100).optional().catch(undefined).parse(url.searchParams.get("health_max_pct"));

    const mode = z
      .enum(["drivers", "risk"])
      .optional()
      .catch(undefined)
      .parse(String(url.searchParams.get("mode") || "").trim() || undefined);
    const effectiveMode = mode ?? "drivers";

    const limitParamPresent = url.searchParams.has("limit");
    const limitRaw = z.coerce.number().int().min(1).max(2000).catch(200).parse(url.searchParams.get("limit"));

    const driverModeParam = url.searchParams.get("driver_mode");
    const driverMode = driverModeParam == null ? true : parseBool(driverModeParam);
    const driverTakePerBucket = z.coerce.number().int().min(1).max(200).catch(50).parse(url.searchParams.get("driver_take_per_bucket"));
    const driverMinAbsGap = z.coerce.number().min(0).catch(0).parse(url.searchParams.get("driver_min_abs_gap"));
    const driverRequireScoreEffect = (() => {
      const raw = url.searchParams.get("driver_require_score_effect");
      if (raw == null) return true;
      return parseBool(raw);
    })();

    const riskTakePerBucket = z.coerce.number().int().min(1).max(2000).catch(2000).parse(url.searchParams.get("risk_take_per_bucket"));
    const riskMinDownside = z.coerce.number().min(0).catch(0).parse(url.searchParams.get("risk_min_downside"));
    const riskRequireScoreEffect = (() => {
      const raw = url.searchParams.get("risk_require_score_effect");
      if (raw == null) return true;
      return parseBool(raw);
    })();

    // Query a larger candidate pool for both modes (unless caller explicitly sets limit).
    const limit = !limitParamPresent ? 2000 : limitRaw;

    const roleRaw = String(auth.user.role || "").trim();
    const scopedRole =
      roleRaw === "ADMIN" || roleRaw === "EXEC_MANAGER" || roleRaw === "MANAGER" || roleRaw === "REP"
        ? (roleRaw as "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP")
        : ("REP" as const);

    // IMPORTANT: Forecast summary uses getVisibleUsers() to determine visibility. To avoid mismatches
    // (missing reps, totals not lining up), this report uses the same scoping model.
    const visibleUsers = await getVisibleUsers({
      currentUserId: auth.user.id,
      orgId: auth.user.org_id,
      role: scopedRole,
      hierarchy_level: (auth.user as any).hierarchy_level,
      see_all_visibility: (auth.user as any).see_all_visibility,
    }).catch(() => []);

    const visibleRepUsers = (visibleUsers || []).filter((u: any) => u && u.role === "REP" && u.active);
    const visibleRepUserIds = Array.from(
      new Set(visibleRepUsers.map((u: any) => Number(u.id)).filter((n: number) => Number.isFinite(n) && n > 0))
    );

    const visibleRepNameKeys = Array.from(
      new Set(
        visibleRepUsers
          .flatMap((u: any) => [normalizeNameKey(u.account_owner_name || ""), normalizeNameKey(u.display_name || ""), normalizeNameKey(u.email || "")])
          .filter(Boolean)
      )
    );

    // Map visible REP users -> rep ids when possible (opportunities.rep_id is reps.id).
    const repIdsToUse =
      visibleRepUserIds.length || visibleRepNameKeys.length
        ? await pool
            .query<{ id: number }>(
              `
              SELECT DISTINCT r.id
                FROM reps r
               WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
                 AND (
                   (COALESCE(array_length($2::int[], 1), 0) > 0 AND r.user_id = ANY($2::int[]))
                   OR (
                     COALESCE(array_length($3::text[], 1), 0) > 0
                     AND (
                       lower(regexp_replace(btrim(COALESCE(r.crm_owner_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                       OR lower(regexp_replace(btrim(COALESCE(r.rep_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                       OR lower(regexp_replace(btrim(COALESCE(r.display_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                     )
                   )
                 )
              `,
              [auth.user.org_id, visibleRepUserIds, visibleRepNameKeys]
            )
            .then((r) => (r.rows || []).map((x) => Number(x.id)).filter((n) => Number.isFinite(n) && n > 0))
            .catch(() => [] as number[])
        : ([] as number[]);

    const useScopedRepIds = scopedRole !== "ADMIN";

    // Fail-closed if we can't resolve a scope for a non-admin (align with Forecast: REP sees themselves; managers see their visible reps).
    if (useScopedRepIds && repIdsToUse.length === 0 && visibleRepNameKeys.length === 0) {
      return NextResponse.json({
        ok: true,
        quota_period: null,
        totals: { crm_outlook_weighted: 0, ai_outlook_weighted: 0, gap: 0 },
        shown_totals: { crm_outlook_weighted: 0, ai_outlook_weighted: 0, gap: 0 },
        rep_context: null,
        groups: {
          commit: { deals: [], totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 }, shown_totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 } },
          best_case: { deals: [], totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 }, shown_totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 } },
          pipeline: { deals: [], totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 }, shown_totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 } },
        },
      });
    }
    const allowedRepNameKeysUniq = visibleRepNameKeys;

    // Resolve quota period id (fallback to "current" if omitted).
    const periods = await pool
      .query<{
        id: string;
        period_start: string;
        period_end: string;
        period_name: string;
        fiscal_year: string;
        fiscal_quarter: string;
      }>(
        `
        SELECT
          id::text AS id,
          period_start::text AS period_start,
          period_end::text AS period_end,
          period_name,
          fiscal_year,
          fiscal_quarter::text AS fiscal_quarter
        FROM quota_periods
        WHERE org_id = $1::bigint
        ORDER BY period_start DESC, id DESC
        `,
        [auth.user.org_id]
      )
      .then((r) => r.rows || [])
      .catch(() => []);

    const todayIso = new Date().toISOString().slice(0, 10);
    const containingToday = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
    const defaultQuotaPeriodId = String(containingToday?.id || periods?.[0]?.id || "").trim();
    const quotaPeriodId = z
      .string()
      .regex(/^\d+$/)
      .optional()
      .catch(undefined)
      .parse(quotaPeriodIdRaw || defaultQuotaPeriodId || undefined);
    if (!quotaPeriodId) return jsonError(400, "Missing quota_period_id");

    const qp = periods.find((p) => String(p.id) === String(quotaPeriodId)) || null;

    const probs = await getForecastStageProbabilities({ orgId: auth.user.org_id }).catch(() => ({
      commit: 0.8,
      best_case: 0.325,
      pipeline: 0.1,
    }));

    const labels = await loadScoreLabelMap(auth.user.org_id).catch(() => ({} as ScoreLabelMap));

    const requestedRepId = repPublicId ? await resolvePublicId("reps", repPublicId).catch(() => 0) : 0;
    const repIdFilter = requestedRepId > 0 ? requestedRepId : null;

    // Enforce visibility scope for rep_public_id selection.
    if (repIdFilter && useScopedRepIds && repIdsToUse.length && !repIdsToUse.includes(repIdFilter)) {
      // Return empty (avoid leaking existence).
      return NextResponse.json({
        ok: true,
        quota_period: qp,
        totals: { crm_outlook_weighted: 0, ai_outlook_weighted: 0, gap: 0 },
        rep_context: null,
        groups: { commit: { deals: [], totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 } }, best_case: { deals: [], totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 } }, pipeline: { deals: [], totals: { crm_weighted: 0, ai_weighted: 0, gap: 0 } } },
      });
    }

    // Compute health-score bounds (0..30) from pct filters if provided.
    const hsMin = healthMinPct == null ? null : (healthMinPct / 100) * 30;
    const hsMax = healthMaxPct == null ? null : (healthMaxPct / 100) * 30;

    const requestedBucket =
      stageFilter === "Commit" ? "commit" : stageFilter === "Best Case" ? "best_case" : stageFilter === "Pipeline" ? "pipeline" : null;

    const bucketList = (() => {
      // If explicit bucket params exist, use them; otherwise:
      // - if stageFilter exists, use it
      // - else default to Commit + Best Case (per report default)
      const list: Array<"commit" | "best_case" | "pipeline"> = [];
      if (hasBucketParams) {
        if (bucketCommit) list.push("commit");
        if (bucketBestCase) list.push("best_case");
        if (bucketPipeline) list.push("pipeline");
        return list;
      }
      if (requestedBucket) return [requestedBucket];
      return ["commit", "best_case"];
    })();

    // High-risk OR rules (optional). These are no longer the default criteria.
    const hiOn = hiEnabled ?? false;
    const hiCfg = {
      commit_health_lt: hiCommitHealthLt ?? null,
      best_case_suppressed: hiBestCaseSuppressed || false,
      eb_max: hiEbMax ?? null,
      budget_max: hiBudgetMax ?? null,
      paper_max: hiPaperMax ?? null,
    };

    // NOTE: risk_category filtering is applied after we compute risk flags (JS-level),
    // because risk is derived from multiple fields + score_definitions.

    const queryWithRules = async () => {
      return await pool.query<DealRow>(
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
          o.public_id::text AS id,
          o.rep_id::text AS rep_id,
          r.public_id::text AS rep_public_id,
          o.rep_name,
          o.account_name,
          o.opportunity_name,
          COALESCE(o.amount, 0)::float8 AS amount,
          o.close_date::text AS close_date,
          o.forecast_stage,
          o.health_score,
          o.risk_summary,
          o.next_steps,
          o.pain_score, o.metrics_score, o.champion_score, o.eb_score, o.paper_score, o.process_score,
          o.criteria_score, o.competition_score, o.timing_score, o.budget_score,
          o.pain_summary, o.metrics_summary, o.champion_summary, o.eb_summary, o.paper_summary, o.process_summary,
          o.criteria_summary, o.competition_summary, o.timing_summary, o.budget_summary,
          o.pain_tip, o.metrics_tip, o.champion_tip, o.eb_tip, o.paper_tip, o.process_tip,
          o.criteria_tip, o.competition_tip, o.timing_tip, o.budget_tip,
          lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
              '[^a-zA-Z]+',
              ' ',
              'g'
            )
          ) AS fs
        FROM opportunities o
        JOIN qp ON TRUE
        LEFT JOIN reps r
          ON COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
         AND r.id = o.rep_id
        WHERE o.org_id = $1::bigint
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          AND (
            NOT $3::boolean
            OR (
              (o.rep_id IS NOT NULL AND o.rep_id = ANY($4::bigint[]))
              OR (
                COALESCE(array_length($19::text[], 1), 0) > 0
                AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($19::text[])
              )
            )
          )
          AND ($5::bigint IS NULL OR o.rep_id = $5::bigint)
          AND ($6::text IS NULL OR btrim(COALESCE(o.rep_name, '')) ILIKE $6::text)
      ),
      classified AS (
        SELECT
          b.*,
          (NOT ((' ' || b.fs || ' ') LIKE '% won %')
            AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
            AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
            AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
          ) AS is_open,
          CASE
            WHEN (NOT ((' ' || b.fs || ' ') LIKE '% won %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
            ) AND b.fs LIKE '%commit%' THEN 'commit'
            WHEN (NOT ((' ' || b.fs || ' ') LIKE '% won %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
            ) AND b.fs LIKE '%best%' THEN 'best_case'
            WHEN (NOT ((' ' || b.fs || ' ') LIKE '% won %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
            ) THEN 'pipeline'
            ELSE NULL
          END AS crm_bucket
        FROM base b
      ),
      open_only AS (
        SELECT *
          FROM classified
         WHERE is_open = TRUE
           AND (COALESCE(array_length($7::text[], 1), 0) = 0 OR crm_bucket = ANY($7::text[]))
           AND ($8::float8 IS NULL OR health_score IS NOT NULL AND health_score >= $8::float8)
           AND ($9::float8 IS NULL OR health_score IS NOT NULL AND health_score <= $9::float8)
      ),
      with_rules AS (
        SELECT
          o.*,
          COALESCE(hr.suppression, FALSE) AS suppression,
          COALESCE(hr.probability_modifier, 1.0)::float8 AS probability_modifier
        FROM open_only o
        LEFT JOIN LATERAL (
          SELECT suppression, probability_modifier
            FROM health_score_rules
           WHERE org_id = $1::int
             AND o.crm_bucket IS NOT NULL
             AND mapped_category = CASE
               WHEN o.crm_bucket = 'commit' THEN 'Commit'
               WHEN o.crm_bucket = 'best_case' THEN 'Best Case'
               WHEN o.crm_bucket = 'pipeline' THEN 'Pipeline'
               ELSE mapped_category
             END
             AND o.health_score IS NOT NULL
             AND o.health_score >= min_score
             AND o.health_score <= max_score
           ORDER BY min_score DESC, max_score ASC, id ASC
           LIMIT 1
        ) hr ON TRUE
      ),
      modded AS (
        SELECT
          *,
          CASE WHEN suppression THEN 0.0::float8 ELSE COALESCE(probability_modifier, 1.0)::float8 END AS health_modifier
        FROM with_rules
      )
      SELECT
        id,
        rep_id,
        rep_public_id,
        rep_name,
        account_name,
        opportunity_name,
        amount,
        close_date,
        forecast_stage,
        crm_bucket,
        health_score,
        suppression,
        probability_modifier,
        health_modifier,
        risk_summary,
        next_steps,
        pain_score, metrics_score, champion_score, eb_score, paper_score, process_score,
        criteria_score, competition_score, timing_score, budget_score,
        pain_summary, metrics_summary, champion_summary, eb_summary, paper_summary, process_summary,
        criteria_summary, competition_summary, timing_summary, budget_summary,
        pain_tip, metrics_tip, champion_tip, eb_tip, paper_tip, process_tip,
        criteria_tip, competition_tip, timing_tip, budget_tip
      FROM modded
      WHERE (NOT $10::boolean OR suppression IS TRUE)
        AND (
          NOT $12::boolean
          OR (
            (
              $13::float8 IS NOT NULL
              AND crm_bucket = 'commit'
              AND health_score IS NOT NULL
              AND health_score < $13::float8
            )
            OR (
              $14::boolean IS TRUE
              AND crm_bucket = 'best_case'
              AND suppression IS TRUE
            )
            OR (
              $15::int IS NOT NULL
              AND (eb_score IS NULL OR eb_score <= $15::int)
            )
            OR (
              $16::int IS NOT NULL
              AND (budget_score IS NULL OR budget_score <= $16::int)
            )
            OR (
              $17::int IS NOT NULL
              AND (paper_score IS NULL OR paper_score <= $17::int)
            )
          )
        )
      ORDER BY
        CASE WHEN $18::boolean THEN amount END DESC NULLS LAST,
        close_date ASC NULLS LAST,
        amount DESC NULLS LAST,
        id ASC
      LIMIT $11::int
        `,
        [
          auth.user.org_id,
          quotaPeriodId,
          useScopedRepIds, // $3 useScopedRepIds
          repIdsToUse, // $4 scoped list (ignored when $3=false)
          repIdFilter, // $5
          repNameLike ? `%${repNameLike}%` : null, // $6
          bucketList, // $7
          hsMin == null ? null : Number(hsMin), // $8
          hsMax == null ? null : Number(hsMax), // $9
          suppressedOnly, // $10
          limit, // $11
          hiOn, // $12
          hiCfg.commit_health_lt == null ? null : Number(hiCfg.commit_health_lt), // $13
          !!hiCfg.best_case_suppressed, // $14
          hiCfg.eb_max == null ? null : Number(hiCfg.eb_max), // $15
          hiCfg.budget_max == null ? null : Number(hiCfg.budget_max), // $16
          hiCfg.paper_max == null ? null : Number(hiCfg.paper_max), // $17
          effectiveMode === "drivers" || effectiveMode === "risk", // $18
          allowedRepNameKeysUniq, // $19
        ]
      );
    };

    const queryWithoutRules = async () => {
      return await pool.query<DealRow>(
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
            o.public_id::text AS id,
            o.rep_id::text AS rep_id,
            r.public_id::text AS rep_public_id,
            o.rep_name,
            o.account_name,
            o.opportunity_name,
            COALESCE(o.amount, 0)::float8 AS amount,
            o.close_date::text AS close_date,
            o.forecast_stage,
            o.health_score,
            o.risk_summary,
            o.next_steps,
            o.pain_score, o.metrics_score, o.champion_score, o.eb_score, o.paper_score, o.process_score,
            o.criteria_score, o.competition_score, o.timing_score, o.budget_score,
            o.pain_summary, o.metrics_summary, o.champion_summary, o.eb_summary, o.paper_summary, o.process_summary,
            o.criteria_summary, o.competition_summary, o.timing_summary, o.budget_summary,
            o.pain_tip, o.metrics_tip, o.champion_tip, o.eb_tip, o.paper_tip, o.process_tip,
            o.criteria_tip, o.competition_tip, o.timing_tip, o.budget_tip,
            lower(
              regexp_replace(
                COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                '[^a-zA-Z]+',
                ' ',
                'g'
              )
            ) AS fs
          FROM opportunities o
          JOIN qp ON TRUE
          LEFT JOIN reps r
            ON COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
           AND r.id = o.rep_id
          WHERE o.org_id = $1::bigint
            AND o.close_date IS NOT NULL
            AND o.close_date >= qp.period_start
            AND o.close_date <= qp.period_end
            AND (
              NOT $3::boolean
              OR (
                (o.rep_id IS NOT NULL AND o.rep_id = ANY($4::bigint[]))
                OR (
                  COALESCE(array_length($19::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($19::text[])
                )
              )
            )
            AND ($5::bigint IS NULL OR o.rep_id = $5::bigint)
            AND ($6::text IS NULL OR btrim(COALESCE(o.rep_name, '')) ILIKE $6::text)
        ),
        classified AS (
          SELECT
            b.*,
            (NOT ((' ' || b.fs || ' ') LIKE '% won %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
              AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
            ) AS is_open,
            CASE
              WHEN (NOT ((' ' || b.fs || ' ') LIKE '% won %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
              ) AND b.fs LIKE '%commit%' THEN 'commit'
              WHEN (NOT ((' ' || b.fs || ' ') LIKE '% won %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
              ) AND b.fs LIKE '%best%' THEN 'best_case'
              WHEN (NOT ((' ' || b.fs || ' ') LIKE '% won %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% lost %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% loss %')
                AND NOT ((' ' || b.fs || ' ') LIKE '% closed %')
              ) THEN 'pipeline'
              ELSE NULL
            END AS crm_bucket
          FROM base b
        ),
        open_only AS (
          SELECT *
            FROM classified
           WHERE is_open = TRUE
             AND (COALESCE(array_length($7::text[], 1), 0) = 0 OR crm_bucket = ANY($7::text[]))
             AND ($8::float8 IS NULL OR health_score IS NOT NULL AND health_score >= $8::float8)
             AND ($9::float8 IS NULL OR health_score IS NOT NULL AND health_score <= $9::float8)
        )
        SELECT
          id,
          rep_id,
          rep_public_id,
          rep_name,
          account_name,
          opportunity_name,
          amount,
          close_date,
          forecast_stage,
          crm_bucket,
          health_score,
          FALSE AS suppression,
          1.0::float8 AS probability_modifier,
          1.0::float8 AS health_modifier,
          risk_summary,
          next_steps,
          pain_score, metrics_score, champion_score, eb_score, paper_score, process_score,
          criteria_score, competition_score, timing_score, budget_score,
          pain_summary, metrics_summary, champion_summary, eb_summary, paper_summary, process_summary,
          criteria_summary, competition_summary, timing_summary, budget_summary,
          pain_tip, metrics_tip, champion_tip, eb_tip, paper_tip, process_tip,
          criteria_tip, competition_tip, timing_tip, budget_tip
        FROM open_only
        WHERE (NOT $10::boolean OR FALSE)
          AND (
            NOT $12::boolean
            OR (
              (
                $13::float8 IS NOT NULL
                AND crm_bucket = 'commit'
                AND health_score IS NOT NULL
                AND health_score < $13::float8
              )
              OR (
                $14::boolean IS TRUE
                AND crm_bucket = 'best_case'
                AND FALSE
              )
              OR (
                $15::int IS NOT NULL
                AND (eb_score IS NULL OR eb_score <= $15::int)
              )
              OR (
                $16::int IS NOT NULL
                AND (budget_score IS NULL OR budget_score <= $16::int)
              )
              OR (
                $17::int IS NOT NULL
                AND (paper_score IS NULL OR paper_score <= $17::int)
              )
            )
          )
        ORDER BY
          CASE WHEN $18::boolean THEN amount END DESC NULLS LAST,
          close_date ASC NULLS LAST,
          amount DESC NULLS LAST,
          id ASC
        LIMIT $11::int
        `,
        [
          auth.user.org_id,
          quotaPeriodId,
          useScopedRepIds, // $3 useScopedRepIds
          repIdsToUse, // $4 scoped list (ignored when $3=false)
          repIdFilter, // $5
          repNameLike ? `%${repNameLike}%` : null, // $6
          bucketList, // $7
          hsMin == null ? null : Number(hsMin), // $8
          hsMax == null ? null : Number(hsMax), // $9
          suppressedOnly, // $10
          limit, // $11
          hiOn, // $12
          hiCfg.commit_health_lt == null ? null : Number(hiCfg.commit_health_lt), // $13
          !!hiCfg.best_case_suppressed, // $14
          hiCfg.eb_max == null ? null : Number(hiCfg.eb_max), // $15
          hiCfg.budget_max == null ? null : Number(hiCfg.budget_max), // $16
          hiCfg.paper_max == null ? null : Number(hiCfg.paper_max), // $17
          effectiveMode === "drivers" || effectiveMode === "risk", // $18
          allowedRepNameKeysUniq, // $19
        ]
      );
    };

    let deals: DealRow[] = [];
    try {
      const { rows } = await queryWithRules();
      deals = (rows || []) as DealRow[];
    } catch (e: any) {
      // Fallback: if health_score_rules isn't present yet, treat Verdict = CRM (modifier=1.0).
      const code = String(e?.code || "");
      if (code === "42P01") {
        const { rows } = await queryWithoutRules();
        deals = (rows || []) as DealRow[];
      } else {
        throw e;
      }
    }

    type DealOut = {
      id: string;
      rep: { rep_id: string | null; rep_public_id: string | null; rep_name: string | null };
      deal_name: { account_name: string | null; opportunity_name: string | null };
      close_date: string | null;
      crm_stage: { forecast_stage: string | null; bucket: "commit" | "best_case" | "pipeline" | null; label: string };
      ai_verdict_stage: "Commit" | "Best Case" | "Pipeline" | null;
      amount: number;
      health: {
        health_score: number | null;
        health_pct: number | null;
        suppression: boolean;
        probability_modifier: number;
        health_modifier: number;
      };
      weighted: {
        stage_probability: number;
        crm_weighted: number;
        ai_weighted: number;
        gap: number;
      };
      meddpicc_tb: MeddpiccCategoryRow[];
      signals: {
        risk_summary: string | null;
        next_steps: string | null;
      };
      risk_flags: RiskFlag[];
      coaching_insights: string[];
    };

    const enriched: DealOut[] = deals.map((d) => {
      const stageProb = stageProbabilityForBucket(probs, d.crm_bucket);
      const amount = n0(d.amount);
      const crmWeighted = amount * stageProb;
      const aiWeighted = amount * stageProb * n0(d.health_modifier);
      const gap = aiWeighted - crmWeighted;

      const riskFlags = extractRiskFlags(d, labels);
      const coaching = uniqueNonEmpty(riskFlags.map((r) => r.tip));
      const categories = buildMeddpiccCategories(d, labels);

      return {
        id: String(d.id),
        rep: {
          rep_id: d.rep_id,
          rep_public_id: d.rep_public_id,
          rep_name: d.rep_name,
        },
        deal_name: {
          account_name: d.account_name,
          opportunity_name: d.opportunity_name,
        },
        close_date: d.close_date,
        crm_stage: {
          forecast_stage: d.forecast_stage,
          bucket: d.crm_bucket,
          label: bucketLabel(d.crm_bucket),
        },
        ai_verdict_stage: computeAiFromHealthScore(d.health_score),
        amount,
        health: {
          health_score: d.health_score,
          health_pct: healthPctFromScore30(d.health_score),
          suppression: !!d.suppression,
          probability_modifier: n0(d.probability_modifier) || 1,
          health_modifier: n0(d.health_modifier) || 1,
        },
        weighted: {
          stage_probability: stageProb,
          crm_weighted: crmWeighted,
          ai_weighted: aiWeighted,
          gap,
        },
        meddpicc_tb: categories,
        signals: {
          risk_summary: d.risk_summary,
          next_steps: d.next_steps,
        },
        risk_flags: riskFlags,
        coaching_insights: coaching,
      };
    });

    const filteredByRisk = riskCategory
      ? enriched.filter((d) => d.risk_flags.some((rf) => rf.key === riskCategory))
      : enriched;

    const groupAllFor = (bucket: "commit" | "best_case" | "pipeline") => filteredByRisk.filter((d) => d.crm_stage.bucket === bucket);

    const groupDriversFor = (bucket: "commit" | "best_case" | "pipeline", overallGap: number) => {
      const xs = groupAllFor(bucket);
      const sign = overallGap < 0 ? -1 : overallGap > 0 ? 1 : 0;
      const dir = sign === 0 ? -1 : sign; // default to "most negative" when exactly 0

      const filtered = driverMode
        ? xs.filter((d) => {
            if (!Number.isFinite(d.weighted.gap)) return false;
            if (driverMinAbsGap > 0 && Math.abs(d.weighted.gap) < driverMinAbsGap) return false;
            if (!driverRequireScoreEffect) return true;
            const hm = Number(d.health.health_modifier);
            if (!Number.isFinite(hm)) return false;
            return Math.abs(hm - 1) >= 0.01;
          })
        : xs;

      const sorted = filtered.sort((a, b) => {
        // If overall gap is negative, surface the most negative gap deals first (ascending).
        // If overall gap is positive, surface the most positive gap deals first (descending).
        return dir < 0 ? a.weighted.gap - b.weighted.gap : b.weighted.gap - a.weighted.gap;
      });

      if (!driverMode) return sorted;
      // Prefer explaining the direction of the gap (downside for negative, upside for positive).
      const dirOnly = sorted.filter((d) => {
        if (dir < 0) return d.weighted.gap < 0;
        return d.weighted.gap > 0;
      });
      const list = dirOnly.length ? dirOnly : sorted;

      // Take enough deals to explain ~90% of the directional gap (capped).
      const totalDirectionalGap = list.reduce((acc, d) => acc + (dir < 0 ? Math.min(0, d.weighted.gap) : Math.max(0, d.weighted.gap)), 0);
      const targetAbs = Math.abs(totalDirectionalGap) * 0.9;
      let cumAbs = 0;
      const out: DealOut[] = [];
      for (const d of list) {
        out.push(d);
        cumAbs += Math.abs(d.weighted.gap);
        if (targetAbs > 0 && cumAbs >= targetAbs) break;
        if (out.length >= Math.max(1, driverTakePerBucket)) break;
      }
      return out;
    };

    const groupAtRiskFor = (bucket: "commit" | "best_case" | "pipeline") => {
      const xs = groupAllFor(bucket);
      const filtered = xs.filter((d) => {
        const gap = Number(d.weighted.gap);
        const downside = Number(d.weighted.crm_weighted) - Number(d.weighted.ai_weighted);
        if (!Number.isFinite(gap) || !Number.isFinite(downside)) return false;
        if (gap >= 0) return false; // only deals that drive the outlook DOWN vs CRM
        if (riskMinDownside > 0 && downside < riskMinDownside) return false;
        if (!riskRequireScoreEffect) return true;
        const hm = Number(d.health.health_modifier);
        if (!Number.isFinite(hm)) return false;
        return hm < 0.999;
      });

      // Sort by downside descending (most negative gap first).
      const sorted = filtered.sort((a, b) => (a.weighted.gap - b.weighted.gap));
      return sorted.slice(0, Math.max(1, riskTakePerBucket));
    };

    const overallGapAll = filteredByRisk.reduce((acc, d) => acc + n0(d.weighted.gap), 0);

    const commitDeals =
      effectiveMode === "risk" ? groupAtRiskFor("commit") : groupDriversFor("commit", overallGapAll);
    const bestDeals =
      effectiveMode === "risk" ? groupAtRiskFor("best_case") : groupDriversFor("best_case", overallGapAll);
    const pipeDeals =
      effectiveMode === "risk" ? groupAtRiskFor("pipeline") : groupDriversFor("pipeline", overallGapAll);

    const sum = (xs: DealOut[], key: "crm_weighted" | "ai_weighted" | "gap") => xs.reduce((acc, d) => acc + n0(d.weighted[key]), 0);

    const universeCommit = groupAllFor("commit");
    const universeBest = groupAllFor("best_case");
    const universePipe = groupAllFor("pipeline");

    const universeCommitTotals = { crm_weighted: sum(universeCommit, "crm_weighted"), ai_weighted: sum(universeCommit, "ai_weighted"), gap: sum(universeCommit, "gap") };
    const universeBestTotals = { crm_weighted: sum(universeBest, "crm_weighted"), ai_weighted: sum(universeBest, "ai_weighted"), gap: sum(universeBest, "gap") };
    const universePipeTotals = { crm_weighted: sum(universePipe, "crm_weighted"), ai_weighted: sum(universePipe, "ai_weighted"), gap: sum(universePipe, "gap") };

    const shownCommitTotals = { crm_weighted: sum(commitDeals, "crm_weighted"), ai_weighted: sum(commitDeals, "ai_weighted"), gap: sum(commitDeals, "gap") };
    const shownBestTotals = { crm_weighted: sum(bestDeals, "crm_weighted"), ai_weighted: sum(bestDeals, "ai_weighted"), gap: sum(bestDeals, "gap") };
    const shownPipeTotals = { crm_weighted: sum(pipeDeals, "crm_weighted"), ai_weighted: sum(pipeDeals, "ai_weighted"), gap: sum(pipeDeals, "gap") };

    const totals = {
      crm_outlook_weighted: universeCommitTotals.crm_weighted + universeBestTotals.crm_weighted + universePipeTotals.crm_weighted,
      ai_outlook_weighted: universeCommitTotals.ai_weighted + universeBestTotals.ai_weighted + universePipeTotals.ai_weighted,
      gap: universeCommitTotals.gap + universeBestTotals.gap + universePipeTotals.gap,
    };

    const shown_totals = {
      crm_outlook_weighted: shownCommitTotals.crm_weighted + shownBestTotals.crm_weighted + shownPipeTotals.crm_weighted,
      ai_outlook_weighted: shownCommitTotals.ai_weighted + shownBestTotals.ai_weighted + shownPipeTotals.ai_weighted,
      gap: shownCommitTotals.gap + shownBestTotals.gap + shownPipeTotals.gap,
    };

    // Rep context panel (only when a single rep is explicitly selected).
    const repContext = repPublicId
      ? await (async () => {
          type AggRow = { crm_bucket: "commit" | "best_case" | "pipeline" | null; deal_count: number; avg_health_score: number | null };
          const rep = repIdFilter ? repIdFilter : await resolvePublicId("reps", repPublicId).catch(() => 0);
          if (!rep) return null;
          const { rows } = await pool.query<AggRow>(
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
                o.health_score,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                    '[^a-zA-Z]+',
                    ' ',
                    'g'
                  )
                ) AS fs
              FROM opportunities o
              JOIN qp ON TRUE
              WHERE o.org_id = $1::bigint
                AND o.rep_id = $3::bigint
                AND o.close_date IS NOT NULL
                AND o.close_date >= qp.period_start
                AND o.close_date <= qp.period_end
            ),
            classified AS (
              SELECT
                *,
                (NOT ((' ' || fs || ' ') LIKE '% won %')
                  AND NOT ((' ' || fs || ' ') LIKE '% lost %')
                  AND NOT ((' ' || fs || ' ') LIKE '% loss %')
                  AND NOT ((' ' || fs || ' ') LIKE '% closed %')
                ) AS is_open,
                CASE
                  WHEN (NOT ((' ' || fs || ' ') LIKE '% won %')
                    AND NOT ((' ' || fs || ' ') LIKE '% lost %')
                    AND NOT ((' ' || fs || ' ') LIKE '% loss %')
                    AND NOT ((' ' || fs || ' ') LIKE '% closed %')
                  ) AND fs LIKE '%commit%' THEN 'commit'
                  WHEN (NOT ((' ' || fs || ' ') LIKE '% won %')
                    AND NOT ((' ' || fs || ' ') LIKE '% lost %')
                    AND NOT ((' ' || fs || ' ') LIKE '% loss %')
                    AND NOT ((' ' || fs || ' ') LIKE '% closed %')
                  ) AND fs LIKE '%best%' THEN 'best_case'
                  WHEN (NOT ((' ' || fs || ' ') LIKE '% won %')
                    AND NOT ((' ' || fs || ' ') LIKE '% lost %')
                    AND NOT ((' ' || fs || ' ') LIKE '% loss %')
                    AND NOT ((' ' || fs || ' ') LIKE '% closed %')
                  ) THEN 'pipeline'
                  ELSE NULL
                END AS crm_bucket
              FROM deals
            ),
            open_only AS (
              SELECT *
                FROM classified
               WHERE is_open = TRUE
                 AND crm_bucket IS NOT NULL
            )
            SELECT
              crm_bucket,
              COUNT(*)::int AS deal_count,
              AVG(NULLIF(health_score, 0))::float8 AS avg_health_score
            FROM open_only
            GROUP BY crm_bucket
            ORDER BY crm_bucket ASC
            `,
            [auth.user.org_id, quotaPeriodId, rep]
          );

          const byBucket = new Map<string, AggRow>();
          for (const r of rows || []) byBucket.set(String(r.crm_bucket || ""), r);
          const rowFor = (bucket: "commit" | "best_case" | "pipeline") => {
            const r = byBucket.get(bucket) || null;
            const count = r ? Number(r.deal_count || 0) || 0 : 0;
            const hp = healthPctFromScore30(r?.avg_health_score ?? null);
            return { deals: count, avg_health_pct: hp };
          };

          const repName = await pool
            .query<{ name: string }>(
              `
              SELECT COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), '(Unnamed)') AS name
                FROM reps
               WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint
                 AND id = $2::bigint
               LIMIT 1
              `,
              [auth.user.org_id, rep]
            )
            .then((r) => String(r.rows?.[0]?.name || "").trim() || null)
            .catch(() => null);

          return {
            rep_public_id: repPublicId,
            rep_name: repName,
            commit: rowFor("commit"),
            best_case: rowFor("best_case"),
            pipeline: rowFor("pipeline"),
            last_quarter_accuracy_pct: null as number | null,
          };
        })()
      : null;

    return NextResponse.json({
      ok: true,
      quota_period: qp,
      filters: {
        quota_period_id: String(quotaPeriodId),
        rep_public_id: repPublicId ?? null,
        rep_name: repNameLike || null,
        stage: stageFilter ?? null,
        bucket_commit: bucketList.includes("commit"),
        bucket_best_case: bucketList.includes("best_case"),
        bucket_pipeline: bucketList.includes("pipeline"),
        risk_category: riskCategory ?? null,
        suppressed_only: suppressedOnly,
        health_min_pct: healthMinPct ?? null,
        health_max_pct: healthMaxPct ?? null,
        mode: effectiveMode,
        driver_mode: driverMode,
        driver_take_per_bucket: driverTakePerBucket,
        driver_min_abs_gap: driverMinAbsGap,
        driver_require_score_effect: driverRequireScoreEffect,
        risk_take_per_bucket: riskTakePerBucket,
        risk_min_downside: riskMinDownside,
        risk_require_score_effect: riskRequireScoreEffect,
        hi_enabled: hiOn,
      },
      totals,
      shown_totals,
      rep_context: repContext,
      groups: {
        commit: { label: "Commit deals driving the gap", deals: commitDeals, totals: universeCommitTotals, shown_totals: shownCommitTotals },
        best_case: { label: "Best Case deals driving the gap", deals: bestDeals, totals: universeBestTotals, shown_totals: shownBestTotals },
        pipeline: { label: "Pipeline deals driving the gap", deals: pipeDeals, totals: universePipeTotals, shown_totals: shownPipeTotals },
      },
    });
  } catch (e: any) {
    return jsonError(500, e?.message || String(e));
  }
}

