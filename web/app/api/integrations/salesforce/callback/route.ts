import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { pool } from "../../../../../lib/pool";
import {
  encryptSalesforceTokenForStorage,
  salesforceExchangeCodeForTokens,
  verifySalesforceOAuthState,
} from "../../../../../lib/salesforceClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = String(url.searchParams.get("code") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  const error = String(url.searchParams.get("error") || "").trim();
  const errorDescription = String(url.searchParams.get("error_description") || "").trim();

  // Salesforce sends error param on denial
  if (error) {
    return NextResponse.json(
      { ok: false, error: errorDescription || error },
      { status: 400 }
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      { ok: false, error: "Missing code or state" },
      { status: 400 }
    );
  }

  const verified = verifySalesforceOAuthState(state);
  if (verified.ok === false) {
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
  }

  const { orgId } = verified.data;
  const redirectUri = String(process.env.SALESFORCE_REDIRECT_URI || "").trim();

  // Detect sandbox from state is not needed — sandbox orgs use test.salesforce.com
  // which sends the callback to the same redirect URI. We detect by checking the
  // instance_url returned in the token response (sandbox instance URLs contain
  // ".sandbox." or start with "https://cs" / "https://test").
  const tok = await salesforceExchangeCodeForTokens({
    code,
    redirectUri,
    sandbox: false, // initial attempt as production
  });

  if (tok.ok === false) {
    return NextResponse.json({ ok: false, error: tok.error }, { status: 400 });
  }

  const encAccess = encryptSalesforceTokenForStorage(tok.data.access_token);
  const encRefresh = encryptSalesforceTokenForStorage(tok.data.refresh_token);
  if (!encAccess.ok || !encRefresh.ok) {
    return NextResponse.json(
      { ok: false, error: "Could not encrypt tokens" },
      { status: 500 }
    );
  }

  const instanceUrl = tok.data.instance_url;
  const sfOrgId = String(tok.data.sf_org_id || "").trim() || "unknown";
  const scopes = tok.data.scope_parts || [];

  // Detect sandbox from instance URL
  const sandbox =
    instanceUrl.includes(".sandbox.") ||
    /^https:\/\/cs\d+\./.test(instanceUrl) ||
    instanceUrl.includes("scratch.") ||
    instanceUrl.includes("test.salesforce.com");

  // SFDC access tokens expire in 2 hours
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

  await pool.query(
    `
    INSERT INTO salesforce_connections (
      org_id,
      sf_org_id,
      instance_url,
      sf_domain,
      access_token_enc,
      refresh_token_enc,
      token_expires_at,
      scopes,
      writeback_enabled,
      sandbox,
      api_version,
      updated_at
    ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7::text[], false, $8, 'v59.0', now())
    ON CONFLICT (org_id) DO UPDATE SET
      sf_org_id           = EXCLUDED.sf_org_id,
      instance_url        = EXCLUDED.instance_url,
      access_token_enc    = EXCLUDED.access_token_enc,
      refresh_token_enc   = EXCLUDED.refresh_token_enc,
      token_expires_at    = EXCLUDED.token_expires_at,
      scopes              = EXCLUDED.scopes,
      sandbox             = EXCLUDED.sandbox,
      updated_at          = now()
    `,
    [
      orgId,
      sfOrgId,
      instanceUrl,
      encAccess.data,
      encRefresh.data,
      expiresAt.toISOString(),
      scopes.length ? scopes : null,
      sandbox,
    ]
  );

  const appUrl = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  redirect(`${appUrl}/admin/integrations/salesforce`);
}
