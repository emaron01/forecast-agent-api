import { NextResponse } from "next/server";
import { getAuth } from "../../../lib/auth";
import { pool } from "../../../lib/pool";

export const runtime = "nodejs";

/*
 * Expired rows can be cleaned up periodically:
 *   DELETE FROM ai_takeaway_cache
 *     WHERE expires_at < NOW();
 * Consider running this as a weekly cron.
 */

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.kind !== "user") return jsonError(403, "Forbidden");

  const url = new URL(req.url);
  const orgIdParam = Number(url.searchParams.get("org_id") || "");
  const surface = String(url.searchParams.get("surface") || "").trim();
  const payloadSha = String(url.searchParams.get("payload_sha") || "").trim();

  if (!Number.isFinite(orgIdParam) || orgIdParam !== auth.user.org_id) {
    return jsonError(403, "Forbidden");
  }
  if (!surface || !payloadSha) {
    return jsonError(400, "Missing surface or payload_sha");
  }

  try {
    const r = await pool.query<{ summary: string; extended: string | null }>(
      `SELECT summary, extended
       FROM ai_takeaway_cache
       WHERE org_id = $1
         AND surface = $2
         AND payload_sha = $3
         AND expires_at > NOW()
       LIMIT 1`,
      [auth.user.org_id, surface, payloadSha]
    );
    const row = r.rows?.[0];
    if (row?.summary) {
      return NextResponse.json({ ok: true, summary: row.summary, extended: row.extended ?? null });
    }
    return NextResponse.json({ ok: false });
  } catch (e: any) {
    return jsonError(500, String(e?.message || e));
  }
}

export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.kind !== "user") return jsonError(403, "Forbidden");

  let body: { org_id?: unknown; surface?: unknown; payload_sha?: unknown; summary?: unknown; extended?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const orgId = Number(body.org_id);
  const surface = String(body.surface || "").trim();
  const payloadSha = String(body.payload_sha || "").trim();
  const summary = String(body.summary || "").trim();
  const extendedRaw = body.extended;
  const extended = extendedRaw == null || extendedRaw === undefined ? null : String(extendedRaw);

  if (!Number.isFinite(orgId) || orgId !== auth.user.org_id) {
    return jsonError(403, "Forbidden");
  }
  if (!surface || !payloadSha || !summary) {
    return jsonError(400, "Missing surface, payload_sha, or summary");
  }

  try {
    await pool.query(
      `INSERT INTO ai_takeaway_cache
         (org_id, surface, payload_sha, summary, extended, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours')
       ON CONFLICT (org_id, surface, payload_sha)
       DO UPDATE SET
         summary = EXCLUDED.summary,
         extended = EXCLUDED.extended,
         expires_at = NOW() + INTERVAL '24 hours',
         updated_at = NOW()`,
      [auth.user.org_id, surface, payloadSha, summary, extended]
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(500, String(e?.message || e));
  }
}
