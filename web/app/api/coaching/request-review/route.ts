import { NextResponse } from "next/server";
import { getAuth } from "../../../lib/auth";
import { pool } from "../../../lib/pool";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (auth.kind !== "user") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const role = auth.user.role;
    if (role !== "MANAGER" && role !== "EXEC_MANAGER" && role !== "ADMIN") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const opportunityId = String(body?.opportunityId ?? "").trim();
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (!opportunityId) return NextResponse.json({ ok: false, error: "opportunityId required" }, { status: 400 });

    const result = await pool.query(
      `
      UPDATE opportunities
      SET
        review_requested_by = $1,
        review_requested_at = NOW(),
        review_request_note = $2
      WHERE id = $3::bigint
        AND org_id = $4::bigint
      `,
      [auth.user.id, note || null, opportunityId, auth.user.org_id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, error: "Opportunity not found or access denied" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
