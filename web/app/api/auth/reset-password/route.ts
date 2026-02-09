import { NextResponse } from "next/server";
import { sha256Hex } from "../../../../lib/auth";
import { hashPassword } from "../../../../lib/password";
import { ResetPasswordSchema } from "../../../../lib/validation";
import { consumePasswordResetToken, getUserByIdAny, revokeAllUserSessions, setUserPasswordHashByUserId } from "../../../../lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = ResetPasswordSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });

    const tokenHash = sha256Hex(parsed.data.token);
    const consumed = await consumePasswordResetToken({ token_hash: tokenHash });
    if (!consumed) return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 400 });

    const user = await getUserByIdAny({ userId: consumed.user_id });
    if (!user || !user.active) return NextResponse.json({ ok: false, error: "invalid_user" }, { status: 400 });

    const password_hash = await hashPassword(parsed.data.password);
    await setUserPasswordHashByUserId({ userId: user.id, password_hash });
    await revokeAllUserSessions({ userId: user.id }).catch(() => null);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

