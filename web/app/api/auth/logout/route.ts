import { NextResponse } from "next/server";
import { clearMasterSessionCookie, clearUserSessionCookie, sha256Hex } from "../../../../lib/auth";
import { getAuth } from "../../../../lib/auth";
import { revokeSessionByTokenHash } from "../../../../lib/db";

export const runtime = "nodejs";

export async function POST() {
  try {
    const auth = await getAuth();
    if (auth?.kind === "user") {
      await revokeSessionByTokenHash({ session_token_hash: sha256Hex(auth.session_token) }).catch(() => null);
      clearUserSessionCookie();
    } else if (auth?.kind === "master") {
      clearMasterSessionCookie();
    } else {
      // best-effort clear both
      clearUserSessionCookie();
      clearMasterSessionCookie();
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

