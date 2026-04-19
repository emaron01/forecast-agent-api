import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

export async function POST() {
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

  await pool.query(`DELETE FROM hubspot_sync_log WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM hubspot_field_mappings WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM hubspot_connections WHERE org_id = $1`, [orgId]);

  await pool.query(
    `
    INSERT INTO hubspot_sync_log (org_id, sync_type, status, error_text, completed_at)
    VALUES ($1, 'manual', 'completed', 'disconnected by admin', now())
    `,
    [orgId]
  );

  return NextResponse.json({ ok: true });
}
