"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createUserSession, getOrganization, getUserByEmail, revokeSessionByTokenHash } from "../../lib/db";
import {
  clearMasterSessionCookie,
  clearUserSessionCookie,
  isMasterAdminEmail,
  randomToken,
  setMasterOrgCookie,
  setMasterSessionCookie,
  setUserSessionCookie,
  sha256Hex,
} from "../../lib/auth";
import { verifyPassword } from "../../lib/password";

const Schema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

function redirectError(code: string) {
  redirect(`/login?error=${encodeURIComponent(code)}`);
}

function isNextRedirectError(e: unknown) {
  return typeof (e as any)?.digest === "string" && String((e as any).digest).startsWith("NEXT_REDIRECT");
}

function looksLikeBcryptHash(h: string) {
  return /^\$2[aby]\$\d\d\$/.test(String(h || ""));
}

export async function loginAction(formData: FormData) {
  try {
    const parsed = Schema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) redirectError("invalid_request");

    const email = String(parsed.data.email).trim().toLowerCase();
    const password = String(parsed.data.password);

    // Master admin override (outside orgs/users table)
    if (isMasterAdminEmail(email)) {
      const masterHash = String(process.env.MASTER_ADMIN_PASSWORD_HASH || "").trim();
      if (!masterHash) redirectError("master_misconfigured");
      if (!looksLikeBcryptHash(masterHash)) redirectError("master_bad_hash");

      const ok = await verifyPassword(password, masterHash);
      if (!ok) redirectError("invalid_password");

      // Prefer master session (clear user session if present)
      clearUserSessionCookie();
      setMasterSessionCookie(email);

      setMasterOrgCookie(null);

      redirect("/admin/organizations");
    }

    const user = await getUserByEmail({ email });
    if (!user) redirectError("invalid_email");
    if (!user.active) redirectError("user_inactive");

    const org = await getOrganization({ id: user.org_id });
    if (!org) redirectError("invalid_org");
    if (!org.active) redirectError("org_inactive");

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) redirectError("invalid_password");

    // Ensure any stale cookie doesn't keep access after logout.
    const existingToken = String(formData.get("__existingSessionToken") || "");
    if (existingToken) {
      await revokeSessionByTokenHash({ session_token_hash: sha256Hex(existingToken) }).catch(() => null);
    }

    const token = randomToken();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await createUserSession({ userId: user.id, session_token_hash: sha256Hex(token), expires_at: expires });

    // Prefer user session (clear master session if present)
    clearMasterSessionCookie();
    setUserSessionCookie(token);

    if (user.role === "ADMIN") redirect("/admin");
    redirect("/dashboard");
  } catch (e) {
    if (isNextRedirectError(e)) throw e;
    redirectError("unknown");
  }
}

