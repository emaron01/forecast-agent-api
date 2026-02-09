import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // Dev-only: never expose env state in production.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const email = String(process.env.MASTER_ADMIN_EMAIL || "").trim();
  const hash = String(process.env.MASTER_ADMIN_PASSWORD_HASH || "").trim();
  const secret = String(process.env.SESSION_SECRET || "").trim();

  return NextResponse.json({
    ok: true,
    NODE_ENV: process.env.NODE_ENV || "development",
    MASTER_ADMIN_EMAIL_present: !!email,
    MASTER_ADMIN_EMAIL_value: email ? `${email.slice(0, 2)}***${email.slice(-2)}` : null,
    MASTER_ADMIN_PASSWORD_HASH_present: !!hash,
    MASTER_ADMIN_PASSWORD_HASH_prefix: hash ? hash.slice(0, 4) : null,
    SESSION_SECRET_present: !!secret,
    SESSION_SECRET_len: secret ? secret.length : 0,
  });
}

