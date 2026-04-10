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

async function listActiveSalesRepsForOrg(orgId: number): Promise<RepDirectoryRow[]> {
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
    JOIN users u
      ON u.id = r.user_id
     AND u.org_id = $1::bigint
    WHERE r.organization_id = $1::bigint
      AND (r.active IS TRUE OR r.active IS NULL)
      AND u.hierarchy_level BETWEEN 1 AND 3
    ORDER BY name ASC, r.id ASC
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

function scopeUserIdsFromRepRows(rows: RepDirectoryRow[], viewerUserId: number): number[] {
  const ids = new Set<number>();
  if (Number.isFinite(viewerUserId) && viewerUserId > 0) ids.add(viewerUserId);
  for (const r of rows) {
    const uid = r.user_id;
    if (uid != null && Number.isFinite(Number(uid)) && Number(uid) > 0) ids.add(Number(uid));
  }
  return Array.from(ids);
}

/** Channel exec/director (6/7) linked via users.manager_user_id to anyone already in the sales scope (by user id). */
async function channelLeadersForManagerUserScope(args: { orgId: number; scopeUserIds: number[] }): Promise<RepDirectoryRow[]> {
  const ids = Array.from(new Set(args.scopeUserIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) return [];

  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
      r.role::text AS role,
      u.hierarchy_level,
      mgr_r.id AS manager_rep_id,
      r.user_id,
      r.active
    FROM users u
    INNER JOIN reps r
      ON r.user_id = u.id
     AND r.organization_id = $1::bigint
    LEFT JOIN reps mgr_r
      ON mgr_r.user_id = u.manager_user_id
     AND mgr_r.organization_id = $1::bigint
     AND (mgr_r.active IS TRUE OR mgr_r.active IS NULL)
    WHERE u.org_id = $1::bigint
      AND u.hierarchy_level IN ($2::int, $3::int)
      AND (u.active IS TRUE OR u.active IS NULL)
      AND u.manager_user_id = ANY($4::bigint[])
      AND (r.active IS TRUE OR r.active IS NULL)
    ORDER BY COALESCE(u.hierarchy_level, 99) ASC, name ASC, r.id ASC
    `,
    [args.orgId, HIERARCHY.CHANNEL_EXEC, HIERARCHY.CHANNEL_MANAGER, ids]
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

function mergeRepDirectoryByRepId(base: RepDirectoryRow[], extras: RepDirectoryRow[]): RepDirectoryRow[] {
  const map = new Map<number, RepDirectoryRow>();
  for (const r of base) map.set(r.id, r);
  for (const r of extras) {
    if (!map.has(r.id)) map.set(r.id, r);
  }
  return Array.from(map.values());
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
    const allReps = await listActiveSalesRepsForOrg(orgId).catch(() => []);
    const scopeUserIds = scopeUserIdsFromRepRows(allReps, userId);
    const channelLeaders = await channelLeadersForManagerUserScope({ orgId, scopeUserIds }).catch(() => []);
    const merged = mergeRepDirectoryByRepId(allReps, channelLeaders);
    merged.sort((a, b) => {
      const rank = (x: RepDirectoryRow) => (Number.isFinite(Number(x.hierarchy_level)) ? Number(x.hierarchy_level) : 99);
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      const dn = a.name.localeCompare(b.name);
      if (dn !== 0) return dn;
      return a.id - b.id;
    });
    return {
      repDirectory: merged,
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
    const list = [exec, me, ...reps].filter(Boolean) as RepDirectoryRow[];
    const uniq = Array.from(new Map(list.map((r) => [r.id, r] as const)).values());
    const scopeUserIds = scopeUserIdsFromRepRows(uniq, userId);
    const channelLeaders = await channelLeadersForManagerUserScope({ orgId, scopeUserIds }).catch(() => []);
    const merged = mergeRepDirectoryByRepId(uniq, channelLeaders);
    const allowed = Array.from(
      new Set([me.id, ...reps.map((r) => r.id), ...merged.map((r) => r.id)].filter((n) => Number.isFinite(n) && n > 0))
    );
    return { repDirectory: merged, allowedRepIds: allowed, myRepId: me.id };
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

  const scopeUserIds = scopeUserIdsFromRepRows(list, userId);
  const channelLeaders = await channelLeadersForManagerUserScope({ orgId, scopeUserIds }).catch(() => []);
  const merged = mergeRepDirectoryByRepId(list, channelLeaders);
  merged.sort((a, b) => {
    const rank = (x: RepDirectoryRow) => (Number.isFinite(Number(x.hierarchy_level)) ? Number(x.hierarchy_level) : 99);
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    const dn = a.name.localeCompare(b.name);
    if (dn !== 0) return dn;
    return a.id - b.id;
  });

  const allowed = Array.from(new Set(merged.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0)));
  return { repDirectory: merged, allowedRepIds: allowed, myRepId: me.id };
}

/**
 * Channel leadership subtree via users.manager_user_id (not reps.manager_rep_id / sales tree).
 * Viewer must be CHANNEL_EXEC (6) or CHANNEL_DIRECTOR (7). Returns viewer + descendants with
 * hierarchy_level in 6–8 only. manager_rep_id on each row is the manager's rep id when the manager
 * is also a channel user (6–8); otherwise null.
 */
export async function getChannelSubtreeRepDirectory(args: { orgId: number; user: AuthUser }): Promise<RepDirectoryRow[]> {
  const orgId = Number(args.orgId);
  const userId = Number(args.user.id);
  if (!Number.isFinite(orgId) || orgId <= 0) return [];
  if (!Number.isFinite(userId) || userId <= 0) return [];
  if (!isChannelExec(args.user) && !isChannelManager(args.user)) return [];

  const hlExec = HIERARCHY.CHANNEL_EXEC;
  const hlMgr = HIERARCHY.CHANNEL_MANAGER;
  const hlRep = HIERARCHY.CHANNEL_REP;

  const { rows } = await pool.query(
    `
    WITH RECURSIVE subtree_users AS (
      SELECT u.id AS user_id
      FROM users u
      WHERE u.org_id = $1::bigint
        AND u.id = $2::bigint
        AND u.hierarchy_level IN ($3::int, $4::int)

      UNION

      SELECT u.id
      FROM users u
      INNER JOIN subtree_users su ON u.manager_user_id = su.user_id
      WHERE u.org_id = $1::bigint
        AND (u.active IS TRUE OR u.active IS NULL)
        AND u.hierarchy_level BETWEEN $3::int AND $5::int
    )
    SELECT
      r.id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
      r.role,
      ur.hierarchy_level,
      mgr_r.id AS manager_rep_id,
      r.user_id,
      r.active
    FROM subtree_users su
    JOIN users ur ON ur.id = su.user_id AND ur.org_id = $1::bigint
    JOIN reps r ON r.user_id = ur.id AND r.organization_id = $1::bigint
    LEFT JOIN users mu
      ON mu.id = ur.manager_user_id
     AND mu.org_id = $1::bigint
     AND mu.hierarchy_level BETWEEN $3::int AND $5::int
    LEFT JOIN reps mgr_r
      ON mgr_r.user_id = mu.id
     AND mgr_r.organization_id = $1::bigint
     AND (mgr_r.active IS TRUE OR mgr_r.active IS NULL)
    WHERE (r.active IS TRUE OR r.active IS NULL)
    ORDER BY COALESCE(ur.hierarchy_level, 99) ASC, name ASC, r.id ASC
    `,
    [orgId, userId, hlExec, hlMgr, hlRep]
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

