import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "../../../lib/auth";
import { pool } from "../../../lib/pool";

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

const UpsertBucketSetSchema = z.object({
  name: z.string().min(1).max(120),
  buckets: z.array(BucketSchema).max(200),
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const { rows } = await pool.query(
    `
    SELECT id::text, name, buckets, updated_at
    FROM revenue_buckets
    WHERE user_id = $1 AND org_id = $2
    ORDER BY updated_at DESC
    `,
    [ctx.user.id, ctx.user.org_id]
  );

  return NextResponse.json({ ok: true, bucketSets: rows || [] });
}

export async function POST(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const body = await req.json().catch(() => null);
  const parsed = UpsertBucketSetSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const { name, buckets } = parsed.data;

  const { rows } = await pool.query(
    `
    INSERT INTO revenue_buckets (org_id, user_id, name, buckets)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, name)
    DO UPDATE SET
      buckets = EXCLUDED.buckets,
      updated_at = NOW()
    RETURNING id::text, name, buckets
    `,
    [ctx.user.org_id, ctx.user.id, name, JSON.stringify(buckets)]
  );

  return NextResponse.json({ ok: true, bucketSet: rows?.[0] || null });
}

export async function DELETE(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return jsonError(403, "Forbidden");

  const url = new URL(req.url);
  const id = z.string().min(1).parse(url.searchParams.get("id") || "");

  const { rowCount } = await pool.query(
    `
    DELETE FROM revenue_buckets
    WHERE id = $1 AND user_id = $2 AND org_id = $3
    `,
    [id, ctx.user.id, ctx.user.org_id]
  );

  if (!rowCount) return jsonError(404, "Not found");
  return NextResponse.json({ ok: true });
}

