import { pool } from "./pool";
import { isChannelRole } from "./userRoles";

function roleStringToScopedRole(
  role: string
):
  | "ADMIN"
  | "EXEC_MANAGER"
  | "MANAGER"
  | "REP"
  | "CHANNEL_EXECUTIVE"
  | "CHANNEL_DIRECTOR"
  | "CHANNEL_REP" {
  const r = String(role || "").trim();
  switch (r) {
    case "ADMIN":
      return "ADMIN";
    case "EXEC_MANAGER":
      return "EXEC_MANAGER";
    case "MANAGER":
      return "MANAGER";
    case "REP":
      return "REP";
    case "CHANNEL_EXECUTIVE":
      return "CHANNEL_EXECUTIVE";
    case "CHANNEL_DIRECTOR":
      return "CHANNEL_DIRECTOR";
    case "CHANNEL_REP":
      return "CHANNEL_REP";
    default:
      return "REP";
  }
}

export type RepDirectoryRow = {
  id: number;
  name: string;
  role: string | null;
  manager_rep_id: number | null;
  user_id: number | null;
  active: boolean | null;
};

async function listActiveRepsForOrg(orgId: number): Promise<RepDirectoryRow[]> {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), '(Unnamed)') AS name,
      role,
      manager_rep_id,
      user_id,
      active
    FROM reps
    WHERE organization_id = $1::bigint
      AND (active IS TRUE OR active IS NULL)
    ORDER BY
      CASE
        WHEN role = 'EXEC_MANAGER' THEN 0
        WHEN role = 'MANAGER' THEN 1
        WHEN role = 'REP' THEN 2
        ELSE 9
      END,
      name ASC,
      id ASC
    `,
    [orgId]
  );
  return (rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  }));
}

async function getRepForUser(orgId: number, userId: number): Promise<RepDirectoryRow | null> {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), '(Unnamed)') AS name,
      role,
      manager_rep_id,
      user_id,
      active
    FROM reps
    WHERE organization_id = $1::bigint
      AND user_id = $2::bigint
    ORDER BY id DESC
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
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  };
}

async function getRepById(orgId: number, repId: number): Promise<RepDirectoryRow | null> {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), '(Unnamed)') AS name,
      role,
      manager_rep_id,
      user_id,
      active
    FROM reps
    WHERE organization_id = $1::bigint
      AND id = $2::bigint
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
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  };
}

export async function getScopedRepDirectory(args: {
  orgId: number;
  userId: number;
  role:
    | "ADMIN"
    | "EXEC_MANAGER"
    | "MANAGER"
    | "REP"
    | "CHANNEL_EXECUTIVE"
    | "CHANNEL_DIRECTOR"
    | "CHANNEL_REP";
  /** Prevents infinite recursion when following users.manager_user_id alignment chains. */
  depth?: number;
}): Promise<{
  repDirectory: RepDirectoryRow[];
  allowedRepIds: number[] | null; // null => no filter (admin)
  myRepId: number | null;
}> {
  const orgId = Number(args.orgId);
  const userId = Number(args.userId);
  const role = args.role;
  const depth = args.depth ?? 0;

  if (!Number.isFinite(orgId) || orgId <= 0) return { repDirectory: [], allowedRepIds: [], myRepId: null };
  if (!Number.isFinite(userId) || userId <= 0) return { repDirectory: [], allowedRepIds: [], myRepId: null };

  if (depth > 10) {
    const me = await getRepForUser(orgId, userId).catch(() => null);
    if (!me) return { repDirectory: [], allowedRepIds: [], myRepId: null };
    return { repDirectory: [me], allowedRepIds: [me.id], myRepId: me.id };
  }

  if (role === "ADMIN") {
    const all = await listActiveRepsForOrg(orgId).catch(() => []);
    return { repDirectory: all, allowedRepIds: null, myRepId: null };
  }

  // Channel roles: optional users.manager_user_id aligns data scope to that user (sales leader / anchor).
  if (isChannelRole(role)) {
    const { rows: muRows } = await pool.query(
      `SELECT manager_user_id FROM users WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, userId]
    );
    const mid = muRows?.[0]?.manager_user_id;
    if (mid != null) {
      const anchorUserId = Number(mid);
      if (Number.isFinite(anchorUserId) && anchorUserId > 0 && anchorUserId !== userId) {
        const { rows: arRows } = await pool.query(
          `SELECT role::text AS role FROM users WHERE org_id = $1 AND id = $2 LIMIT 1`,
          [orgId, anchorUserId]
        );
        const anchorRole = roleStringToScopedRole(String(arRows?.[0]?.role || "REP"));
        return getScopedRepDirectory({
          orgId,
          userId: anchorUserId,
          role: anchorRole,
          depth: depth + 1,
        });
      }
    }
    if (role === "CHANNEL_EXECUTIVE" || role === "CHANNEL_DIRECTOR") {
      const me = await getRepForUser(orgId, userId).catch(() => null);
      if (!me) return { repDirectory: [], allowedRepIds: [], myRepId: null };
      return { repDirectory: [me], allowedRepIds: [me.id], myRepId: me.id };
    }
    // CHANNEL_REP without users.manager_user_id: fall through to REP-style scope using reps tree.
  }

  const me = await getRepForUser(orgId, userId).catch(() => null);
  if (!me) return { repDirectory: [], allowedRepIds: [], myRepId: null };

  if (role === "REP" || role === "CHANNEL_REP") {
    const manager = me.manager_rep_id ? await getRepById(orgId, me.manager_rep_id).catch(() => null) : null;
    const exec = manager?.manager_rep_id ? await getRepById(orgId, manager.manager_rep_id).catch(() => null) : null;
    const list = [exec, manager, me].filter(Boolean) as RepDirectoryRow[];
    const uniq = Array.from(new Map(list.map((r) => [r.id, r] as const)).values());
    return { repDirectory: uniq, allowedRepIds: [me.id], myRepId: me.id };
  }

  if (role === "MANAGER") {
    const exec = me.manager_rep_id ? await getRepById(orgId, me.manager_rep_id).catch(() => null) : null;
    const { rows } = await pool.query(
      `
      SELECT
        id,
        COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), '(Unnamed)') AS name,
        role,
        manager_rep_id,
        user_id,
        active
      FROM reps
      WHERE organization_id = $1::bigint
        AND role = 'REP'
        AND manager_rep_id = $2::bigint
        AND (active IS TRUE OR active IS NULL)
      ORDER BY name ASC, id ASC
      `,
      [orgId, me.id]
    );
    const reps = (rows || []).map((r: any) => ({
      id: Number(r.id),
      name: String(r.name || "").trim() || "(Unnamed)",
      role: r.role == null ? null : String(r.role),
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
        r.manager_rep_id,
        r.user_id,
        r.active,
        ARRAY[r.id] AS path
      FROM reps r
      WHERE r.organization_id = $1::bigint
        AND r.id = $2::bigint

      UNION ALL

      SELECT
        c.id,
        COALESCE(NULLIF(btrim(c.display_name), ''), NULLIF(btrim(c.rep_name), ''), '(Unnamed)') AS name,
        c.role,
        c.manager_rep_id,
        c.user_id,
        c.active,
        (t.path || c.id)
      FROM reps c
      JOIN tree t
        ON c.manager_rep_id = t.id
      WHERE c.organization_id = $1::bigint
        AND (c.active IS TRUE OR c.active IS NULL)
        AND NOT (c.id = ANY(t.path))
    )
    SELECT DISTINCT ON (id)
      id,
      name,
      role,
      manager_rep_id,
      user_id,
      active
    FROM tree
    ORDER BY
      id ASC,
      CASE
        WHEN role = 'EXEC_MANAGER' THEN 0
        WHEN role = 'MANAGER' THEN 1
        WHEN role = 'REP' THEN 2
        ELSE 9
      END,
      name ASC
    `,
    [orgId, me.id]
  );

  const list = (rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  })) as RepDirectoryRow[];

  // Keep stable ordering: exec → managers → reps, alphabetical.
  list.sort((a, b) => {
    const rank = (x: RepDirectoryRow) => (x.role === "EXEC_MANAGER" ? 0 : x.role === "MANAGER" ? 1 : x.role === "REP" ? 2 : 9);
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    const dn = a.name.localeCompare(b.name);
    if (dn !== 0) return dn;
    return a.id - b.id;
  });

  const allowed = Array.from(new Set(list.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0)));
  return { repDirectory: list, allowedRepIds: allowed, myRepId: me.id };
}

