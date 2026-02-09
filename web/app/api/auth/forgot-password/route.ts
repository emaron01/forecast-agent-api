import { NextResponse } from "next/server";
import { randomToken, sha256Hex } from "../../../../lib/auth";
import { createPasswordResetToken, getOrganization, getUserByEmail } from "../../../../lib/db";
import { ForgotPasswordSchema } from "../../../../lib/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = ForgotPasswordSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ ok: true }); // generic

    const email = String(parsed.data.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ ok: true });

    const user = await getUserByEmail({ email }).catch(() => null);
    if (!user || !user.active) return NextResponse.json({ ok: true });

    const org = await getOrganization({ id: user.org_id }).catch(() => null);
    if (!org || !org.active) return NextResponse.json({ ok: true });

    const token = randomToken();
    await createPasswordResetToken({ userId: user.id, token_hash: sha256Hex(token), expires_at: new Date(Date.now() + 60 * 60 * 1000) }).catch(
      () => null
    );

    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ ok: true, reset: `/reset-password?token=${token}` });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

