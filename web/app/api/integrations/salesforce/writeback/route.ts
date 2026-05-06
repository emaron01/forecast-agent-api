import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";
import { verifyWritebackFields } from "../../../../../lib/salesforceClient";
import { REQUIRED_WRITEBACK_FIELDS } from "../properties/route";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let orgId = 0;
  if (auth.kind === "user") {
    if (!isAdmin(auth.user)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    orgId = auth.user.org_id;
  } else {
    const mid = getMasterOrgIdFromCookies();
    if (!mid) {
      return NextResponse.json(
        { ok: false, error: "Select an active organization first." },
        { status: 400 }
      );
    }
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
    // Verify all required custom fields exist on the Opportunity object before enabling
    const verify = await verifyWritebackFields(orgId, [...REQUIRED_WRITEBACK_FIELDS]);
    if (verify.ok === false) {
      return NextResponse.json({ ok: false, error: verify.error }, { status: 502 });
    }
    if (!verify.data.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: "Required custom fields are missing on the Salesforce Opportunity object.",
          missingFields: verify.data.missingFields,
        },
        { status: 422 }
      );
    }

    // Seed default writeback mappings if not already configured
    await pool.query(
      `
      INSERT INTO salesforce_writeback_mappings (org_id, sf_field, mode, sfdc_api_name)
      VALUES
        ($1, 'health_initial', 'sfdc_field', 'SF_Health_Score_Initial__c'),
        ($1, 'health_current', 'sfdc_field', 'SF_Health_Score_Current__c'),
        ($1, 'risk_summary',   'sfdc_field', 'SF_Risk_Summary__c'),
        ($1, 'next_steps',     'sfdc_field', 'SF_Next_Steps__c')
      ON CONFLICT (org_id, sf_field) DO NOTHING
      `,
      [orgId]
    );

    await pool.query(
      `
      UPDATE salesforce_connections
         SET writeback_enabled = true,
             updated_at = now()
       WHERE org_id = $1
      `,
      [orgId]
    );
  } else {
    await pool.query(
      `
      UPDATE salesforce_connections
         SET writeback_enabled = false,
             updated_at = now()
       WHERE org_id = $1
      `,
      [orgId]
    );
  }

  const { rows } = await pool.query<{ writeback_enabled: boolean }>(
    `SELECT writeback_enabled FROM salesforce_connections WHERE org_id = $1 LIMIT 1`,
    [orgId]
  );
  const wb = rows?.[0]?.writeback_enabled ?? false;

  return NextResponse.json({ ok: true, writeback_enabled: wb });
}
