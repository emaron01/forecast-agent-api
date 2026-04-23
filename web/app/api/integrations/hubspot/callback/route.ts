import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { pool } from "../../../../../lib/pool";
import {
  encryptHubSpotTokenForStorage,
  hubspotExchangeCodeForTokens,
  populateHubSpotHubDomainIfMissing,
  verifyHubSpotOAuthState,
} from "../../../../../lib/hubspotClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = String(url.searchParams.get("code") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  if (!code || !state) return NextResponse.json({ ok: false, error: "Missing code or state" }, { status: 400 });

  const verified = verifyHubSpotOAuthState(state);
  if (verified.ok === false) return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });

  const { orgId, hubTier } = verified.data;
  const appUrl = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  const redirectUri = `${appUrl}/api/integrations/hubspot/callback`;

  const tok = await hubspotExchangeCodeForTokens({ code, redirectUri });
  if (tok.ok === false) return NextResponse.json({ ok: false, error: tok.error }, { status: 400 });

  const encAccess = encryptHubSpotTokenForStorage(tok.data.access_token);
  const encRefresh = encryptHubSpotTokenForStorage(tok.data.refresh_token);
  if (!encAccess.ok || !encRefresh.ok) {
    return NextResponse.json({ ok: false, error: "Could not encrypt tokens" }, { status: 500 });
  }

  const hubId = String(tok.data.hub_id || "").trim() || "unknown";
  const expiresAt = new Date(Date.now() + (tok.data.expires_in > 0 ? tok.data.expires_in : 1800) * 1000);
  const scopes = tok.data.scope_parts || [];

  await pool.query(
    `
    INSERT INTO hubspot_connections (
      org_id, hub_id, hub_domain, access_token_enc, refresh_token_enc, token_expires_at, scopes, writeback_enabled, hub_tier, updated_at
    ) VALUES ($1, $2, NULL, $3, $4, $5, $6::text[], false, $7, now())
    ON CONFLICT (org_id) DO UPDATE SET
      hub_id = EXCLUDED.hub_id,
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      token_expires_at = EXCLUDED.token_expires_at,
      scopes = EXCLUDED.scopes,
      hub_tier = EXCLUDED.hub_tier,
      updated_at = now()
    `,
    [orgId, hubId, encAccess.data, encRefresh.data, expiresAt.toISOString(), scopes.length ? scopes : null, hubTier]
  );

  await populateHubSpotHubDomainIfMissing({
    orgId,
    accessToken: tok.data.access_token,
  });

  redirect(`${appUrl}/admin/integrations/hubspot`);
}
