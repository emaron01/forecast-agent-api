import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "../../../lib/auth";
import { pool } from "../../../lib/pool";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

const UpsertReportSchema = z.object({
  name: z.string().min(1).max(120),
  config: z.any(),
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const { rows } = await pool.query(
    `
    SELECT id::text, name, config, updated_at
    FROM revenue_intelligence_reports
    WHERE user_id = $1 AND org_id = $2
    ORDER BY updated_at DESC
    `,
    [ctx.user.id, ctx.user.org_id]
  );

  return NextResponse.json({ ok: true, reports: rows || [] });
}

export async function POST(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const body = await req.json().catch(() => null);
  const parsed = UpsertReportSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const { name, config } = parsed.data;
  let safeConfig: Record<string, unknown>;
  try {
    safeConfig = JSON.parse(JSON.stringify(config ?? {})) as Record<string, unknown>;
  } catch {
    return jsonError(400, "Config must be JSON-serializable");
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO revenue_intelligence_reports
        (org_id, user_id, name, config)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (user_id, name)
      DO UPDATE SET
        config = EXCLUDED.config,
        updated_at = NOW()
      RETURNING id::text, name, config
      `,
      [ctx.user.org_id, ctx.user.id, name, safeConfig as object]
    );

    return NextResponse.json({ ok: true, report: rows?.[0] || null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[revenue-intelligence POST]", msg);
    return jsonError(500, msg || "Save failed");
  }
}

export async function DELETE(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const url = new URL(req.url);
  const id = z.string().min(1).parse(url.searchParams.get("id") || "");

  const { rowCount } = await pool.query(
    `
    DELETE FROM revenue_intelligence_reports
    WHERE id = $1 AND user_id = $2 AND org_id = $3
    `,
    [id, ctx.user.id, ctx.user.org_id]
  );

  if (!rowCount) return jsonError(404, "Not found");
  return NextResponse.json({ ok: true });
}

