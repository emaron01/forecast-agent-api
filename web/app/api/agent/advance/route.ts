import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy agent advance endpoint is disabled.",
    },
    { status: 410 }
  );
}
