import { NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { getUserById, updateUser, deleteUser, replaceManagerVisibility } from "../../../../../lib/db";
import { resolvePublicId } from "../../../../../lib/publicId";
import { UpdateUserSchema } from "../../../../../lib/validation";

export const runtime = "nodejs";

function buildDisplayName(first_name: string, last_name: string) {
  return `${String(first_name || "").trim()} ${String(last_name || "").trim()}`.trim();
}

function parseIdFromUrl(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return String(parts[parts.length - 1] || "").trim();
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const userPublicId = parseIdFromUrl(req);
    if (!userPublicId) return NextResponse.json({ ok: false, error: "invalid_user_public_id" }, { status: 400 });
    const userId = await resolvePublicId("users", userPublicId);

    const json = await req.json().catch(() => ({}));
    const parsed = UpdateUserSchema.safeParse({ ...json, public_id: userPublicId });
    if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_request", issues: parsed.error.issues }, { status: 400 });

    const explicitOrgId =
      auth.kind === "master" && String((json as any)?.org_public_id || "")
        ? await resolvePublicId("organizations", String((json as any)?.org_public_id))
        : 0;
    const cookieOrgId = auth.kind === "master" ? auth.orgId || 0 : 0;
    if (auth.kind === "master" && explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
      return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
    }
    const orgId = auth.kind === "user" ? auth.user.org_id : explicitOrgId || cookieOrgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    if (auth.kind === "user" && auth.user.role !== "ADMIN") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const existing = await getUserById({ orgId, userId });
    if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const manager_user_id =
      parsed.data.manager_user_public_id != null
        ? await resolvePublicId("users", parsed.data.manager_user_public_id)
        : null;
    if (manager_user_id) {
      const mgr = await getUserById({ orgId, userId: manager_user_id });
      if (!mgr) return NextResponse.json({ ok: false, error: "invalid_manager_user" }, { status: 400 });
    }

    const expectedLevel =
      parsed.data.role === "ADMIN" ? 0 : parsed.data.role === "EXEC_MANAGER" ? 1 : parsed.data.role === "MANAGER" ? 2 : 3;
    const hierarchy_level = parsed.data.hierarchy_level ?? expectedLevel;

    const updated = await updateUser({
      org_id: orgId,
      id: userId,
      email: parsed.data.email ?? existing.email,
      role: parsed.data.role,
      hierarchy_level,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      display_name: buildDisplayName(parsed.data.first_name, parsed.data.last_name),
      account_owner_name: String(parsed.data.account_owner_name || "").trim() || null,
      manager_user_id,
      admin_has_full_analytics_access: parsed.data.admin_has_full_analytics_access ?? false,
      see_all_visibility: parsed.data.see_all_visibility ?? false,
      active: parsed.data.active ?? true,
    });
    if (!updated) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    if (hierarchy_level === 1 || hierarchy_level === 2) {
      const visibleIds: number[] = [];
      for (const pid of parsed.data.visible_user_public_ids || []) {
        visibleIds.push(await resolvePublicId("users", pid));
      }
      await replaceManagerVisibility({
        orgId,
        managerUserId: updated.id,
        visibleUserIds: visibleIds,
        see_all_visibility: !!parsed.data.see_all_visibility,
      });
    } else {
      await replaceManagerVisibility({ orgId, managerUserId: updated.id, visibleUserIds: [], see_all_visibility: false }).catch(() => null);
    }

    const { id: _id, org_id: _orgId, manager_user_id: _mgr, password_hash: _pw, ...publicUser } = updated as any;
    return NextResponse.json({ ok: true, user: publicUser });
  } catch (e: any) {
    if (String(e?.code || "") === "23505") return NextResponse.json({ ok: false, error: "email_taken" }, { status: 409 });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
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

    if (auth.kind === "user" && auth.user.id === userId) {
      return NextResponse.json({ ok: false, error: "cannot_delete_self" }, { status: 400 });
    }

    const existing = await getUserById({ orgId, userId });
    if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    await deleteUser({ orgId, userId });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

