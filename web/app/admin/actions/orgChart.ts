"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "../../../lib/auth";
import { pool } from "../../../lib/pool";
import { listUsers } from "../../../lib/db";

function isNextRedirectError(e: unknown) {
  return typeof (e as any)?.digest === "string" && String((e as any).digest).startsWith("NEXT_REDIRECT");
}

function errRedirect(code: string) {
  redirect(`/admin/hierarchy?error=${encodeURIComponent(code)}`);
}

function okRedirect() {
  redirect(`/admin/hierarchy?saved=1`);
}

function detectCycle(nextManagerByUserId: Map<number, number | null>) {
  // Detect cycles in the reporting chain.
  // Classic DFS with colors over a functional graph.
  const VISITING = 1;
  const VISITED = 2;
  const state = new Map<number, number>();

  function visit(u: number): boolean {
    const st = state.get(u) || 0;
    if (st === VISITING) return true;
    if (st === VISITED) return false;
    state.set(u, VISITING);
    const p = nextManagerByUserId.get(u) ?? null;
    if (p != null && nextManagerByUserId.has(p)) {
      if (visit(p)) return true;
    }
    state.set(u, VISITED);
    return false;
  }

  for (const u of nextManagerByUserId.keys()) {
    if (visit(u)) return true;
  }
  return false;
}

export async function updateSalesOrgChartAction(formData: FormData) {
  try {
    const { ctx, orgId } = await requireOrgContext();
    if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

    const users = await listUsers({ orgId, includeInactive: true }).catch(() => []);
    const byPublicId = new Map<string, (typeof users)[number]>();
    for (const u of users) byPublicId.set(String(u.public_id), u);

    // Build desired manager assignments from form fields: mgr_<userPublicId>=<managerPublicId or ''>
    const desiredManagerByUserId = new Map<number, number | null>();
    for (const [k, v] of formData.entries()) {
      const key = String(k || "");
      if (!key.startsWith("mgr_")) continue;
      const userPublicId = key.slice("mgr_".length);
      const user = byPublicId.get(userPublicId);
      if (!user) continue;

      // Only configurable for MANAGER/REP.
      if (user.hierarchy_level !== 2 && user.hierarchy_level !== 3) continue;

      const managerPublicId = String(v || "").trim();
      if (!managerPublicId) {
        desiredManagerByUserId.set(user.id, null);
        continue;
      }

      const manager = byPublicId.get(managerPublicId);
      if (!manager) {
        errRedirect("invalid_manager");
      }
      if (manager.id === user.id) errRedirect("invalid_manager_self");

      // Enforce structure:
      // - REP (level 3) must report to MANAGER (level 2)
      // - MANAGER (level 2) must report to EXEC_MANAGER (level 1) (optional)
      if (user.hierarchy_level === 3) {
        if (manager.hierarchy_level !== 2) errRedirect("rep_manager_must_be_manager");
      } else if (user.hierarchy_level === 2) {
        if (manager.hierarchy_level !== 1) errRedirect("manager_manager_must_be_exec");
      }

      desiredManagerByUserId.set(user.id, manager.id);
    }

    // Ensure we at least included everyone we expect (best-effort, not fatal).
    // Compute final mapping for cycle detection using desired overrides, else existing.
    const finalManagerByUserId = new Map<number, number | null>();
    for (const u of users) {
      if (u.hierarchy_level !== 2 && u.hierarchy_level !== 3) continue;
      finalManagerByUserId.set(u.id, desiredManagerByUserId.has(u.id) ? (desiredManagerByUserId.get(u.id) ?? null) : (u.manager_user_id ?? null));
    }
    if (detectCycle(finalManagerByUserId)) errRedirect("cycle_detected");

    const c = await pool.connect();
    try {
      await c.query("BEGIN");

      // Apply reporting line updates.
      for (const [userId, managerId] of desiredManagerByUserId.entries()) {
        await c.query(`UPDATE users SET manager_user_id = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2`, [
          orgId,
          userId,
          managerId,
        ]);
      }

      // Rebuild visibility edges to follow the org chart:
      // - For EXEC_MANAGER/MANAGER with see_all_visibility=false: add direct-report edges (manager -> report).
      // - Recursion in getVisibleUsers gives the full subtree.
      const { rows } = await c.query(
        `
        SELECT id, role, hierarchy_level, manager_user_id, see_all_visibility, active
          FROM users
         WHERE org_id = $1
        `,
        [orgId]
      );

      const all = rows as Array<{
        id: number;
        role: string;
        hierarchy_level: number;
        manager_user_id: number | null;
        see_all_visibility: boolean;
        active: boolean;
      }>;

      const managers = all.filter((u) => (u.hierarchy_level === 1 || u.hierarchy_level === 2) && u.role !== "ADMIN");
      const managerIds = managers.map((m) => m.id);

      if (managerIds.length) {
        await c.query(`DELETE FROM manager_visibility WHERE manager_user_id = ANY($1::int[])`, [managerIds]);
      }

      const inserts: Array<[number, number]> = [];
      const byManager = new Map<number, number[]>();
      for (const u of all) {
        if (!u.active) continue;
        if (u.role === "ADMIN") continue;
        if (u.hierarchy_level < 2) continue; // visibility targets: managers + reps
        if (u.manager_user_id == null) continue;
        if (!byManager.has(u.manager_user_id)) byManager.set(u.manager_user_id, []);
        byManager.get(u.manager_user_id)!.push(u.id);
      }

      for (const m of managers) {
        if (m.see_all_visibility) continue; // edges unused
        const kids = byManager.get(m.id) || [];
        for (const childId of kids) {
          if (childId === m.id) continue;
          inserts.push([m.id, childId]);
        }
      }

      if (inserts.length) {
        const values: any[] = [];
        const rowsSql: string[] = [];
        let p = 0;
        for (const [mid, vid] of inserts) {
          values.push(mid, vid);
          rowsSql.push(`($${p + 1}, $${p + 2})`);
          p += 2;
        }
        await c.query(`INSERT INTO manager_visibility (manager_user_id, visible_user_id) VALUES ${rowsSql.join(", ")} ON CONFLICT DO NOTHING`, values);
      }

      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }

    revalidatePath("/admin/hierarchy");
    okRedirect();
  } catch (e) {
    if (isNextRedirectError(e)) throw e;
    errRedirect("invalid_request");
  }
}

