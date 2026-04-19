import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";
import { createPropertyGroup } from "../../../../../lib/hubspotClient";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let orgId = 0;
  if (auth.kind === "user") {
    if (!isAdmin(auth.user)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    orgId = auth.user.org_id;
  } else {
    const mid = getMasterOrgIdFromCookies();
    if (!mid) return NextResponse.json({ ok: false, error: "Select an active organization first." }, { status: 400 });
    orgId = mid;
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const enabled = Boolean(body?.enabled);
  if (enabled) {
    const pg = await createPropertyGroup(orgId);
    if (pg.ok === false) return NextResponse.json({ ok: false, error: pg.error }, { status: 502 });
    await pool.query(`UPDATE hubspot_connections SET writeback_enabled = true, updated_at = now() WHERE org_id = $1`, [orgId]);
  } else {
    await pool.query(`UPDATE hubspot_connections SET writeback_enabled = false, updated_at = now() WHERE org_id = $1`, [orgId]);
  }

  const { rows } = await pool.query<{ writeback_enabled: boolean }>(
    `SELECT writeback_enabled FROM hubspot_connections WHERE org_id = $1 LIMIT 1`,
    [orgId]
  );
  const wb = rows?.[0]?.writeback_enabled ?? false;

  return NextResponse.json({ ok: true, writeback_enabled: wb });
}
