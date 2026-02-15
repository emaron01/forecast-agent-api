import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

const ReportType = z.string().min(1).max(80);

const BaseReportSchema = z.object({
  report_type: ReportType,
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional().nullable(),
  config: z.any(),
});

export async function GET(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const url = new URL(req.url);
  const report_type = ReportType.optional().catch(undefined).parse(url.searchParams.get("report_type") || undefined);
  const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(url.searchParams.get("limit"));

  const { rows } = await pool.query(
    `
    SELECT
      id::text AS id,
      report_type,
      name,
      description,
      config,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM analytics_saved_reports
    WHERE org_id = $1::bigint
      AND owner_user_id = $2::bigint
      AND ($3::text IS NULL OR report_type = $3::text)
    ORDER BY updated_at DESC, created_at DESC
    LIMIT $4
    `,
    [ctx.user.org_id, ctx.user.id, report_type ?? null, limit]
  );
  return NextResponse.json({ ok: true, reports: rows || [] });
}

export async function POST(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const body = await req.json().catch(() => null);
  const parsed = BaseReportSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const { report_type, name, description, config } = parsed.data;

  const { rows } = await pool.query(
    `
    INSERT INTO analytics_saved_reports (org_id, owner_user_id, report_type, name, description, config)
    VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::jsonb)
    RETURNING id::text AS id
    `,
    [ctx.user.org_id, ctx.user.id, report_type, name, description ?? null, JSON.stringify(config ?? {})]
  );
  return NextResponse.json({ ok: true, id: rows?.[0]?.id || null });
}

export async function PUT(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const body = await req.json().catch(() => null);
  const schema = BaseReportSchema.extend({ id: z.string().min(1) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const { id, report_type, name, description, config } = parsed.data;

  const { rowCount } = await pool.query(
    `
    UPDATE analytics_saved_reports
       SET report_type = $4::text,
           name = $5::text,
           description = $6::text,
           config = $7::jsonb,
           updated_at = NOW()
     WHERE org_id = $1::bigint
       AND owner_user_id = $2::bigint
       AND id = $3::uuid
    `,
    [ctx.user.org_id, ctx.user.id, id, report_type, name, description ?? null, JSON.stringify(config ?? {})]
  );
  if (!rowCount) return jsonError(404, "Not found");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const url = new URL(req.url);
  const id = z.string().min(1).parse(url.searchParams.get("id") || "");

  const { rowCount } = await pool.query(
    `
    DELETE FROM analytics_saved_reports
     WHERE org_id = $1::bigint
       AND owner_user_id = $2::bigint
       AND id = $3::uuid
    `,
    [ctx.user.org_id, ctx.user.id, id]
  );
  if (!rowCount) return jsonError(404, "Not found");
  return NextResponse.json({ ok: true });
}

