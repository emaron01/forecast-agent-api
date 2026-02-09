import { NextResponse } from "next/server";
import { getAuth, randomToken, sha256Hex } from "../../../../../../lib/auth";
import { createPasswordResetToken, getUserById } from "../../../../../../lib/db";
import { resolvePublicId } from "../../../../../../lib/publicId";

export const runtime = "nodejs";

function parseIdFromUrl(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return String(parts[parts.length - 2] || "").trim(); // .../users/:publicId/reset-password
}

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const userPublicId = parseIdFromUrl(req);
    if (!userPublicId) return NextResponse.json({ ok: false, error: "invalid_user_public_id" }, { status: 400 });
    const userId = await resolvePublicId("users", userPublicId);

    const url = new URL(req.url);
    const orgPublicId = String(url.searchParams.get("orgPublicId") || "").trim();
    const explicitOrgId = orgPublicId ? await resolvePublicId("organizations", orgPublicId) : 0;
    const cookieOrgId = auth.kind === "master" ? auth.orgId || 0 : 0;
    if (auth.kind === "master" && explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
      return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
    }
    const orgId = auth.kind === "user" ? auth.user.org_id : explicitOrgId || cookieOrgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    if (auth.kind === "user" && auth.user.role !== "ADMIN") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const u = await getUserById({ orgId, userId });
    if (!u) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const token = randomToken();
    await createPasswordResetToken({ userId: u.id, token_hash: sha256Hex(token), expires_at: new Date(Date.now() + 60 * 60 * 1000) });

    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ ok: true, reset: `/reset-password?token=${token}` });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

