import { pool } from "./pool";

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
  role: "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP";
}): Promise<{
  repDirectory: RepDirectoryRow[];
  allowedRepIds: number[] | null; // null => no filter (admin)
  myRepId: number | null;
}> {
  const orgId = Number(args.orgId);
  const userId = Number(args.userId);
  const role = args.role;

  if (!Number.isFinite(orgId) || orgId <= 0) return { repDirectory: [], allowedRepIds: [], myRepId: null };
  if (!Number.isFinite(userId) || userId <= 0) return { repDirectory: [], allowedRepIds: [], myRepId: null };

  if (role === "ADMIN") {
    const all = await listActiveRepsForOrg(orgId).catch(() => []);
    return { repDirectory: all, allowedRepIds: null, myRepId: null };
  }

  const me = await getRepForUser(orgId, userId).catch(() => null);
  if (!me) return { repDirectory: [], allowedRepIds: [], myRepId: null };

  if (role === "REP") {
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

  // EXEC_MANAGER
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

