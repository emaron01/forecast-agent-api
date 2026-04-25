export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  console.log("[hs-extension:installed] callback hit, code present:", !!code, "error:", error);

  if (error) {
    console.error("[hs-extension:installed] OAuth error:", error);
    return new Response(
      `<html><body><h2>Installation failed</h2><p>${error}</p></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  if (code) {
    try {
      const clientId = process.env.HUBSPOT_EXTENSION_CLIENT_ID;
      const clientSecret = process.env.HUBSPOT_EXTENSION_CLIENT_SECRET;
      const appUrl = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
      const redirectUri = `${appUrl}/api/crm/hubspot/extension/installed`;

      console.log("[hs-extension:installed] token exchange params:", {
        grant_type: "authorization_code",
        client_id: clientId ? clientId.slice(0, 8) + "..." : "MISSING",
        client_secret: clientSecret ? "present" : "MISSING",
        redirect_uri: redirectUri,
        code: code ? code.slice(0, 8) + "..." : "MISSING",
      });

      const tokenRes = await fetch("https://api.hubapi.com/oauth/v1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
          code,
        }),
      });

      const tokenJson = await tokenRes.json();
      console.log("[hs-extension:installed] token exchange:", 
        tokenRes.status, tokenJson.token_type || tokenJson.error);
    } catch (e) {
      console.error("[hs-extension:installed] token exchange failed:", e);
    }
  }

  return new Response(
    `<html><body>
      <h2>SalesForecast.io installed successfully</h2>
      <p>You can close this tab and return to HubSpot.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
