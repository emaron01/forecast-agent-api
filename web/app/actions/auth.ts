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
  orgId: z.coerce.number().int().positive().nullable(),
  returnTo: z.string().min(1),
});

export async function setMasterOrgAction(formData: FormData) {
  const ctx = await getAuth();
  if (!ctx || ctx.kind !== "master") redirect("/login");

  const rawOrg = formData.get("orgId");
  const orgId = rawOrg == null || String(rawOrg) === "" ? null : Number(rawOrg);
  const parsed = MasterOrgSchema.parse({
    orgId: orgId && Number.isFinite(orgId) && orgId > 0 ? orgId : null,
    returnTo: formData.get("returnTo"),
  });

  setMasterOrgCookie(parsed.orgId);
  redirect(parsed.returnTo);
}

