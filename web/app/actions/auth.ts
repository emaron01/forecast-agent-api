"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import {
  clearMasterSessionCookie,
  clearUserSessionCookie,
  getAuth,
  setMasterOrgCookie,
  sha256Hex,
} from "../../lib/auth";
import { revokeSessionByTokenHash } from "../../lib/db";
import { resolvePublicId } from "../../lib/publicId";

export async function logoutAction() {
  const ctx = await getAuth();
  if (ctx?.kind === "user") {
    await revokeSessionByTokenHash({ session_token_hash: sha256Hex(ctx.session_token) }).catch(() => null);
    clearUserSessionCookie();
    redirect("/login");
  }
  if (ctx?.kind === "master") {
    clearMasterSessionCookie();
    redirect("/login");
  }
  redirect("/login");
}

const MasterOrgSchema = z.object({
  org_public_id: z.string().uuid().nullable(),
  returnTo: z.string().min(1),
});

export async function setMasterOrgAction(formData: FormData) {
  const ctx = await getAuth();
  if (!ctx || ctx.kind !== "master") redirect("/login");

  const raw = String(formData.get("org_public_id") || "").trim();
  const org_public_id = raw ? raw : null;
  const parsed = MasterOrgSchema.parse({
    org_public_id,
    returnTo: formData.get("returnTo"),
  });

  const orgId = parsed.org_public_id ? await resolvePublicId("organizations", parsed.org_public_id) : null;
  setMasterOrgCookie(orgId);
  redirect(parsed.returnTo);
}

