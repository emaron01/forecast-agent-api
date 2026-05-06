import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { signSalesforceOAuthState } from "../../../../../lib/salesforceClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
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

  const clientId = String(process.env.SALESFORCE_CLIENT_ID || "").trim();
  const redirectUri = String(process.env.SALESFORCE_REDIRECT_URI || "").trim();
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "Salesforce OAuth is not configured (SALESFORCE_CLIENT_ID / SALESFORCE_REDIRECT_URI)." },
      { status: 500 }
    );
  }

  // sandbox=true param allows connecting a Salesforce sandbox org
  const reqUrl = new URL(req.url);
  const sandbox = reqUrl.searchParams.get("sandbox") === "true";

  const st = signSalesforceOAuthState(orgId);
  if (st.ok === false) {
    return NextResponse.json({ ok: false, error: st.error }, { status: 500 });
  }

  const baseUrl = sandbox
    ? "https://test.salesforce.com/services/oauth2/authorize"
    : "https://login.salesforce.com/services/oauth2/authorize";

  const url = new URL(baseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "api full refresh_token offline_access");
  url.searchParams.set("state", st.data);

  redirect(url.toString());
}
