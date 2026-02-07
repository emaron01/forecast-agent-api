import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ALL_CATEGORIES = [
  "metrics",
  "economic_buyer",
  "criteria",
  "process",
  "paper",
  "pain",
  "champion",
  "competition",
  "timing",
  "budget",
] as const;

function roundInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeHealthPercentFromOpportunity(healthScore: any) {
  const hs = Number(healthScore);
  if (!Number.isFinite(hs)) return null;
  // Internal score is 0-30; UI speaks percent.
  return roundInt((hs / 30) * 100);
}

function splitLabelEvidence(summary: any) {
  const s = String(summary ?? "").trim();
  if (!s) return { label: "", evidence: "" };
  const idx = s.indexOf(":");
  if (idx > 0) {
    const label = s.slice(0, idx).trim();
    const evidence = s.slice(idx + 1).trim();
    return { label, evidence };
  }
  return { label: "", evidence: s };
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const url = new URL(req.url);
    const orgId = Number(url.searchParams.get("orgId") || "0");
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing orgId" }, { status: 400 });
    const resolvedParams = await Promise.resolve(params as any);
    const idStr = resolvedParams?.id ?? "";
    const opportunityId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(opportunityId) || opportunityId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid opportunity id" }, { status: 400 });
    }

    const oppRes = await pool.query(
      `
      SELECT *
        FROM opportunities
       WHERE org_id = $1 AND id = $2
       LIMIT 1
      `,
      [orgId, opportunityId]
    );
    const opportunity = oppRes.rows?.[0] || null;
    if (!opportunity) return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });

    const categories = ALL_CATEGORIES.map((c) => {
      const opp: any = opportunity || {};
      const map: Record<string, { score: string; summary: string; tip: string }> = {
        metrics: { score: "metrics_score", summary: "metrics_summary", tip: "metrics_tip" },
        economic_buyer: { score: "eb_score", summary: "eb_summary", tip: "eb_tip" },
        criteria: { score: "criteria_score", summary: "criteria_summary", tip: "criteria_tip" },
        process: { score: "process_score", summary: "process_summary", tip: "process_tip" },
        paper: { score: "paper_score", summary: "paper_summary", tip: "paper_tip" },
        pain: { score: "pain_score", summary: "pain_summary", tip: "pain_tip" },
        champion: { score: "champion_score", summary: "champion_summary", tip: "champion_tip" },
        competition: { score: "competition_score", summary: "competition_summary", tip: "competition_tip" },
        timing: { score: "timing_score", summary: "timing_summary", tip: "timing_tip" },
        budget: { score: "budget_score", summary: "budget_summary", tip: "budget_tip" },
      };
      const fallback = map[c];
      const fallbackScore = fallback ? Number(opp?.[fallback.score] ?? 0) : 0;
      const fallbackTip = fallback ? String(opp?.[fallback.tip] ?? "") : "";
      const summary = fallback ? opp?.[fallback.summary] : "";
      const split = splitLabelEvidence(summary);
      return {
        category: c,
        score: Number(fallbackScore ?? 0),
        label: String(split.label ?? ""),
        tip: String(fallbackTip ?? ""),
        evidence: String(split.evidence ?? ""),
        updated_at: opportunity?.updated_at ?? null,
      };
    });

    const healthPercent = computeHealthPercentFromOpportunity((opportunity as any)?.health_score);

    const rollup = {
      // We don't maintain a separate rollup table; this is the canonical stored wrap on opportunities.
      summary: "",
      next_steps: String((opportunity as any)?.next_steps || "").trim(),
      risks: String((opportunity as any)?.risk_summary || "").trim(),
      updated_at: (opportunity as any)?.updated_at ?? null,
    };

    return NextResponse.json({
      ok: true,
      opportunity,
      rollup,
      healthPercent,
      categories,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

