import { NextResponse } from "next/server";
import {
  clearMasterSessionCookie,
  clearUserSessionCookie,
  isMasterAdminEmail,
  randomToken,
  setMasterOrgCookie,
  setMasterSessionCookie,
  setUserSessionCookie,
  sha256Hex,
} from "../../../../lib/auth";
import { createUserSession, getOrganization, getUserByEmail, revokeSessionByTokenHash } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/password";
import { LoginSchema } from "../../../../lib/validation";

export const runtime = "nodejs";

function looksLikeBcryptHash(h: string) {
  return /^\$2[aby]\$\d\d\$/.test(String(h || ""));
}

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = LoginSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });

    const email = String(parsed.data.email || "").trim().toLowerCase();
    const password = String(parsed.data.password || "");
    const existingSessionToken = String((json as any)?.existingSessionToken || "");

    // Master admin override (outside orgs/users table)
    if (isMasterAdminEmail(email)) {
      const masterPlain = String(process.env.MASTER_ADMIN_PASSWORD || "").trim();
      const masterHash = String(process.env.MASTER_ADMIN_PASSWORD_HASH || "").trim();

      let ok = false;
      if (masterPlain) {
        ok = password === masterPlain;
      } else {
        if (!masterHash) return NextResponse.json({ ok: false, error: "master_misconfigured" }, { status: 500 });
        if (!looksLikeBcryptHash(masterHash)) return NextResponse.json({ ok: false, error: "master_bad_hash" }, { status: 500 });
        ok = await verifyPassword(password, masterHash);
      }
      if (!ok) return NextResponse.json({ ok: false, error: "invalid_password" }, { status: 401 });

      clearUserSessionCookie();
      setMasterSessionCookie(email);
      setMasterOrgCookie(null);

      return NextResponse.json({ ok: true, kind: "master" });
    }

    const user = await getUserByEmail({ email });
    if (!user) return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 401 });
    if (!user.active) return NextResponse.json({ ok: false, error: "user_inactive" }, { status: 401 });

    const org = await getOrganization({ id: user.org_id });
    if (!org) return NextResponse.json({ ok: false, error: "invalid_org" }, { status: 401 });
    if (!org.active) return NextResponse.json({ ok: false, error: "org_inactive" }, { status: 401 });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return NextResponse.json({ ok: false, error: "invalid_password" }, { status: 401 });

    if (existingSessionToken) {
      await revokeSessionByTokenHash({ session_token_hash: sha256Hex(existingSessionToken) }).catch(() => null);
    }

    const token = randomToken();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await createUserSession({ userId: user.id, session_token_hash: sha256Hex(token), expires_at: expires });

    clearMasterSessionCookie();
    setUserSessionCookie(token);

    return NextResponse.json({
      ok: true,
      kind: "user",
      user: {
        public_id: user.public_id,
        org_public_id: org.public_id,
        role: user.role,
        email: user.email,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

