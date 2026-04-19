import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";
import { buildHubSpotAutoMap } from "../../../../../lib/hubspotAutoMap";
import { getDealProperties } from "../../../../../lib/hubspotClient";

export const runtime = "nodejs";

export async function GET() {
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

  const propsRes = await getDealProperties(orgId);
  if (propsRes.ok === false) return NextResponse.json({ ok: false, error: propsRes.error }, { status: 502 });

  const names = propsRes.data.map((p) => p.name).filter(Boolean);
  const suggestions = buildHubSpotAutoMap(names);

  const { rows: savedRows } = await pool.query(
    `
    SELECT sf_field, hubspot_property, confidence::text AS confidence, is_active
      FROM hubspot_field_mappings
     WHERE org_id = $1
     ORDER BY sf_field ASC
    `,
    [orgId]
  );

  return NextResponse.json({
    properties: propsRes.data,
    suggestions,
    saved: savedRows || [],
  });
}
