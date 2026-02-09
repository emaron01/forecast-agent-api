import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Legacy agent tool endpoint is disabled. Use the ingestion pipeline to update opportunities and read/write audit events via contract tables only.",
    },
    { status: 410 }
  );
}
