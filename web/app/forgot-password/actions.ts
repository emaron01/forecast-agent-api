"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createPasswordResetToken, getOrganization, getUserByEmail } from "../../lib/db";
import { randomToken, sha256Hex } from "../../lib/auth";

const Schema = z.object({
  email: z.string().min(1),
});

export async function forgotPasswordAction(formData: FormData) {
  const parsed = Schema.parse({
    email: formData.get("email"),
  });

  const email = String(parsed.email || "").trim().toLowerCase();

  // Always respond generically to avoid account enumeration.
  if (!email) redirect("/forgot-password?sent=1");

  const user = await getUserByEmail({ email }).catch(() => null);
  if (!user || !user.active) redirect("/forgot-password?sent=1");

  const org = await getOrganization({ id: user.org_id }).catch(() => null);
  if (!org || !org.active) redirect("/forgot-password?sent=1");

  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await createPasswordResetToken({ userId: user.id, token_hash: tokenHash, expires_at: expires }).catch(() => null);

  if (process.env.NODE_ENV !== "production") {
    redirect(`/forgot-password?sent=1&reset=${encodeURIComponent(`/reset-password?token=${token}`)}`);
  }

  redirect("/forgot-password?sent=1");
}

