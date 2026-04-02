import { pool } from "./pool";
import type { AuthUser } from "./auth";
import {
  HIERARCHY,
  isAdmin,
  isChannelExec,
  isChannelManager,
  isChannelRep,
  isChannelRole,
  isManager,
  isRep,
  isSalesLeader,
} from "./roleHelpers";

export type RepDirectoryRow = {
  id: number;
  name: string;
  role: string | null;
  hierarchy_level: number | null;
  manager_rep_id: number | null;
  user_id: number | null;
  active: boolean | null;
};

async function listActiveRepsForOrg(orgId: number): Promise<RepDirectoryRow[]> {
  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
      r.role,
      u.hierarchy_level,
      r.manager_rep_id,
      r.user_id,
      r.active
    FROM reps r
    LEFT JOIN users u
      ON u.org_id = $1::bigint
     AND u.id = r.user_id
    WHERE r.organization_id = $1::bigint
      AND (r.active IS TRUE OR r.active IS NULL)
    ORDER BY
      COALESCE(u.hierarchy_level, 99) ASC,
      name ASC,
      r.id ASC
    `,
    [orgId]
  );
  return (rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    hierarchy_level: r.hierarchy_level == null ? null : Number(r.hierarchy_level),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  }));
}

async function getRepForUser(orgId: number, userId: number): Promise<RepDirectoryRow | null> {
  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
      r.role,
      u.hierarchy_level,
      r.manager_rep_id,
      r.user_id,
      r.active
    FROM reps r
    LEFT JOIN users u
      ON u.org_id = $1::bigint
     AND u.id = r.user_id
    WHERE r.organization_id = $1::bigint
      AND r.user_id = $2::bigint
    ORDER BY r.id DESC
    LIMIT 1
    `,
    [orgId, userId]
  );
  const r = rows?.[0] as any;
  if (!r) return null;
  return {
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    hierarchy_level: r.hierarchy_level == null ? null : Number(r.hierarchy_level),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  };
}

