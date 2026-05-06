import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";
import {
  decryptSalesforceTokenFromStorage,
} from "../../../../../lib/salesforceClient";

export const runtime = "nodejs";

export async function POST() {
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

  // Load connection before deleting so we can revoke the token
  const { rows } = await pool.query<{
    access_token_enc: string;
    instance_url: string;
  }>(
    `
    SELECT access_token_enc, instance_url
    FROM salesforce_connections
    WHERE org_id = $1
    LIMIT 1
    `,
    [orgId]
  );

  const conn = rows?.[0];

  // Best-effort token revocation — do not block disconnect on failure
  if (conn) {
    const decAccess = decryptSalesforceTokenFromStorage(conn.access_token_enc);
    if (decAccess.ok) {
      const instanceUrl = String(conn.instance_url || "").trim().replace(/\/+$/, "");
      if (instanceUrl) {
        try {
          await fetch(
            `${instanceUrl}/services/oauth2/revoke`,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token: decAccess.data }).toString(),
            }
          );
        } catch {
          // Revocation failure is non-fatal — connection is deleted regardless
        }
      }
    }
  }

  // Delete the connection record — CASCADE handles writeback_mappings and field_mappings
  await pool.query(
    `DELETE FROM salesforce_connections WHERE org_id = $1`,
    [orgId]
  );

  return NextResponse.json({ ok: true });
}
