import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "../../../lib/auth";
import { pool } from "../../../lib/pool";
import {
  preprocessInsights,
  generateSnapshot,
  type DashboardInsight,
  type ExecutiveSnapshot,
} from "../../../lib/executiveSnapshot";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

const InsightSchema = z.object({
  widgetId: z.string().min(1).max(200),
  widgetName: z.string().min(1).max(200),
  dashboardType: z.string().min(1).max(80),
  createdAt: z.union([z.string(), z.number()]),
  text: z.string(),
});

const BodySchema = z.object({
  orgId: z.coerce.number().int().positive(),
  quotaPeriodId: z.string().regex(/^\d+$/).max(50),
  insights: z.array(InsightSchema),
});

const SnapshotSchema = z.object({
  headline: z.string().min(1).max(400),
  strengths: z.array(z.string().min(1)).min(3).max(6),
  risks: z.array(z.string().min(1)).min(3).max(6),
  opportunities: z.array(z.string().min(1)).min(3).max(6),
  actions_30_days: z.array(z.string().min(1)).min(3).max(6),
  supporting_notes: z.array(z.string().min(1)).max(8).optional(),
});

async function getCachedSnapshot(args: { orgId: number; quotaPeriodId: string; inputHash: string }): Promise<ExecutiveSnapshot | null> {
  const { rows } = await pool.query(
    `
    SELECT snapshot_json
      FROM executive_snapshots
     WHERE org_id = $1::bigint
       AND quota_period_id = $2::bigint
       AND input_hash = $3::text
     ORDER BY created_at DESC
     LIMIT 1
    `,
    [args.orgId, args.quotaPeriodId, args.inputHash]
  );
  const raw = rows?.[0]?.snapshot_json ?? null;
  if (!raw) return null;
  const parsed = SnapshotSchema.safeParse(raw);
  return parsed.success ? (parsed.data as any) : null;
}

async function putCachedSnapshot(args: { orgId: number; quotaPeriodId: string; inputHash: string; snapshot: ExecutiveSnapshot }) {
  await pool.query(
    `
    INSERT INTO executive_snapshots (org_id, quota_period_id, input_hash, snapshot_json)
    VALUES ($1::bigint, $2::bigint, $3::text, $4::jsonb)
    ON CONFLICT (org_id, quota_period_id, input_hash)
    DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, created_at = NOW()
    `,
    [args.orgId, args.quotaPeriodId, args.inputHash, JSON.stringify(args.snapshot)]
  );
}

export async function POST(req: Request) {
  try {
    const ctx = await requireAuth();
    if (ctx.kind !== "user") return jsonError(403, "Forbidden");

    const body = BodySchema.parse(await req.json().catch(() => ({})));
    if (body.orgId !== ctx.user.org_id) return jsonError(403, "Forbidden");

    const { cleanedInsights, inputHash, inputCountUsed } = preprocessInsights(body.insights as DashboardInsight[]);

    if (!inputCountUsed) {
      return NextResponse.json({
        ok: true,
        snapshot: {
          headline: "Signal is weak: not enough dashboard insights to generate an Executive Snapshot.",
          strengths: [
            "Insufficient dashboard insight coverage to identify consistent strengths.",
            "Recent insight volume is too low for board-level synthesis.",
            "Inputs appear incomplete across key dashboard surfaces.",
          ],
          risks: [
            "Low signal: conclusions would be speculative without additional dashboard insights.",
            "Potential blind spots across executive/partner/product surfaces.",
            "Snapshot may under-represent emerging issues due to missing inputs.",
          ],
          opportunities: [
            "Persist dashboard AI summaries for each surface and widget to enable reliable synthesis.",
            "Standardize widget summaries to include a 1-line headline + 3–6 bullets.",
            "Increase coverage across executive + partner dashboards for a usable snapshot.",
          ],
          actions_30_days: [
            "Instrument and persist dashboard-level AI summaries for each key widget/surface.",
            "Collect at least 5–10 recent dashboard insights per org/period before generating the snapshot.",
            "Regenerate the Executive Snapshot once inputs are available and deduplicated.",
          ],
          supporting_notes: ["Provide at least 3–5 recent dashboard insights (per org + quota period) for synthesis."],
        },
        cacheHit: false,
        inputCountUsed,
      });
    }

    const cached = await getCachedSnapshot({ orgId: body.orgId, quotaPeriodId: body.quotaPeriodId, inputHash });
    if (cached) {
      return NextResponse.json({ ok: true, snapshot: cached, cacheHit: true, inputCountUsed });
    }

    const modelOut = await generateSnapshot(cleanedInsights, { maxOutputTokens: 420 });
    const parsed = SnapshotSchema.safeParse(modelOut.parsed);
    if (!parsed.success) return jsonError(500, "Model returned invalid snapshot JSON");

    const snapshot = parsed.data as any as ExecutiveSnapshot;
    await putCachedSnapshot({ orgId: body.orgId, quotaPeriodId: body.quotaPeriodId, inputHash, snapshot });

    return NextResponse.json({ ok: true, snapshot, cacheHit: false, inputCountUsed });
  } catch (e: any) {
    const msg = e?.issues ? "Invalid request body" : e?.message || String(e);
    return jsonError(400, msg);
  }
}

