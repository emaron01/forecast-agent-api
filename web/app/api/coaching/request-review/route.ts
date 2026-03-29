import { NextResponse } from "next/server";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";
import { isAdmin, isSalesLeader } from "../../../../lib/roleHelpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (auth.kind !== "user") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!isSalesLeader(auth.user) && !isAdmin(auth.user)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const opportunityId = String(body?.opportunityId ?? "").trim();
    const action = String(body?.action ?? "").trim();
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (!opportunityId) return NextResponse.json({ ok: false, error: "opportunityId required" }, { status: 400 });

    if (action === "clear") {
      const result = await pool.query(
        `
        UPDATE opportunities
        SET
          review_requested_by = NULL,
          review_requested_at = NULL,
          review_request_note = NULL
        WHERE public_id = $1::uuid
          AND org_id = $2::bigint
        `,
        [opportunityId, auth.user.org_id]
      );

      if (result.rowCount === 0) {
        return NextResponse.json({ ok: false, error: "Opportunity not found or access denied" }, { status: 404 });
      }

      return NextResponse.json({ ok: true });
    }

    const result = await pool.query(
      `
      UPDATE opportunities
      SET
        review_requested_by = $1,
        review_requested_at = NOW(),
        review_request_note = $2
      WHERE public_id = $3::uuid
        AND org_id = $4::bigint
      `,
      [auth.user.id, note || null, opportunityId, auth.user.org_id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, error: "Opportunity not found or access denied" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[request-review] error:", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
