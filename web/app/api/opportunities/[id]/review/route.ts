import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Legacy review workflow is disabled. Use the contract-based endpoints (opportunity read + audit events + ingestion pipeline).",
    },
    { status: 410 }
  );
}

