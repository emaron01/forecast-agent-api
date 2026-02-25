import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../lib/auth";
import { exportTrainingData } from "../../../../lib/trainingExport";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (auth.kind !== "user") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const snapshotTime = url.searchParams.get("snapshot_time")?.trim();
    const snapshotOffsetDays = url.searchParams.get("snapshot_offset_days");
    const limit = url.searchParams.get("limit");

    if (!snapshotTime && (snapshotOffsetDays == null || snapshotOffsetDays === "")) {
      return NextResponse.json(
        { ok: false, error: "Training export requires snapshot_time to avoid leakage." },
        { status: 400 }
      );
    }

    const { rows, error } = await exportTrainingData({
      orgId: auth.user.org_id,
      snapshotTime: snapshotTime ?? "",
      snapshotOffsetDays: snapshotOffsetDays ? Number(snapshotOffsetDays) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    if (error) {
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, rows, count: rows.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
