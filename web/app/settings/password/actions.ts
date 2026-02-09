"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getUserById, revokeAllUserSessions, setUserPasswordHash } from "../../../lib/db";
import { hashPassword, verifyPassword } from "../../../lib/password";
import { UpdatePasswordSchema } from "../../../lib/validation";

export async function updatePasswordAction(formData: FormData) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") redirect("/login");

  const parsed = UpdatePasswordSchema.parse({
    current_password: formData.get("current_password"),
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });

  const u = await getUserById({ orgId: ctx.user.org_id, userId: ctx.user.id });
  if (!u || !u.active) redirect("/login");

  const ok = await verifyPassword(parsed.current_password, u.password_hash);
  if (!ok) redirect("/settings/password?error=invalid_password");

  const password_hash = await hashPassword(parsed.new_password);
  await setUserPasswordHash({ orgId: ctx.user.org_id, userId: ctx.user.id, password_hash });
  await revokeAllUserSessions({ userId: ctx.user.id }).catch(() => null);

  // Current session token will be revoked; force re-login.
  redirect("/login?pw=1");
}

