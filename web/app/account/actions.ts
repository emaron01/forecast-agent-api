"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { clearUserSessionCookie, requireAuth, sha256Hex } from "../../lib/auth";
import { getUserByIdAny, revokeAllUserSessions, revokeSessionByTokenHash, setUserPasswordHashByUserId } from "../../lib/db";
import { hashPassword, verifyPassword } from "../../lib/password";

const Schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function updateMyPasswordAction(formData: FormData) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") redirect("/admin/organizations");

  const parsed = Schema.parse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });

  const user = await getUserByIdAny({ userId: ctx.user.id });
  if (!user || !user.active) throw new Error("User not found");

  const ok = await verifyPassword(parsed.currentPassword, user.password_hash);
  if (!ok) throw new Error("Current password is incorrect");

  const password_hash = await hashPassword(parsed.newPassword);
  await setUserPasswordHashByUserId({ userId: user.id, password_hash });

  // Log out everywhere after password change.
  await revokeAllUserSessions({ userId: user.id }).catch(() => null);
  await revokeSessionByTokenHash({ session_token_hash: sha256Hex(ctx.session_token) }).catch(() => null);
  clearUserSessionCookie();
  redirect("/login?pw=1");
}

