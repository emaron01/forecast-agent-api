import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "../../../../lib/auth";
import {
  channelDealScopeIsEmpty,
  channelDealScopeWhereMerged,
  channelDealScopeWhereStrict,
} from "../../../../lib/channelDealScope";
import { filterChannelUserIdsUnderViewer } from "../../../../lib/channelOrgDirectory";
import { getChannelTerritoryRepIds } from "../../../../lib/channelTerritoryScope";
import { pool } from "../../../../lib/pool";
import { isChannelRole } from "../../../../lib/roleHelpers";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

const BucketSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  min: z.coerce.number().finite(),
  max: z.coerce.number().finite().nullable(),
});

const BodySchema = z.object({
  buckets: z.array(BucketSchema).min(1).max(200),
  quarterIds: z.array(z.string().min(1)).min(1).max(12),
  repIds: z.array(z.string().min(1)).nullable(),
  reportType: z.enum(["deal_volume", "meddpicc_health", "product_mix"]),
  isChannelDashboard: z.boolean().optional(),
});

type OppRow = {
  id: number;
  amount: number | null;
  forecast_stage: string | null;
  sales_stage: string | null;
  product: string | null;
  health_score: number | null;
  pain_score: number | null;
  metrics_score: number | null;
  champion_score: number | null;
  eb_score: number | null;
  criteria_score: number | null;
  process_score: number | null;
  competition_score: number | null;
  paper_score: number | null;
  timing_score: number | null;
  budget_score: number | null;
  create_date: string | null;
  close_date: string | null;
  quarter_id: string;
  period_name: string;
};

type Agg = {
  bucket_id: string;
  quarter_id: string;
  quarter_name: string;
  won_count: number;
  lost_count: number;
  commit_count: number;
  best_case_count: number;
  pipeline_count: number;
  won_amount: number;
  lost_amount: number;
  commit_amount: number;
  best_case_amount: number;
  pipeline_amount: number;
  win_rate: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_pipeline: number | null;
  avg_health_won: number | null;
  avg_health_lost: number | null;
  avg_health_pipeline: number | null;
  avg_pain: number | null;
  avg_metrics: number | null;
  avg_champion: number | null;
  avg_eb: number | null;
  avg_criteria: number | null;
  avg_process: number | null;
  avg_competition: number | null;
  avg_paper: number | null;
  avg_timing: number | null;
  avg_budget: number | null;
  avg_pain_won: number | null;
  avg_pain_lost: number | null;
  avg_pain_pipeline: number | null;
  avg_metrics_won: number | null;
  avg_metrics_lost: number | null;
  avg_metrics_pipeline: number | null;
  avg_champion_won: number | null;
  avg_champion_lost: number | null;
  avg_champion_pipeline: number | null;
  avg_eb_won: number | null;
  avg_eb_lost: number | null;
  avg_eb_pipeline: number | null;
  avg_criteria_won: number | null;
  avg_criteria_lost: number | null;
  avg_criteria_pipeline: number | null;
  avg_process_won: number | null;
  avg_process_lost: number | null;
  avg_process_pipeline: number | null;
  avg_competition_won: number | null;
  avg_competition_lost: number | null;
  avg_competition_pipeline: number | null;
  avg_paper_won: number | null;
  avg_paper_lost: number | null;
  avg_paper_pipeline: number | null;
  avg_timing_won: number | null;
  avg_timing_lost: number | null;
  avg_timing_pipeline: number | null;
  avg_budget_won: number | null;
  avg_budget_lost: number | null;
  avg_budget_pipeline: number | null;
  products: Record<string, number>;
  products_won: Record<string, number>;
  products_lost: Record<string, number>;
  products_commit: Record<string, number>;
  products_best_case: Record<string, number>;
  products_pipeline: Record<string, number>;
};

function norm(s: unknown) {
  return String(s ?? "").toLowerCase();
}

type OrgStageMapping = { stage_value: string; bucket: string };

type Outcome5 = "won" | "lost" | "commit" | "best_case" | "pipeline";

