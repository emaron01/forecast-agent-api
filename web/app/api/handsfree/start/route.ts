import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy hands-free mode is disabled in the contract-based app.",
    },
    { status: 410 }
  );
}

