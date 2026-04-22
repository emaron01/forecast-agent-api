import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";
import { getIngestQueue, QUEUE_NAME } from "../../../../../lib/ingest-queue";
import { applyHubspotFieldMappingsToMappingSet } from "../../../../../lib/hubspotIngest";

export const runtime = "nodejs";

async function resolveOrg(auth: NonNullable<Awaited<ReturnType<typeof getAuth>>>) {
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
  const org = await resolveOrg(auth);
  if (org.ok === false) return NextResponse.json({ ok: false, error: org.error }, { status: org.status });

  const { rows } = await pool.query(
    `
    SELECT sf_field, hubspot_property, confidence::text AS confidence, is_active
      FROM hubspot_field_mappings
     WHERE org_id = $1
     ORDER BY sf_field ASC
    `,
    [org.orgId]
  );
  return NextResponse.json({ ok: true, mappings: rows || [] });
}

export async function PUT(req: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const org = await resolveOrg(auth);
  if (org.ok === false) return NextResponse.json({ ok: false, error: org.error }, { status: org.status });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const mappings = Array.isArray(body?.mappings) ? body.mappings : [];
  if (!mappings.length) return NextResponse.json({ ok: false, error: "mappings array required" }, { status: 400 });

  const triggerSync = body?.triggerSync === true;

  const client = await pool.connect();
  let syncLogId: string | null = null;
  try {
    await client.query("BEGIN");
    for (const m of mappings) {
      const sf = String(m?.sf_field || "").trim();
      const hp = m?.hubspot_property == null ? null : String(m.hubspot_property);
      const conf = String(m?.confidence || "none").trim();
      const confOk = ["high", "medium", "low", "none"].includes(conf) ? conf : "none";
      if (!sf) continue;
      await client.query(
        `
        INSERT INTO hubspot_field_mappings (org_id, sf_field, hubspot_property, confidence, is_active)
        VALUES ($1, $2, $3, $4::text, true)
        ON CONFLICT (org_id, sf_field)
        DO UPDATE SET
          hubspot_property = EXCLUDED.hubspot_property,
          confidence = EXCLUDED.confidence,
          is_active = true,
          updated_at = now()
        `,
        [org.orgId, sf, hp, confOk]
      );
    }
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  } finally {
    client.release();
  }

  await applyHubspotFieldMappingsToMappingSet(org.orgId);

  let syncQueued = false;
  if (triggerSync) {
    const ins = await pool.query<{ id: string }>(
      `
      INSERT INTO hubspot_sync_log (org_id, sync_type, status)
      VALUES ($1, 'manual', 'pending')
      RETURNING id::text AS id
      `,
      [org.orgId]
    );
    syncLogId = ins.rows?.[0]?.id || null;
    if (syncLogId) {
      const queue = getIngestQueue();
      if (queue && QUEUE_NAME === "opportunity-ingest") {
        try {
          await queue.add(
            "hubspot-initial-sync",
            { orgId: org.orgId, syncLogId, syncType: "manual" },
            {
              jobId: `hubspot-manual-sync_${org.orgId}_${syncLogId}`,
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
              removeOnComplete: true,
              removeOnFail: false,
            }
          );
          syncQueued = true;
        } catch {
          await pool.query(
            `
            UPDATE hubspot_sync_log
               SET status = 'failed',
                   completed_at = now(),
                   error_message = 'Queue unavailable'
             WHERE id = $1::bigint
            `,
            [syncLogId]
          ).catch(() => {});
        }
      } else {
        await pool.query(
          `
          UPDATE hubspot_sync_log
             SET status = 'failed',
                 completed_at = now(),
                 error_message = 'Queue unavailable'
           WHERE id = $1::bigint
          `,
          [syncLogId]
        ).catch(() => {});
      }
    }
  }

  return NextResponse.json({ ok: true, syncQueued, syncLogId: syncLogId || "" });
}
