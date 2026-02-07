import { NextResponse } from "next/server";
import { sessions } from "../../agent/sessions";
import { handsfreeRuns } from "../../handsfree/runs";
import { categoryUpdateSessions } from "../../opportunities/categoryUpdateSessions";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    inMemory: {
      fullReviewSessions: sessions.size,
      handsfreeRuns: handsfreeRuns.size,
      categoryUpdateSessions: categoryUpdateSessions.size,
    },
    note: "No Redis detected; these are in-memory dev counters only.",
    at: Date.now(),
  });
}

