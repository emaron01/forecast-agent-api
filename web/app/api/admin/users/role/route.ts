import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";
import { syncRepsFromUsers } from "../../../../../lib/db";

export const runtime = "nodejs";

const roleOptions = ["ADMIN", "EXEC_MANAGER", "MANAGER", "REP", "FORECAST_AGENT"] as const;
type RoleOption = (typeof roleOptions)[number];

const UpdateUserRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.string().min(1),
  orgId: z.coerce.number().int().positive().optional(),
});

function roleToHierarchyLevel(role: RoleOption) {
  return role === "ADMIN" ? 0 : role === "EXEC_MANAGER" ? 1 : role === "MANAGER" ? 2 : 3;
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (auth.kind === "user" && auth.user.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const json = await req.json().catch(() => ({}));
    const parsed = UpdateUserRoleSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

    const requestedOrgId = parsed.data.orgId ?? null;

    // Scope enforcement:
    // - user-scoped admins can only write their own org (ignore/deny any override)
    // - master/super-admin can optionally override org scope (used by all-users page)
    let orgId: number;
    if (auth.kind === "user") {
      if (requestedOrgId != null && requestedOrgId !== auth.user.org_id) {
        return NextResponse.json({ error: "forbidden_org_override" }, { status: 403 });
      }
      orgId = auth.user.org_id;
    } else {
      orgId = requestedOrgId ?? (auth.orgId || 0);
    }

    if (!orgId) return NextResponse.json({ error: "missing_org" }, { status: 400 });

    const rawRole = String(parsed.data.role || "");
    if (!roleOptions.includes(rawRole as any)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const nextRole = rawRole as RoleOption;
    const nextHierarchyLevel = roleToHierarchyLevel(nextRole);

    // Fetch current user + manager role before updating.
    const existingRes = await pool.query(
      `
      SELECT
        u.id,
        u.role,
        u.manager_user_id,
        u.admin_has_full_analytics_access,
        u.see_all_visibility,
        m.role AS manager_role
      FROM users u
      LEFT JOIN users m ON m.id = u.manager_user_id
      WHERE u.public_id = $1::uuid
        AND u.org_id = $2
      LIMIT 1
      `,
      [parsed.data.userId, orgId]
    );

    const existing = existingRes.rows?.[0] as
      | {
          id: number;
          role: string | null;
          manager_user_id: number | null;
          admin_has_full_analytics_access: boolean | null;
          see_all_visibility: boolean | null;
          manager_role: string | null;
        }
      | undefined;

    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const currentManagerUserId: number | null = existing.manager_user_id == null ? null : Number(existing.manager_user_id);
    const currentManagerRole: string | null = existing.manager_role == null ? null : String(existing.manager_role);

    // Validate manager_user_id compatibility for incoming role.
    let nextManagerUserId: number | null = currentManagerUserId;

    if (nextRole === "REP" || nextRole === "FORECAST_AGENT") {
      if (currentManagerUserId == null) {
        nextManagerUserId = null;
      } else if (currentManagerRole === "MANAGER" || currentManagerRole === "EXEC_MANAGER") {
        nextManagerUserId = currentManagerUserId;
      } else {
        return NextResponse.json(
          {
            error: `invalid_manager_user_id_for_role: ${nextRole} requires manager_role in (MANAGER, EXEC_MANAGER) or null; got ${currentManagerRole}`,
          },
          { status: 400 }
        );
      }
    } else if (nextRole === "MANAGER") {
      if (currentManagerUserId == null) {
        nextManagerUserId = null;
      } else if (currentManagerRole === "EXEC_MANAGER") {
        nextManagerUserId = currentManagerUserId;
      } else {
        return NextResponse.json(
          {
            error: `invalid_manager_user_id_for_role: MANAGER requires manager_role EXEC_MANAGER or null; got ${currentManagerRole}`,
          },
          { status: 400 }
        );
      }
    } else if (nextRole === "EXEC_MANAGER" || nextRole === "ADMIN") {
      // Manager link should be cleared for ADMIN/EXEC_MANAGER.
      nextManagerUserId = null;
    }

    // Compute the field updates based on the new role.
    const nextAdminHasFullAnalyticsAccess = nextRole === "ADMIN" || nextRole === "EXEC_MANAGER";
    const nextSeeAllVisibility = nextRole === "ADMIN" || nextRole === "EXEC_MANAGER";

    // Single UPDATE with all affected columns.
    const result = await pool.query(
      `
      UPDATE users
         SET role = $2,
             hierarchy_level = $3,
             manager_user_id = $4,
             admin_has_full_analytics_access = $5,
             see_all_visibility = $6,
             updated_at = NOW()
       WHERE org_id = $1
         AND id = $7
      RETURNING
        id,
        public_id::text AS public_id,
        role,
        hierarchy_level,
        manager_user_id,
        admin_has_full_analytics_access,
        see_all_visibility
      `,
      [orgId, nextRole, nextHierarchyLevel, nextManagerUserId, nextAdminHasFullAnalyticsAccess, nextSeeAllVisibility, existing.id]
    );

    if ((result.rowCount || 0) !== 1) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Keep rep directory in sync (role/active + edges).
    // This step is best-effort: role update should still succeed even if sync is transiently failing.
    try {
      await syncRepsFromUsers({ organizationId: orgId });
    } catch (syncErr) {
      console.error("syncRepsFromUsers failed", syncErr);
    }

    const updated = result.rows?.[0] as any;
    return NextResponse.json({ ok: true, user: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

