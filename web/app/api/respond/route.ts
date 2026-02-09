import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Legacy LLM respond endpoint is disabled. This app is now contract-based around ingestion + opportunities + audit events only.",
    },
    { status: 410 }
  );
}

