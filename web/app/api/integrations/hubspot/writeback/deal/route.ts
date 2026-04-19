import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../../lib/auth";
import { isAdmin } from "../../../../../../lib/roleHelpers";
import { writeMatthewScoresToHubSpotDeal } from "../../../../../../lib/hubspotClient";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const dealId = String(body?.dealId || "").trim();
    const orgIdBody = Number(body?.orgId);
    if (!dealId || !Number.isFinite(orgIdBody) || orgIdBody <= 0) {
      return NextResponse.json({ ok: false, error: "dealId and orgId required" }, { status: 400 });
    }

    if (auth.kind === "user") {
      if (!isAdmin(auth.user)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      if (auth.user.org_id !== orgIdBody) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    } else {
      const mid = getMasterOrgIdFromCookies();
      if (!mid || mid !== orgIdBody) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const result = await writeMatthewScoresToHubSpotDeal({ orgId: orgIdBody, opportunityPublicId: dealId });
    if (result.ok === false) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
    }
    return NextResponse.json({ ok: true, ...result.data });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
