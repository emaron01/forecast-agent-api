export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { pool } from "../../../../../lib/pool";
import { verifyExtensionToken } from "../../../../../lib/hubspotExtensionJwt";

function jsonError(status: number, msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = String(url.searchParams.get("token") || "").trim();
    if (!token) return jsonError(400, "Missing token");

    let payload: Awaited<ReturnType<typeof verifyExtensionToken>>;
    try {
      payload = await verifyExtensionToken(token);
    } catch {
      return jsonError(401, "Invalid or expired token");
    }

    if (payload.purpose !== "dashboard") return jsonError(403, "Invalid token purpose");

    const repRes = await pool.query<{ user_id: number }>(
      `SELECT user_id
         FROM reps
        WHERE id = $1
          AND org_id = $2
        LIMIT 1`,
      [payload.rep_id, payload.org_id]
    );
    if (!repRes.rows[0]?.user_id) return jsonError(404, "Rep not found");
    const user_id = Number(repRes.rows[0].user_id);

    const sessionToken = randomToken();
    const tokenHash = sha256Hex(sessionToken);
    await pool.query(
      `INSERT INTO user_sessions (user_id, session_token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '14 days')`,
      [user_id, tokenHash]
    );

    const appUrlEnv = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
    const origin = new URL(req.url).origin.replace(/\/+$/, "");
    const appUrl = appUrlEnv || origin;

    const response = NextResponse.redirect(`${appUrl}/dashboard`);
    response.cookies.set("fa_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 14 * 24 * 60 * 60,
    });
    return response;
  } catch (e) {
    console.error("[hs-extension:dashboard]", e);
    return jsonError(500, "Server error");
  }
}

