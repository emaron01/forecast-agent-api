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

function computeHealthPercent(args: { rollupOverallScore?: any; rollupOverallMax?: any; opportunityHealthScore?: any }) {
  const os = Number(args.rollupOverallScore);
  const om = Number(args.rollupOverallMax);
  if (Number.isFinite(os) && Number.isFinite(om) && om > 0) {
    return roundInt((os / om) * 100);
  }
  const hs = Number(args.opportunityHealthScore);
  if (Number.isFinite(hs)) return roundInt((hs / 30) * 100);
  return null;
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
      SELECT id, org_id, account_name, opportunity_name, rep_name, forecast_stage, amount, close_date, updated_at, health_score
        FROM opportunities
       WHERE org_id = $1 AND id = $2
       LIMIT 1
      `,
      [orgId, opportunityId]
    );
    const opportunity = oppRes.rows?.[0] || null;
    if (!opportunity) return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });

    const rollupRes = await pool.query(
      `
      SELECT org_id, opportunity_id, overall_score, overall_max, summary, next_steps, risks, updated_at
        FROM opportunity_rollups
       WHERE org_id = $1 AND opportunity_id = $2
       LIMIT 1
      `,
      [orgId, opportunityId]
    );
    const rollup = rollupRes.rows?.[0] || null;

    const aRes = await pool.query(
      `
      SELECT category, score, label, tip, evidence, updated_at
        FROM opportunity_category_assessments
       WHERE org_id = $1 AND opportunity_id = $2
      `,
      [orgId, opportunityId]
    );
    const byCat = new Map<string, any>();
    for (const r of aRes.rows || []) byCat.set(String(r.category), r);

    const categories = ALL_CATEGORIES.map((c) => {
      const row = byCat.get(c);
      return {
        category: c,
        score: Number(row?.score ?? 0),
        label: String(row?.label ?? ""),
        tip: String(row?.tip ?? ""),
        evidence: String(row?.evidence ?? ""),
        updated_at: row?.updated_at ?? null,
      };
    });

    const healthPercent = computeHealthPercent({
      rollupOverallScore: rollup?.overall_score,
      rollupOverallMax: rollup?.overall_max,
      opportunityHealthScore: opportunity?.health_score,
    });

    return NextResponse.json({
      ok: true,
      opportunity,
      rollup,
      healthPercent,
      categories,
    });
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "42P01") {
      return NextResponse.json({ ok: false, error: "DB migration missing for Mode B tables" }, { status: 500 });
    }
    if (code === "42703") {
      return NextResponse.json({ ok: false, error: "DB migration missing for Mode B label/tip columns" }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

