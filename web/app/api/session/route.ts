import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Realtime is intentionally disabled in this codebase now.
  // The app uses a turn-based pipeline (STT -> Responses -> optional TTS).
  void req;
  return NextResponse.json(
    { error: "Realtime is disabled. Use /api/stt + /api/respond (+ /api/tts)." },
    { status: 410 }
  );
}
