import { NextResponse } from "next/server";
import { Pool } from "pg";
import { sessions } from "../agent/sessions";
import { runResponsesTurn } from "../../../lib/responsesTurn";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || "");
    const text = String(body?.text || "").trim();
    if (!sessionId) return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });

    const session = sessions.get(sessionId);
    if (!session) return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });

    const { assistantText, done } = await runResponsesTurn({ pool, session, text });
    return NextResponse.json({
      ok: true,
      text: assistantText,
      done,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

