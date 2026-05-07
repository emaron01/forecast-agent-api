export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/pool";
import { randomToken, sha256Hex } from "../../../../../../lib/auth";
import { verifySalesforceExtensionToken } from "../../../../../../lib/salesforceExtensionJwt";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get("token") || "").trim();
  const mode  = String(url.searchParams.get("mode")  || "").trim();

  const appUrlEnv = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  const appUrl    = appUrlEnv || url.origin.replace(/\/+$/, "");

  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
  }

  let payload: Awaited<ReturnType<typeof verifySalesforceExtensionToken>>;
  try {
    payload = await verifySalesforceExtensionToken(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  if (payload.purpose !== "review") {
    return NextResponse.json({ ok: false, error: "Invalid token purpose" }, { status: 403 });
  }

  const repRes = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM reps WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [payload.rep_id, payload.org_id]
  );
  const userId = repRes.rows[0]?.user_id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Rep not found" }, { status: 404 });
  }

  const sessionToken = randomToken();
  const tokenHash    = sha256Hex(sessionToken);

  await pool.query(
    `INSERT INTO user_sessions (user_id, session_token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '14 days')`,
    [userId, tokenHash]
  );

  // Reuse the HubSpot review page — it's CRM-agnostic once authenticated
  const reviewUrl = `${appUrl}/crm/hubspot/review?token=${encodeURIComponent(token)}${mode ? `&mode=${mode}` : ""}`;

  const response = NextResponse.redirect(reviewUrl);
  response.cookies.set("fa_session", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });
  return response;
}
