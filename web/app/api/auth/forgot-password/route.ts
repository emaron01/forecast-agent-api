import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { sha256Hex } from "../../../../lib/auth";
import { createPasswordResetToken, getOrganization, getUserByEmail } from "../../../../lib/db";
import { sendEmail } from "../../../../lib/emailService";
import { ForgotPasswordSchema } from "../../../../lib/validation";
import { pool } from "../../../../lib/pool";

export const runtime = "nodejs";

const GENERIC = { message: "If that email is registered, a reset link has been sent." };

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = ForgotPasswordSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json(GENERIC, { status: 200 });

    const email = String(parsed.data.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json(GENERIC, { status: 200 });

    const user = await getUserByEmail({ email }).catch(() => null);
    if (!user || !user.active) return NextResponse.json(GENERIC, { status: 200 });

    const org = await getOrganization({ id: user.org_id }).catch(() => null);
    if (!org || !org.active) return NextResponse.json(GENERIC, { status: 200 });

    await pool
      .query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [user.id])
      .catch(() => null);

    const token = randomUUID();
    const createdRow = await createPasswordResetToken({
      userId: user.id,
      token_hash: sha256Hex(token),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).catch(() => null);
    if (!createdRow) return NextResponse.json(GENERIC, { status: 200 });

    const base = String(process.env.APP_URL || "").replace(/\/+$/, "");
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;

    const displayName = String(user.display_name || "").trim();
    const name =
      displayName ||
      `${String(user.first_name || "").trim()} ${String(user.last_name || "").trim()}`.trim() ||
      user.email;

    await sendEmail({
      templateType: "password_reset",
      to: user.email,
      userId: user.id,
      orgId: user.org_id,
      variables: { name, reset_link: resetUrl },
    });

    return NextResponse.json(GENERIC, { status: 200 });
  } catch {
    return NextResponse.json(GENERIC, { status: 200 });
  }
}
