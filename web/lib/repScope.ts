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
  const mgrRes = await pool.query(
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
      AND role = 'MANAGER'
      AND manager_rep_id = $2::bigint
      AND (active IS TRUE OR active IS NULL)
    ORDER BY name ASC, id ASC
    `,
    [orgId, me.id]
  );
  const managers = (mgrRes.rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  }));
  const managerIds = managers.map((m) => m.id).filter((n) => Number.isFinite(n) && n > 0);

  const repsRes = managerIds.length
    ? await pool.query(
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
          AND manager_rep_id = ANY($2::bigint[])
          AND (active IS TRUE OR active IS NULL)
        ORDER BY name ASC, id ASC
        `,
        [orgId, managerIds]
      )
    : ({ rows: [] } as any);

  const reps = (repsRes.rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  }));

  const allowed = [me.id, ...managerIds, ...reps.map((r) => r.id)];
  return { repDirectory: [me, ...managers, ...reps], allowedRepIds: allowed, myRepId: me.id };
}

