import { NextResponse } from "next/server";
import { getAuth } from "../../../../../../lib/auth";
import { getUserById, replaceManagerVisibility } from "../../../../../../lib/db";
import { resolvePublicId } from "../../../../../../lib/publicId";
import { ManagerVisibilitySchema } from "../../../../../../lib/validation";

export const runtime = "nodejs";

function parseIdFromUrl(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return String(parts[parts.length - 2] || "").trim(); // .../users/:publicId/visibility
}

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const managerUserPublicId = parseIdFromUrl(req);
    if (!managerUserPublicId) return NextResponse.json({ ok: false, error: "invalid_user_public_id" }, { status: 400 });
    const managerUserId = await resolvePublicId("users", managerUserPublicId);

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

    const json = await req.json().catch(() => ({}));
    const parsed = ManagerVisibilitySchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_request", issues: parsed.error.issues }, { status: 400 });

    const u = await getUserById({ orgId, userId: managerUserId });
    if (!u) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    if (u.hierarchy_level !== 1 && u.hierarchy_level !== 2) {
      return NextResponse.json({ ok: false, error: "not_a_manager" }, { status: 400 });
    }

    const visibleIds: number[] = [];
    for (const pid of parsed.data.visible_user_public_ids || []) {
      visibleIds.push(await resolvePublicId("users", pid));
    }
    await replaceManagerVisibility({
      orgId,
      managerUserId,
      visibleUserIds: visibleIds,
      see_all_visibility: parsed.data.see_all_visibility,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

