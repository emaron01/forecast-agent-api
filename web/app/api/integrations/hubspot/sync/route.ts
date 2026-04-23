import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";
import { getIngestQueue, QUEUE_NAME } from "../../../../../lib/ingest-queue";

export const runtime = "nodejs";

async function org(auth: NonNullable<Awaited<ReturnType<typeof getAuth>>>) {
  if (auth.kind === "user") {
    if (!isAdmin(auth.user)) return { ok: false as const, status: 403 as const, error: "Forbidden" };
    return { ok: true as const, orgId: auth.user.org_id };
  }
  const mid = getMasterOrgIdFromCookies();
  if (!mid) return { ok: false as const, status: 400 as const, error: "Select an active organization first." };
  return { ok: true as const, orgId: mid };
}

export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const o = await org(auth);
  if (o.ok === false) return NextResponse.json({ ok: false, error: o.error }, { status: o.status });

  const { rows } = await pool.query(
    `
    SELECT
      status,
      deals_fetched,
      deals_upserted,
      deals_scored,
      started_at::text AS started_at,
      completed_at::text AS completed_at,
      error_text
    FROM hubspot_sync_log
    WHERE org_id = $1
    ORDER BY started_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [o.orgId]
  );
  const r = rows?.[0] as any;
  if (!r) {
    return NextResponse.json({
      status: "completed",
      deals_fetched: 0,
      deals_upserted: 0,
      deals_scored: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      error_text: null,
    });
  }
  return NextResponse.json({
    status: r.status,
    deals_fetched: Number(r.deals_fetched || 0),
    deals_upserted: Number(r.deals_upserted || 0),
    deals_scored: Number(r.deals_scored || 0),
    started_at: r.started_at,
    completed_at: r.completed_at,
    error_text: r.error_text,
  });
}

export async function POST() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const o = await org(auth);
  if (o.ok === false) return NextResponse.json({ ok: false, error: o.error }, { status: o.status });

  const inFlight = await pool.query<{ exists: number }>(
    `
    SELECT 1 AS exists
    FROM hubspot_sync_log
    WHERE org_id = $1
      AND status IN ('pending', 'running')
      AND started_at > now() - interval '10 minutes'
    LIMIT 1
    `,
    [o.orgId]
  );
  if (inFlight.rows.length) {
    return NextResponse.json(
      { ok: false, error: "Sync already in progress. Please wait." },
      { status: 429 }
    );
  }

  const ins = await pool.query<{ id: string }>(
    `
    INSERT INTO hubspot_sync_log (org_id, sync_type, status)
    VALUES ($1, 'manual', 'pending')
    RETURNING id::text AS id
    `,
    [o.orgId]
  );
  const syncLogId = ins.rows?.[0]?.id || "";
  const queue = getIngestQueue();
  if (!queue || QUEUE_NAME !== "opportunity-ingest") {
    await pool.query(`UPDATE hubspot_sync_log SET status = 'failed', error_text = $2, completed_at = now() WHERE id = $1::uuid`, [
      syncLogId,
      "Redis queue unavailable (REDIS_URL).",
    ]);
    return NextResponse.json({ ok: false, error: "Redis queue unavailable" }, { status: 503 });
  }

  try {
    await queue.add(
      "hubspot-initial-sync",
      { orgId: o.orgId, syncLogId, syncType: "manual" },
      {
        jobId: `hubspot-manual-sync_${o.orgId}_${syncLogId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  } catch (e: any) {
    await pool.query(`UPDATE hubspot_sync_log SET status = 'failed', error_text = $2, completed_at = now() WHERE id = $1::uuid`, [
      syncLogId,
      e?.message || String(e),
    ]);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, syncLogId });
}