function outcome(
  row: { sales_stage: string | null; forecast_stage: string | null },
  orgStageMappings?: OrgStageMapping[]
): Outcome5 {
  if (orgStageMappings?.length) {
    const normStage = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const sales = normStage(row.sales_stage);
    const forecast = normStage(row.forecast_stage);

    const match = orgStageMappings.find((m) => {
      const v = normStage(m.stage_value);
      return v === sales || v === forecast;
    });
    if (match) {
      const b = String(match.bucket ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      if (b === "won") return "won";
      if (b === "lost") return "lost";
      if (b === "commit") return "commit";
      if (b === "best_case") return "best_case";
      if (b === "excluded") return "lost";
      return "pipeline";
    }
  }

  const ss = norm(row.sales_stage);
  const fs = norm(row.forecast_stage);
  if (ss.includes("won") || fs.includes("won")) return "won";
  if (ss.includes("lost") || ss.includes("loss") || fs.includes("lost")) return "lost";
  if (fs.includes("commit") || ss.includes("commit")) return "commit";
  if (fs.includes("best case") || fs.includes("bestcase") || ss.includes("best case") || ss.includes("bestcase") || fs.includes("best_") || ss.includes("best_")) {
    return "best_case";
  }
  return "pipeline";
}

function outcomeForMeddpiccAndHealth(out: Outcome5): "won" | "lost" | "pipeline" {
  if (out === "won") return "won";
  if (out === "lost") return "lost";
  // Commit/Best Case roll up under open pipeline for MEDDPICC + health panels
  return "pipeline";
}

function daysBetween(create_date: string | null, close_date: string | null): number | null {
  if (!create_date || !close_date) return null;
  const a = new Date(create_date).getTime();
  const b = new Date(close_date).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function safeAvg(sum: number, n: number): number | null {
  if (!Number.isFinite(sum) || !Number.isFinite(n) || n <= 0) return null;
  return sum / n;
}

export async function POST(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const orgId = ctx.user.org_id;
  const orgStageMappings: OrgStageMapping[] = await pool
    .query(`SELECT stage_value, bucket FROM org_stage_mappings WHERE org_id = $1`, [orgId])
    .then((r) => (r.rows || []) as any[])
    .catch(() => []);
  const bucketsRaw = parsed.data.buckets.slice().sort((a, b) => Number(a.min) - Number(b.min));
  const quarterIds = parsed.data.quarterIds.map((s) => String(s));
  let repIds: string[] | null = parsed.data.repIds ? parsed.data.repIds.map((s) => String(s)) : null;

  let territoryRepIds: number[] = [];
  let partnerNames: string[] = [];
  let channelScopeSql = "";
  let queryParams: unknown[] = [];
  let rows: OppRow[] = [];

  if (isChannelRole(ctx.user) || body.isChannelDashboard === true) {
    const explicitChannelUserIds =
      repIds && repIds.length > 0
        ? repIds.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0)
        : [];

    if (explicitChannelUserIds.length > 0) {
      const allowedUserIds = await filterChannelUserIdsUnderViewer({
        orgId,
        viewerUserId: ctx.user.id,
        candidateUserIds: explicitChannelUserIds,
      });
      if (allowedUserIds.length === 1) {
        // One selected channel user: same mutually exclusive partner vs territory rule as /api/forecast/deals.
        const s = await getChannelTerritoryRepIds({ orgId, channelUserId: allowedUserIds[0] }).catch(() => ({
          repIds: [] as number[],
          partnerNames: [] as string[],
        }));
        territoryRepIds = s.repIds.filter((id) => Number.isFinite(id) && id > 0);
        partnerNames = s.partnerNames.map((n) => String(n).trim().toLowerCase()).filter(Boolean);
        channelScopeSql = channelDealScopeWhereStrict(3, 4);
      } else if (allowedUserIds.length > 1) {
        const territories = await Promise.all(
          allowedUserIds.map((channelUserId) =>
            getChannelTerritoryRepIds({ orgId, channelUserId }).catch(() => ({
              repIds: [] as number[],
              partnerNames: [] as string[],
            }))
          )
        );
        const tSet = new Set<number>();
        const pSet = new Set<string>();
        for (const s of territories) {
          s.repIds.forEach((id) => {
            if (Number.isFinite(id) && id > 0) tSet.add(id);
          });
          s.partnerNames.forEach((n) => {
            const x = String(n).trim().toLowerCase();
            if (x) pSet.add(x);
          });
        }
        territoryRepIds = Array.from(tSet);
        partnerNames = Array.from(pSet);
        channelScopeSql = channelDealScopeWhereMerged(3, 4);
      } else {
        territoryRepIds = [];
        partnerNames = [];
        channelScopeSql = channelDealScopeWhereStrict(3, 4);
      }
    } else {
      const channelScope = await getChannelTerritoryRepIds({
        orgId: ctx.user.org_id,
        channelUserId: ctx.user.id,
      }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }));
      territoryRepIds = channelScope.repIds.filter((id) => Number.isFinite(id) && id > 0);
      partnerNames = channelScope.partnerNames.map((n) => String(n).trim().toLowerCase()).filter(Boolean);
      channelScopeSql = channelDealScopeWhereStrict(3, 4);
    }

    if (channelDealScopeIsEmpty(territoryRepIds, partnerNames)) {
      rows = [];
    } else {
      queryParams = [orgId, quarterIds, territoryRepIds, partnerNames];
      const res = await pool.query<OppRow>(
        `
        SELECT
          o.id,
          o.amount,
          o.forecast_stage,
          o.sales_stage,
          o.product,
          o.health_score,
          o.pain_score, o.metrics_score,
          o.champion_score, o.eb_score,
          o.criteria_score, o.process_score,
          o.competition_score, o.paper_score,
          o.timing_score, o.budget_score,
          o.create_date,
          o.close_date,
          qp.id::text as quarter_id,
          qp.period_name
        FROM opportunities o
        JOIN quota_periods qp
          ON o.org_id = qp.org_id
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
        WHERE o.org_id = $1
          AND qp.id = ANY($2::bigint[])
          ${channelScopeSql}
        `,
        queryParams
      );
      rows = (res.rows || []) as OppRow[];
    }
  } else {
    const repIdsNum: number[] | null =
      repIds && repIds.length > 0
        ? repIds.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0)
        : null;
    const res = await pool.query<OppRow>(
      `
      SELECT
        o.id,
        o.amount,
        o.forecast_stage,
        o.sales_stage,
        o.product,
        o.health_score,
        o.pain_score, o.metrics_score,
        o.champion_score, o.eb_score,
        o.criteria_score, o.process_score,
        o.competition_score, o.paper_score,
        o.timing_score, o.budget_score,
        o.create_date,
        o.close_date,
        qp.id::text as quarter_id,
        qp.period_name
      FROM opportunities o
      JOIN quota_periods qp
        ON o.org_id = qp.org_id
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
      WHERE o.org_id = $1
        AND qp.id = ANY($2::bigint[])
        AND (
          $3::bigint[] IS NULL OR
          o.rep_id = ANY($3::bigint[])
        )
      `,
      [orgId, quarterIds, repIdsNum && repIdsNum.length > 0 ? repIdsNum : null]
    );
    rows = (res.rows || []) as OppRow[];
  }

  const quartersById = new Map<string, string>();
  for (const r of rows || []) {
    if (r.quarter_id && r.period_name && !quartersById.has(r.quarter_id)) {
      quartersById.set(r.quarter_id, r.period_name);
    }
  }

  const bucketIdToLabel = new Map<string, string>(bucketsRaw.map((b) => [b.id, b.label]));
  const bucketIdToBounds = new Map<string, { min: number; max: number | null }>(
    bucketsRaw.map((b) => [b.id, { min: Number(b.min), max: b.max == null ? null : Number(b.max) }])
  );

  const aggByKey = new Map<string, Agg>();
  const sums = new Map<
    string,
    {
      days_won_sum: number;
      days_won_n: number;
      days_lost_sum: number;
      days_lost_n: number;
      days_pipe_sum: number;
      days_pipe_n: number;
      health_won_sum: number;
      health_won_n: number;
      health_lost_sum: number;
      health_lost_n: number;
      health_pipe_sum: number;
      health_pipe_n: number;
      pain_sum: number;
      pain_n: number;
      metrics_sum: number;
      metrics_n: number;
      champion_sum: number;
      champion_n: number;
      eb_sum: number;
      eb_n: number;
      criteria_sum: number;
      criteria_n: number;
      process_sum: number;
      process_n: number;
      competition_sum: number;
      competition_n: number;
      paper_sum: number;
      paper_n: number;
      timing_sum: number;
      timing_n: number;
      budget_sum: number;
      budget_n: number;
      pain_won_sum: number;
      pain_won_n: number;
      pain_lost_sum: number;
      pain_lost_n: number;
      pain_pipe_sum: number;
      pain_pipe_n: number;
      metrics_won_sum: number;
      metrics_won_n: number;
      metrics_lost_sum: number;
      metrics_lost_n: number;
      metrics_pipe_sum: number;
      metrics_pipe_n: number;
      champion_won_sum: number;
      champion_won_n: number;
      champion_lost_sum: number;
      champion_lost_n: number;
      champion_pipe_sum: number;
      champion_pipe_n: number;
      eb_won_sum: number;
      eb_won_n: number;
      eb_lost_sum: number;
      eb_lost_n: number;
      eb_pipe_sum: number;
      eb_pipe_n: number;
      criteria_won_sum: number;
      criteria_won_n: number;
      criteria_lost_sum: number;
      criteria_lost_n: number;
      criteria_pipe_sum: number;
      criteria_pipe_n: number;
      process_won_sum: number;
      process_won_n: number;
      process_lost_sum: number;
      process_lost_n: number;
      process_pipe_sum: number;
      process_pipe_n: number;
      competition_won_sum: number;
      competition_won_n: number;
      competition_lost_sum: number;
      competition_lost_n: number;
      competition_pipe_sum: number;
      competition_pipe_n: number;
      paper_won_sum: number;
      paper_won_n: number;
      paper_lost_sum: number;
      paper_lost_n: number;
      paper_pipe_sum: number;
      paper_pipe_n: number;
      timing_won_sum: number;
      timing_won_n: number;
      timing_lost_sum: number;
      timing_lost_n: number;
      timing_pipe_sum: number;
      timing_pipe_n: number;
      budget_won_sum: number;
      budget_won_n: number;
      budget_lost_sum: number;
      budget_lost_n: number;
      budget_pipe_sum: number;
      budget_pipe_n: number;
    }
  >();

  function ensure(bucket_id: string, quarter_id: string, quarter_name: string) {
    const k = `${bucket_id}::${quarter_id}`;
    let a = aggByKey.get(k);
    if (!a) {
      a = {
        bucket_id,
        quarter_id,
        quarter_name,
        won_count: 0,
        lost_count: 0,
        commit_count: 0,
        best_case_count: 0,
        pipeline_count: 0,
        won_amount: 0,
        lost_amount: 0,
        commit_amount: 0,
        best_case_amount: 0,
        pipeline_amount: 0,
        win_rate: 0,
        avg_days_won: null,
        avg_days_lost: null,
        avg_days_pipeline: null,
        avg_health_won: null,
        avg_health_lost: null,
        avg_health_pipeline: null,
        avg_pain: null,
        avg_metrics: null,
        avg_champion: null,
        avg_eb: null,
        avg_criteria: null,
        avg_process: null,
        avg_competition: null,
        avg_paper: null,
        avg_timing: null,
        avg_budget: null,
        avg_pain_won: null,
        avg_pain_lost: null,
        avg_pain_pipeline: null,
        avg_metrics_won: null,
        avg_metrics_lost: null,
        avg_metrics_pipeline: null,
        avg_champion_won: null,
        avg_champion_lost: null,
        avg_champion_pipeline: null,
        avg_eb_won: null,
        avg_eb_lost: null,
        avg_eb_pipeline: null,
        avg_criteria_won: null,
        avg_criteria_lost: null,
        avg_criteria_pipeline: null,
        avg_process_won: null,
        avg_process_lost: null,
        avg_process_pipeline: null,
        avg_competition_won: null,
        avg_competition_lost: null,
        avg_competition_pipeline: null,
        avg_paper_won: null,
        avg_paper_lost: null,
        avg_paper_pipeline: null,
        avg_timing_won: null,
        avg_timing_lost: null,
        avg_timing_pipeline: null,
        avg_budget_won: null,
        avg_budget_lost: null,
        avg_budget_pipeline: null,
        products: {},
        products_won: {},
        products_lost: {},
        products_commit: {},
        products_best_case: {},
        products_pipeline: {},
      };
      aggByKey.set(k, a);
      sums.set(k, {
        days_won_sum: 0,
        days_won_n: 0,
        days_lost_sum: 0,
        days_lost_n: 0,
        days_pipe_sum: 0,
        days_pipe_n: 0,
        health_won_sum: 0,
        health_won_n: 0,
        health_lost_sum: 0,
        health_lost_n: 0,
        health_pipe_sum: 0,
        health_pipe_n: 0,
        pain_sum: 0,
        pain_n: 0,
        metrics_sum: 0,
        metrics_n: 0,
        champion_sum: 0,
        champion_n: 0,
        eb_sum: 0,
        eb_n: 0,
        criteria_sum: 0,
        criteria_n: 0,
        process_sum: 0,
        process_n: 0,
        competition_sum: 0,
        competition_n: 0,
        paper_sum: 0,
        paper_n: 0,
        timing_sum: 0,
        timing_n: 0,
        budget_sum: 0,
        budget_n: 0,
        pain_won_sum: 0,
        pain_won_n: 0,
        pain_lost_sum: 0,
        pain_lost_n: 0,
        pain_pipe_sum: 0,
        pain_pipe_n: 0,
        metrics_won_sum: 0,
        metrics_won_n: 0,
        metrics_lost_sum: 0,
        metrics_lost_n: 0,
        metrics_pipe_sum: 0,
        metrics_pipe_n: 0,
        champion_won_sum: 0,
        champion_won_n: 0,
        champion_lost_sum: 0,
        champion_lost_n: 0,
        champion_pipe_sum: 0,
        champion_pipe_n: 0,
        eb_won_sum: 0,
        eb_won_n: 0,
        eb_lost_sum: 0,
        eb_lost_n: 0,
        eb_pipe_sum: 0,
        eb_pipe_n: 0,
        criteria_won_sum: 0,
        criteria_won_n: 0,
        criteria_lost_sum: 0,
        criteria_lost_n: 0,
        criteria_pipe_sum: 0,
        criteria_pipe_n: 0,
        process_won_sum: 0,
        process_won_n: 0,
        process_lost_sum: 0,
        process_lost_n: 0,
        process_pipe_sum: 0,
        process_pipe_n: 0,
        competition_won_sum: 0,
        competition_won_n: 0,
        competition_lost_sum: 0,
        competition_lost_n: 0,
        competition_pipe_sum: 0,
        competition_pipe_n: 0,
        paper_won_sum: 0,
        paper_won_n: 0,
        paper_lost_sum: 0,
        paper_lost_n: 0,
        paper_pipe_sum: 0,
        paper_pipe_n: 0,
        timing_won_sum: 0,
        timing_won_n: 0,
        timing_lost_sum: 0,
        timing_lost_n: 0,
        timing_pipe_sum: 0,
        timing_pipe_n: 0,
        budget_won_sum: 0,
        budget_won_n: 0,
        budget_lost_sum: 0,
        budget_lost_n: 0,
        budget_pipe_sum: 0,
        budget_pipe_n: 0,
      });
    }
    return { k, a, s: sums.get(k)! };
  }

  function assignBucketId(amount: number): string | null {
    for (const b of bucketsRaw) {
      const min = Number(b.min);
      const max = b.max == null ? null : Number(b.max);
      if (amount >= min && (max == null || amount < max)) return b.id;
    }
    return null;
  }

  for (const r of rows || []) {
    const amt = Number(r.amount ?? 0) || 0;
    const bucket_id = assignBucketId(amt);
    if (!bucket_id) continue;
    const qid = String(r.quarter_id || "");
    const qname = String(r.period_name || quartersById.get(qid) || qid);
    if (!qid) continue;

    const { a, s } = ensure(bucket_id, qid, qname);
    const out = outcome(r, orgStageMappings);
    const out3 = outcomeForMeddpiccAndHealth(out);

    const days = daysBetween(r.create_date, r.close_date);
    const health = r.health_score != null && Number.isFinite(Number(r.health_score)) ? Number(r.health_score) : null;

    if (out === "won") {
      a.won_count += 1;
      a.won_amount += amt;
      if (days != null) {
        s.days_won_sum += days;
        s.days_won_n += 1;
      }
      if (health != null) {
        s.health_won_sum += health;
        s.health_won_n += 1;
      }
      if (r.product) {
        const k = String(r.product || "").trim() || "(Unspecified)";
        a.products_won[k] = (a.products_won[k] || 0) + 1;
      }
    } else if (out === "lost") {
      a.lost_count += 1;
      a.lost_amount += amt;
      if (days != null) {
        s.days_lost_sum += days;
        s.days_lost_n += 1;
      }
      if (health != null) {
        s.health_lost_sum += health;
        s.health_lost_n += 1;
      }
      if (r.product) {
        const k = String(r.product || "").trim() || "(Unspecified)";
        a.products_lost[k] = (a.products_lost[k] || 0) + 1;
      }
    } else if (out === "commit") {
      a.commit_count += 1;
      a.commit_amount += amt;
      if (r.product) {
        const k = String(r.product || "").trim() || "(Unspecified)";
        a.products_commit[k] = (a.products_commit[k] || 0) + 1;
      }
    } else if (out === "best_case") {
      a.best_case_count += 1;
      a.best_case_amount += amt;
      if (r.product) {
        const k = String(r.product || "").trim() || "(Unspecified)";
        a.products_best_case[k] = (a.products_best_case[k] || 0) + 1;
      }
    } else {
      a.pipeline_count += 1;
      a.pipeline_amount += amt;
      if (days != null) {
        s.days_pipe_sum += days;
        s.days_pipe_n += 1;
      }
      if (health != null) {
        s.health_pipe_sum += health;
        s.health_pipe_n += 1;
      }
      if (r.product) {
        const k = String(r.product || "").trim() || "(Unspecified)";
        a.products_pipeline[k] = (a.products_pipeline[k] || 0) + 1;
      }
    }

    const addScore = (val: number | null, sumKey: keyof typeof s, nKey: keyof typeof s) => {
      const v = val != null && Number.isFinite(Number(val)) ? Number(val) : null;
      if (v == null) return;
      (s[sumKey] as number) += v;
      (s[nKey] as number) += 1;
    };

    addScore(r.pain_score, "pain_sum", "pain_n");
    addScore(r.metrics_score, "metrics_sum", "metrics_n");
    addScore(r.champion_score, "champion_sum", "champion_n");
    addScore(r.eb_score, "eb_sum", "eb_n");
    addScore(r.criteria_score, "criteria_sum", "criteria_n");
    addScore(r.process_score, "process_sum", "process_n");
    addScore(r.competition_score, "competition_sum", "competition_n");
    addScore(r.paper_score, "paper_sum", "paper_n");
    addScore(r.timing_score, "timing_sum", "timing_n");
    addScore(r.budget_score, "budget_sum", "budget_n");

    const addScoreByOutcome = (
      val: number | null,
      out: "won" | "lost" | "pipeline",
      keys: {
        won: { sum: keyof typeof s; n: keyof typeof s };
        lost: { sum: keyof typeof s; n: keyof typeof s };
        pipeline: { sum: keyof typeof s; n: keyof typeof s };
      }
    ) => {
      if (out === "won") addScore(val, keys.won.sum, keys.won.n);
      else if (out === "lost") addScore(val, keys.lost.sum, keys.lost.n);
      else addScore(val, keys.pipeline.sum, keys.pipeline.n);
    };

    addScoreByOutcome(r.pain_score, out3, {
      won: { sum: "pain_won_sum", n: "pain_won_n" },
      lost: { sum: "pain_lost_sum", n: "pain_lost_n" },
      pipeline: { sum: "pain_pipe_sum", n: "pain_pipe_n" },
    });
    addScoreByOutcome(r.metrics_score, out3, {
      won: { sum: "metrics_won_sum", n: "metrics_won_n" },
      lost: { sum: "metrics_lost_sum", n: "metrics_lost_n" },
      pipeline: { sum: "metrics_pipe_sum", n: "metrics_pipe_n" },
    });
    addScoreByOutcome(r.champion_score, out3, {
      won: { sum: "champion_won_sum", n: "champion_won_n" },
      lost: { sum: "champion_lost_sum", n: "champion_lost_n" },
      pipeline: { sum: "champion_pipe_sum", n: "champion_pipe_n" },
    });
    addScoreByOutcome(r.eb_score, out3, {
      won: { sum: "eb_won_sum", n: "eb_won_n" },
      lost: { sum: "eb_lost_sum", n: "eb_lost_n" },
      pipeline: { sum: "eb_pipe_sum", n: "eb_pipe_n" },
    });
    addScoreByOutcome(r.criteria_score, out3, {
      won: { sum: "criteria_won_sum", n: "criteria_won_n" },
      lost: { sum: "criteria_lost_sum", n: "criteria_lost_n" },
      pipeline: { sum: "criteria_pipe_sum", n: "criteria_pipe_n" },
    });
    addScoreByOutcome(r.process_score, out3, {
      won: { sum: "process_won_sum", n: "process_won_n" },
      lost: { sum: "process_lost_sum", n: "process_lost_n" },
      pipeline: { sum: "process_pipe_sum", n: "process_pipe_n" },
    });
    addScoreByOutcome(r.competition_score, out3, {
      won: { sum: "competition_won_sum", n: "competition_won_n" },
      lost: { sum: "competition_lost_sum", n: "competition_lost_n" },
      pipeline: { sum: "competition_pipe_sum", n: "competition_pipe_n" },
    });
    addScoreByOutcome(r.paper_score, out3, {
      won: { sum: "paper_won_sum", n: "paper_won_n" },
      lost: { sum: "paper_lost_sum", n: "paper_lost_n" },
      pipeline: { sum: "paper_pipe_sum", n: "paper_pipe_n" },
    });
    addScoreByOutcome(r.timing_score, out3, {
      won: { sum: "timing_won_sum", n: "timing_won_n" },
      lost: { sum: "timing_lost_sum", n: "timing_lost_n" },
      pipeline: { sum: "timing_pipe_sum", n: "timing_pipe_n" },
    });
    addScoreByOutcome(r.budget_score, out3, {
      won: { sum: "budget_won_sum", n: "budget_won_n" },
      lost: { sum: "budget_lost_sum", n: "budget_lost_n" },
      pipeline: { sum: "budget_pipe_sum", n: "budget_pipe_n" },
    });

    const product = String(r.product || "").trim();
    if (product) {
      a.products[product] = (Number(a.products[product] || 0) || 0) + amt;
      if (out3 === "won") a.products_won[product] = (Number(a.products_won[product] || 0) || 0) + amt;
      else if (out3 === "lost") a.products_lost[product] = (Number(a.products_lost[product] || 0) || 0) + amt;
      else a.products_pipeline[product] = (Number(a.products_pipeline[product] || 0) || 0) + amt;
    }
  }

  const outRows: Agg[] = [];
  for (const [k, a] of aggByKey.entries()) {
    const s = sums.get(k)!;
    const denom = a.won_count + a.lost_count;
    a.win_rate = denom > 0 ? a.won_count / denom : 0;
    a.avg_days_won = safeAvg(s.days_won_sum, s.days_won_n);
    a.avg_days_lost = safeAvg(s.days_lost_sum, s.days_lost_n);
    a.avg_days_pipeline = safeAvg(s.days_pipe_sum, s.days_pipe_n);
    a.avg_health_won = safeAvg(s.health_won_sum, s.health_won_n);
    a.avg_health_lost = safeAvg(s.health_lost_sum, s.health_lost_n);
    a.avg_health_pipeline = safeAvg(s.health_pipe_sum, s.health_pipe_n);
    a.avg_pain = safeAvg(s.pain_sum, s.pain_n);
    a.avg_metrics = safeAvg(s.metrics_sum, s.metrics_n);
    a.avg_champion = safeAvg(s.champion_sum, s.champion_n);
    a.avg_eb = safeAvg(s.eb_sum, s.eb_n);
    a.avg_criteria = safeAvg(s.criteria_sum, s.criteria_n);
    a.avg_process = safeAvg(s.process_sum, s.process_n);
    a.avg_competition = safeAvg(s.competition_sum, s.competition_n);
    a.avg_paper = safeAvg(s.paper_sum, s.paper_n);
    a.avg_timing = safeAvg(s.timing_sum, s.timing_n);
    a.avg_budget = safeAvg(s.budget_sum, s.budget_n);
    a.avg_pain_won = safeAvg(s.pain_won_sum, s.pain_won_n);
    a.avg_pain_lost = safeAvg(s.pain_lost_sum, s.pain_lost_n);
    a.avg_pain_pipeline = safeAvg(s.pain_pipe_sum, s.pain_pipe_n);
    a.avg_metrics_won = safeAvg(s.metrics_won_sum, s.metrics_won_n);
    a.avg_metrics_lost = safeAvg(s.metrics_lost_sum, s.metrics_lost_n);
    a.avg_metrics_pipeline = safeAvg(s.metrics_pipe_sum, s.metrics_pipe_n);
    a.avg_champion_won = safeAvg(s.champion_won_sum, s.champion_won_n);
    a.avg_champion_lost = safeAvg(s.champion_lost_sum, s.champion_lost_n);
    a.avg_champion_pipeline = safeAvg(s.champion_pipe_sum, s.champion_pipe_n);
    a.avg_eb_won = safeAvg(s.eb_won_sum, s.eb_won_n);
    a.avg_eb_lost = safeAvg(s.eb_lost_sum, s.eb_lost_n);
    a.avg_eb_pipeline = safeAvg(s.eb_pipe_sum, s.eb_pipe_n);
    a.avg_criteria_won = safeAvg(s.criteria_won_sum, s.criteria_won_n);
    a.avg_criteria_lost = safeAvg(s.criteria_lost_sum, s.criteria_lost_n);
    a.avg_criteria_pipeline = safeAvg(s.criteria_pipe_sum, s.criteria_pipe_n);
    a.avg_process_won = safeAvg(s.process_won_sum, s.process_won_n);
    a.avg_process_lost = safeAvg(s.process_lost_sum, s.process_lost_n);
    a.avg_process_pipeline = safeAvg(s.process_pipe_sum, s.process_pipe_n);
    a.avg_competition_won = safeAvg(s.competition_won_sum, s.competition_won_n);
    a.avg_competition_lost = safeAvg(s.competition_lost_sum, s.competition_lost_n);
    a.avg_competition_pipeline = safeAvg(s.competition_pipe_sum, s.competition_pipe_n);
    a.avg_paper_won = safeAvg(s.paper_won_sum, s.paper_won_n);
    a.avg_paper_lost = safeAvg(s.paper_lost_sum, s.paper_lost_n);
    a.avg_paper_pipeline = safeAvg(s.paper_pipe_sum, s.paper_pipe_n);
    a.avg_timing_won = safeAvg(s.timing_won_sum, s.timing_won_n);
    a.avg_timing_lost = safeAvg(s.timing_lost_sum, s.timing_lost_n);
    a.avg_timing_pipeline = safeAvg(s.timing_pipe_sum, s.timing_pipe_n);
    a.avg_budget_won = safeAvg(s.budget_won_sum, s.budget_won_n);
    a.avg_budget_lost = safeAvg(s.budget_lost_sum, s.budget_lost_n);
    a.avg_budget_pipeline = safeAvg(s.budget_pipe_sum, s.budget_pipe_n);
    outRows.push(a);
  }

  const quarterOrder = parsed.data.quarterIds.map((s) => String(s));
  const quarters = Array.from(quartersById.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => quarterOrder.indexOf(a.id) - quarterOrder.indexOf(b.id));

  const buckets = bucketsRaw.map((b) => ({
    id: b.id,
    label: b.label,
    min: Number(b.min),
    max: b.max == null ? null : Number(b.max),
  }));

  return NextResponse.json({
    ok: true,
    quarters,
    buckets,
    rows: outRows.sort((a, b) => {
      const amin = bucketIdToBounds.get(a.bucket_id)?.min ?? 0;
      const bmin = bucketIdToBounds.get(b.bucket_id)?.min ?? 0;
      if (amin !== bmin) return amin - bmin;
      return String(bucketIdToLabel.get(a.bucket_id) || "").localeCompare(String(bucketIdToLabel.get(b.bucket_id) || ""));
    }),
  });
}

