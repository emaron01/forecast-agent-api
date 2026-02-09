import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Legacy category update is disabled. The current database contract does not include scoring columns on opportunities.",
    },
    { status: 410 }
  );
}

