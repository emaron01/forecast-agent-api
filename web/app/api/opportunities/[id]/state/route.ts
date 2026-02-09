import { NextResponse } from "next/server";
import { z } from "zod";
import { getOpportunity, listOpportunityAuditEvents } from "../../../../../lib/db";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const orgId = auth.kind === "user" ? auth.user.org_id : auth.orgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 });
    const opportunityId = z.coerce.number().int().positive().parse(ctx.params.id);
    const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(url.searchParams.get("limit"));

    const opportunity = await getOpportunity({ orgId, opportunityId });
    if (!opportunity) {
      return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });
    }

    // Role scoping
    if (auth.kind === "user") {
      if (auth.user.role === "REP") {
        if (!opportunity.rep_name || opportunity.rep_name !== auth.user.account_owner_name) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
      } else if (auth.user.role === "MANAGER") {
        if (!opportunity.rep_name) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        const { rows } = await pool.query(
          `
          SELECT 1
            FROM users
           WHERE org_id = $1
             AND role = 'REP'
             AND active IS TRUE
             AND manager_user_id = $2
             AND account_owner_name = $3
           LIMIT 1
          `,
          [orgId, auth.user.id, opportunity.rep_name]
        );
        if (!rows?.length) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    const auditEvents = await listOpportunityAuditEvents({ orgId, opportunityId, limit });
    return NextResponse.json({ ok: true, opportunity, auditEvents });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

