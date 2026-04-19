import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";
import { getDealEngagements, getDeals } from "../../../../../lib/hubspotClient";
import { getHubspotScoringCloseDateBounds } from "../../../../../lib/hubspotIngest";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await getAuth();
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Unauthorized", checked: false, deals_checked: 0, deals_with_notes: 0 }, { status: 401 });
    }

    let orgId = 0;
    if (auth.kind === "user") {
      if (!isAdmin(auth.user)) {
        return NextResponse.json({ ok: false, error: "Forbidden", checked: false, deals_checked: 0, deals_with_notes: 0 }, { status: 403 });
      }
      orgId = auth.user.org_id;
    } else {
      const mid = getMasterOrgIdFromCookies();
      if (!mid) {
        return NextResponse.json(
          { ok: false, error: "Select an active organization first.", checked: false, deals_checked: 0, deals_with_notes: 0 },
          { status: 400 }
        );
      }
      orgId = mid;
    }

    const { rows: connRows } = await pool.query(`SELECT 1 FROM hubspot_connections WHERE org_id = $1 LIMIT 1`, [orgId]);
    if (!connRows?.length) {
      return NextResponse.json({ ok: true, checked: false, deals_checked: 0, deals_with_notes: 0 });
    }

    const { after, before } = getHubspotScoringCloseDateBounds();
    const page = await getDeals(orgId, {
      limit: 100,
      closeDateAfter: after,
      closeDateBefore: before,
    });
    if (page.ok === false) {
      return NextResponse.json({ ok: true, checked: false, deals_checked: 0, deals_with_notes: 0 });
    }

    const deals = page.data.deals || [];
    let dealsWithNotes = 0;
    for (const d of deals) {
      const id = String(d?.id || "").trim();
      if (!id) continue;
      const eng = await getDealEngagements(orgId, id);
      if (eng.ok === false) continue;
      const hasNote = eng.data.some((e) => e.type === "NOTE" && String(e.body || "").trim().length > 0);
      if (hasNote) dealsWithNotes++;
    }

    const dealsChecked = deals.filter((d) => String(d?.id || "").trim()).length;
    return NextResponse.json({
      ok: true,
      checked: true,
      deals_checked: dealsChecked,
      deals_with_notes: dealsWithNotes,
    });
  } catch {
    return NextResponse.json({ ok: true, checked: false, deals_checked: 0, deals_with_notes: 0 });
  }
}