async function getRepById(orgId: number, repId: number): Promise<RepDirectoryRow | null> {
  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
      r.role,
      u.hierarchy_level,
      r.manager_rep_id,
      r.user_id,
      r.active
    FROM reps r
    LEFT JOIN users u
      ON u.org_id = $1::bigint
     AND u.id = r.user_id
    WHERE r.organization_id = $1::bigint
      AND r.id = $2::bigint
    LIMIT 1
    `,
    [orgId, repId]
  );
  const r = rows?.[0] as any;
  if (!r) return null;
  return {
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    hierarchy_level: r.hierarchy_level == null ? null : Number(r.hierarchy_level),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  };
}

export async function getScopedRepDirectory(args: {
  orgId: number;
  user: AuthUser;
  /** Prevents infinite recursion when following users.manager_user_id alignment chains. */
  depth?: number;
}): Promise<{
  repDirectory: RepDirectoryRow[];
  allowedRepIds: number[] | null; // null => no filter (admin)
  myRepId: number | null;
}> {
  const orgId = Number(args.orgId);
  const userId = Number(args.user.id);
  const depth = args.depth ?? 0;

  if (!Number.isFinite(orgId) || orgId <= 0) return { repDirectory: [], allowedRepIds: [], myRepId: null };
  if (!Number.isFinite(userId) || userId <= 0) return { repDirectory: [], allowedRepIds: [], myRepId: null };

  if (depth > 10) {
    const me = await getRepForUser(orgId, userId).catch(() => null);
    if (!me) return { repDirectory: [], allowedRepIds: [], myRepId: null };
    return { repDirectory: [me], allowedRepIds: [me.id], myRepId: me.id };
  }

  if (isAdmin(args.user)) {
    const all = await listActiveRepsForOrg(orgId).catch(() => []);
    return { repDirectory: all, allowedRepIds: null, myRepId: null };
  }

  if (isSalesLeader(args.user) && args.user.see_all_visibility) {
    const allReps = await listActiveRepsForOrg(orgId).catch(() => []);
    return {
      repDirectory: allReps,
      allowedRepIds: null,
      myRepId: null,
    };
  }

  // Channel roles: optional users.manager_user_id aligns data scope to that user (sales leader / anchor).
  if (isChannelRole(args.user)) {
    const { rows: muRows } = await pool.query(
      `SELECT manager_user_id FROM users WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, userId]
    );
    const mid = muRows?.[0]?.manager_user_id;
    if (mid != null) {
      const anchorUserId = Number(mid);
      if (Number.isFinite(anchorUserId) && anchorUserId > 0 && anchorUserId !== userId) {
        const { rows: arRows } = await pool.query(
          `SELECT id, public_id::text AS public_id, org_id, email, role::text AS role, hierarchy_level, display_name, account_owner_name, manager_user_id, admin_has_full_analytics_access, see_all_visibility, active
             FROM users
            WHERE org_id = $1 AND id = $2 LIMIT 1`,
          [orgId, anchorUserId]
        );
        const anchorUser = arRows?.[0]
          ? ({
              id: Number(arRows[0].id),
              public_id: String(arRows[0].public_id || ""),
              org_id: Number(arRows[0].org_id),
              email: String(arRows[0].email || ""),
              role: arRows[0].role as AuthUser["role"],
              hierarchy_level: Number(arRows[0].hierarchy_level ?? HIERARCHY.REP) || HIERARCHY.REP,
              display_name: String(arRows[0].display_name || ""),
              account_owner_name: arRows[0].account_owner_name == null ? null : String(arRows[0].account_owner_name || ""),
              manager_user_id: arRows[0].manager_user_id == null ? null : Number(arRows[0].manager_user_id),
              admin_has_full_analytics_access: !!arRows[0].admin_has_full_analytics_access,
              see_all_visibility: !!arRows[0].see_all_visibility,
              active: !!arRows[0].active,
            } satisfies AuthUser)
          : null;
        if (!anchorUser) return { repDirectory: [], allowedRepIds: [], myRepId: null };
        return getScopedRepDirectory({
          orgId,
          user: anchorUser,
          depth: depth + 1,
        });
      }
    }
    if (isChannelExec(args.user) || isChannelManager(args.user)) {
      const me = await getRepForUser(orgId, userId).catch(() => null);
      if (!me) return { repDirectory: [], allowedRepIds: [], myRepId: null };
      return { repDirectory: [me], allowedRepIds: [me.id], myRepId: me.id };
    }
    // CHANNEL_REP without users.manager_user_id: fall through to REP-style scope using reps tree.
  }

  const me = await getRepForUser(orgId, userId).catch(() => null);
  if (!me) return { repDirectory: [], allowedRepIds: [], myRepId: null };

  if (isRep(args.user) || isChannelRep(args.user)) {
    const manager = me.manager_rep_id ? await getRepById(orgId, me.manager_rep_id).catch(() => null) : null;
    const exec = manager?.manager_rep_id ? await getRepById(orgId, manager.manager_rep_id).catch(() => null) : null;
    const list = [exec, manager, me].filter(Boolean) as RepDirectoryRow[];
    const uniq = Array.from(new Map(list.map((r) => [r.id, r] as const)).values());
    return { repDirectory: uniq, allowedRepIds: [me.id], myRepId: me.id };
  }

  if (isManager(args.user)) {
    const exec = me.manager_rep_id ? await getRepById(orgId, me.manager_rep_id).catch(() => null) : null;
    const { rows } = await pool.query(
      `
      SELECT
        r.id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
        r.role,
        u.hierarchy_level,
        r.manager_rep_id,
        r.user_id,
        r.active
      FROM reps r
      LEFT JOIN users u
        ON u.org_id = $1::bigint
       AND u.id = r.user_id
      WHERE r.organization_id = $1::bigint
        AND COALESCE(u.hierarchy_level, 99) = $3::int
        AND r.manager_rep_id = $2::bigint
        AND (r.active IS TRUE OR r.active IS NULL)
      ORDER BY name ASC, id ASC
      `,
      [orgId, me.id, HIERARCHY.REP]
    );
    const reps = (rows || []).map((r: any) => ({
      id: Number(r.id),
      name: String(r.name || "").trim() || "(Unnamed)",
      role: r.role == null ? null : String(r.role),
      hierarchy_level: r.hierarchy_level == null ? null : Number(r.hierarchy_level),
      manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
      user_id: r.user_id == null ? null : Number(r.user_id),
      active: r.active == null ? null : !!r.active,
    }));
    const allowed = [me.id, ...reps.map((r) => r.id)];
    const list = [exec, me, ...reps].filter(Boolean) as RepDirectoryRow[];
    const uniq = Array.from(new Map(list.map((r) => [r.id, r] as const)).values());
    return { repDirectory: uniq, allowedRepIds: allowed, myRepId: me.id };
  }

  // EXEC_MANAGER and channel leadership/sales roles default to exec-style org visibility.
  // IMPORTANT: exec visibility should include the full descendant tree (not just 1 level of managers → reps),
  // otherwise team dropdowns can miss indirect reports.
  const { rows } = await pool.query(
    `
    WITH RECURSIVE tree AS (
      SELECT
        r.id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
        r.role,
        u.hierarchy_level,
        r.manager_rep_id,
        r.user_id,
        r.active,
        ARRAY[r.id] AS path
      FROM reps r
      LEFT JOIN users u
        ON u.org_id = $1::bigint
       AND u.id = r.user_id
      WHERE r.organization_id = $1::bigint
        AND r.id = $2::bigint

      UNION ALL

      SELECT
        c.id,
        COALESCE(NULLIF(btrim(c.display_name), ''), NULLIF(btrim(c.rep_name), ''), '(Unnamed)') AS name,
        c.role,
        uc.hierarchy_level,
        c.manager_rep_id,
        c.user_id,
        c.active,
        (t.path || c.id)
      FROM reps c
      JOIN tree t
        ON c.manager_rep_id = t.id
      LEFT JOIN users uc
        ON uc.org_id = $1::bigint
       AND uc.id = c.user_id
      WHERE c.organization_id = $1::bigint
        AND (c.active IS TRUE OR c.active IS NULL)
        AND NOT (c.id = ANY(t.path))
    )
    SELECT DISTINCT ON (id)
      id,
      name,
      role,
      hierarchy_level,
      manager_rep_id,
      user_id,
      active
    FROM tree
    ORDER BY
      id ASC,
      COALESCE(hierarchy_level, 99) ASC,
      name ASC
    `,
    [orgId, me.id]
  );

  const list = (rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    hierarchy_level: r.hierarchy_level == null ? null : Number(r.hierarchy_level),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  })) as RepDirectoryRow[];

  // Keep stable ordering: exec → managers → reps, alphabetical.
  list.sort((a, b) => {
    const rank = (x: RepDirectoryRow) => Number.isFinite(Number(x.hierarchy_level)) ? Number(x.hierarchy_level) : 99;
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    const dn = a.name.localeCompare(b.name);
    if (dn !== 0) return dn;
    return a.id - b.id;
  });

  const allowed = Array.from(new Set(list.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0)));
  return { repDirectory: list, allowedRepIds: allowed, myRepId: me.id };
}

