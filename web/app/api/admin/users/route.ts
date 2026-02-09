import { NextResponse } from "next/server";
import { getAuth } from "../../../../lib/auth";
import { hashPassword } from "../../../../lib/password";
import {
  createUser,
  listAllUsersAcrossOrgs,
  getOrganization,
  getUserById,
  listUsers,
  replaceManagerVisibility,
} from "../../../../lib/db";
import { resolvePublicId } from "../../../../lib/publicId";
import { CreateUserSchema } from "../../../../lib/validation";

export const runtime = "nodejs";

function buildDisplayName(first_name: string, last_name: string) {
  return `${String(first_name || "").trim()} ${String(last_name || "").trim()}`.trim();
}

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const orgPublicIdParam = String(url.searchParams.get("orgPublicId") || "").trim();
    const includeInactive = String(url.searchParams.get("includeInactive") || "true") !== "false";

    if (auth.kind === "master") {
      const cookieOrgId = auth.orgId || 0;
      const explicitOrgId = orgPublicIdParam ? await resolvePublicId("organizations", orgPublicIdParam) : 0;
      if (explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
        return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
      }
      const effectiveOrgId = explicitOrgId || cookieOrgId || 0;
      if (effectiveOrgId) {
        const org = await getOrganization({ id: effectiveOrgId }).catch(() => null);
        const users = await listUsers({ orgId: effectiveOrgId, includeInactive });
        return NextResponse.json({
          ok: true,
          org_public_id: org?.public_id || null,
          users: users.map(({ id: _id, org_id: _orgId, manager_user_id: _mgr, ...u }: any) => u),
        });
      }
      const users = await listAllUsersAcrossOrgs({ includeInactive, includeSuspendedOrgs: true });
      return NextResponse.json({
        ok: true,
        users: users.map(({ id: _id, org_id: _orgId, manager_user_id: _mgr, ...u }: any) => u),
      });
    }

    if (auth.user.role !== "ADMIN") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    const users = await listUsers({ orgId: auth.user.org_id, includeInactive });
    return NextResponse.json({
      ok: true,
      org_public_id: null,
      users: users.map(({ id: _id, org_id: _orgId, manager_user_id: _mgr, ...u }: any) => u),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const json = await req.json().catch(() => ({}));
    const parsed = CreateUserSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_request", issues: parsed.error.issues }, { status: 400 });

    const explicitOrgId = auth.kind === "master" && parsed.data.org_public_id ? await resolvePublicId("organizations", parsed.data.org_public_id) : 0;
    const cookieOrgId = auth.kind === "master" ? auth.orgId || 0 : 0;
    if (auth.kind === "master" && explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
      return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
    }
    const orgId = auth.kind === "user" ? auth.user.org_id : explicitOrgId || cookieOrgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    if (auth.kind === "user" && auth.user.role !== "ADMIN") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const manager_user_id =
      parsed.data.manager_user_public_id != null
        ? await resolvePublicId("users", parsed.data.manager_user_public_id)
        : null;
    if (manager_user_id) {
      const mgr = await getUserById({ orgId, userId: manager_user_id });
      if (!mgr) return NextResponse.json({ ok: false, error: "invalid_manager_user" }, { status: 400 });
    }

    const password_hash = await hashPassword(parsed.data.password);
    const created = await createUser({
      org_id: orgId,
      email: parsed.data.email,
      password_hash,
      role: parsed.data.role,
      hierarchy_level: parsed.data.hierarchy_level,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      display_name: buildDisplayName(parsed.data.first_name, parsed.data.last_name),
      account_owner_name: String(parsed.data.account_owner_name || "").trim() || null,
      manager_user_id,
      admin_has_full_analytics_access: parsed.data.admin_has_full_analytics_access ?? false,
      see_all_visibility: parsed.data.see_all_visibility ?? false,
      active: parsed.data.active ?? true,
    });

    // Visibility setup.
    if (created.hierarchy_level === 1 || created.hierarchy_level === 2) {
      const visibleIds: number[] = [];
      for (const pid of parsed.data.visible_user_public_ids || []) {
        visibleIds.push(await resolvePublicId("users", pid));
      }
      await replaceManagerVisibility({
        orgId,
        managerUserId: created.id,
        visibleUserIds: visibleIds,
        see_all_visibility: !!parsed.data.see_all_visibility,
      });
    }

    const { id: _id, org_id: _orgId, manager_user_id: _mgr, password_hash: _pw, ...publicUser } = created as any;
    return NextResponse.json({ ok: true, user: publicUser }, { status: 201 });
  } catch (e: any) {
    // Unique email constraint
    if (String(e?.code || "") === "23505") return NextResponse.json({ ok: false, error: "email_taken" }, { status: 409 });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

