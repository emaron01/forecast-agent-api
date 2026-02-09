import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Rep settings are not supported by the current database contract (no rep_settings table in schema).",
    },
    { status: 410 }
  );
}

export async function PATCH() {
  return GET();
}

