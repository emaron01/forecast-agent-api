import { NextResponse } from "next/server";
import { getAuth } from "../../../../lib/auth";
import { getCommentIngestionById } from "../../../../lib/db";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth();
    if (!auth || auth.kind !== "user") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const ingestionId = parseInt(String(id || ""), 10);
    if (!Number.isFinite(ingestionId)) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const row = await getCommentIngestionById({ orgId: auth.user.org_id, id: ingestionId });
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const extracted = row.extracted_json as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      id: row.id,
      raw_text: row.raw_text,
      summary: extracted?.summary ?? "",
      risk_flags: extracted?.risk_flags ?? [],
      next_steps: extracted?.next_steps ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
