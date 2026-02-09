import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Legacy agent init is disabled. Use ingestion pipeline endpoints to load opportunities, and read audit events via /api/opportunities/[id]/state.",
    },
    { status: 410 }
  );
}
