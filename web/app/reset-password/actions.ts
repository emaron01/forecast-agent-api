"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { consumePasswordResetToken, getUserByIdAny, revokeAllUserSessions, setUserPasswordHashByUserId } from "../../lib/db";
import { sha256Hex } from "../../lib/auth";
import { hashPassword } from "../../lib/password";

const Schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export async function resetPasswordAction(formData: FormData) {
  const parsed = Schema.parse({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  const tokenHash = sha256Hex(parsed.token);
  const consumed = await consumePasswordResetToken({ token_hash: tokenHash });
  if (!consumed) redirect("/reset-password?error=1");

  const user = await getUserByIdAny({ userId: consumed.user_id });
  if (!user || !user.active) redirect("/reset-password?error=1");

  const password_hash = await hashPassword(parsed.password);
  await setUserPasswordHashByUserId({ userId: user.id, password_hash });
  await revokeAllUserSessions({ userId: user.id }).catch(() => null);

  redirect("/login?reset=1");
}

