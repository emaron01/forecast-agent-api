import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { signHubSpotOAuthState } from "../../../../../lib/hubspotClient";

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

  const clientId = String(process.env.HUBSPOT_CLIENT_ID || "").trim();
  const appUrl = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!clientId || !appUrl) {
    return NextResponse.json({ ok: false, error: "HubSpot OAuth is not configured (HUBSPOT_CLIENT_ID / APP_URL)." }, { status: 500 });
  }

  const st = signHubSpotOAuthState(orgId);
  if (st.ok === false) return NextResponse.json({ ok: false, error: st.error }, { status: 500 });

  const redirectUri = `${appUrl}/api/integrations/hubspot/callback`;
  const scopes = [
    "crm.objects.companies.read",
    "crm.objects.contacts.read",
    "crm.objects.deals.read",
    "crm.objects.deals.write",
    "crm.objects.forecasts.read",
    "crm.objects.owners.read",
    "crm.pipelines.orders.read",
    "crm.schemas.companies.read",
    "crm.schemas.contacts.read",
    "crm.schemas.deals.read",
  ].join(" ");

  const url = new URL("https://app.hubspot.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", st.data);

  redirect(url.toString());
}
