import "server-only";

import { pool } from "./pool";
import { HIERARCHY } from "./roleHelpers";

export type ChannelOrgDirectoryRow = {
  id: number;
  name: string;
  manager_rep_id: number | null;
  role: string;
  hierarchy_level: number | null;
  /** User account active; false = departed. */
  active: boolean;
};

/**
 * Channel org tree under the viewer.
 * - Channel exec / director (6/7, or role CHANNEL_EXECUTIVE / CHANNEL_DIRECTOR): full channel subtree under the viewer.
 * - Channel rep (8): self, direct reports, and one level of indirect reports (unchanged).
 * `id` is users.id (used with getChannelTerritoryRepIds({ channelUserId: id })).
 */
export async function fetchChannelOrgDirectoryForViewer(args: {
  orgId: number;
  viewerUserId: number;
}): Promise<ChannelOrgDirectoryRow[]> {
  const orgId = Number(args.orgId);
  const viewerUserId = Number(args.viewerUserId);
  if (!Number.isFinite(orgId) || orgId <= 0) return [];
  if (!Number.isFinite(viewerUserId) || viewerUserId <= 0) return [];

  const { rows: viewerRows } = await pool.query<{ hierarchy_level: number | null; role: string | null }>(
    `
    SELECT u.hierarchy_level, COALESCE(u.role::text, '') AS role
    FROM users u
    WHERE u.org_id = $1::bigint
      AND u.id = $2::bigint
      AND (u.active IS TRUE OR u.active IS NULL)
    `,
    [orgId, viewerUserId]
  );
  const viewerHl = viewerRows[0]?.hierarchy_level == null ? null : Number(viewerRows[0].hierarchy_level);
  const viewerRole = String(viewerRows[0]?.role || "").trim();
  const useFullChannelSubtree =
    viewerHl === HIERARCHY.CHANNEL_EXEC ||
    viewerHl === HIERARCHY.CHANNEL_MANAGER ||
    viewerRole === "CHANNEL_EXECUTIVE" ||
    viewerRole === "CHANNEL_DIRECTOR";

  const sql = useFullChannelSubtree
    ? `
    WITH RECURSIVE tree AS (
      SELECT u.id
      FROM users u
      WHERE u.org_id = $1::bigint
        AND u.id = $2::bigint
        AND (u.active IS TRUE OR u.active IS NULL)
      UNION ALL
      SELECT c.id
      FROM users c
      INNER JOIN tree t ON c.manager_user_id = t.id
      WHERE c.org_id = $1::bigint
        AND COALESCE(c.hierarchy_level, 99) IN (6, 7, 8)
        AND (c.active IS TRUE OR c.active IS NULL)
    )
    SELECT
      u.id,
      COALESCE(NULLIF(btrim(u.display_name), ''), '(Unnamed)') AS name,
      u.manager_user_id AS manager_rep_id,
      COALESCE(u.role::text, '') AS role,
      u.hierarchy_level,
      COALESCE(u.active, true) AS active
    FROM users u
    WHERE u.org_id = $1::bigint
      AND u.id IN (SELECT id FROM tree)
      AND COALESCE(u.hierarchy_level, 99) IN (6, 7, 8)
      AND (u.active IS TRUE OR u.active IS NULL)
    ORDER BY u.hierarchy_level ASC, name ASC, u.id ASC
    `
    : `
    SELECT
      u.id,
      COALESCE(NULLIF(btrim(u.display_name), ''), '(Unnamed)') AS name,
      u.manager_user_id AS manager_rep_id,
      COALESCE(u.role::text, '') AS role,
      u.hierarchy_level,
      COALESCE(u.active, true) AS active
    FROM users u
    WHERE u.org_id = $1::bigint
      AND COALESCE(u.hierarchy_level, 99) IN (6, 7, 8)
      AND (u.active IS TRUE OR u.active IS NULL)
      AND (
        u.id = $2::bigint
        OR u.manager_user_id = $2::bigint
        OR u.manager_user_id IN (
          SELECT id FROM users
          WHERE org_id = $1::bigint
            AND manager_user_id = $2::bigint
        )
      )
    ORDER BY u.hierarchy_level ASC, name ASC, u.id ASC
    `;

  const { rows } = await pool.query<{
    id: number;
    name: string | null;
    manager_rep_id: number | null;
    role: string | null;
    hierarchy_level: number | null;
    active: boolean | null;
  }>(sql, [orgId, viewerUserId]);

  return (rows || []).map((r) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    role: String(r.role || "").trim() || "CHANNEL_REP",
    hierarchy_level: r.hierarchy_level == null ? null : Number(r.hierarchy_level),
    active: r.active !== false,
  }));
}

/** Restrict client-supplied channel user ids to users visible under the viewer's channel subtree. */
export async function filterChannelUserIdsUnderViewer(args: {
  orgId: number;
  viewerUserId: number;
  candidateUserIds: number[];
}): Promise<number[]> {
  const ids = args.candidateUserIds.filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return [];
  const allowed = new Set(
    (await fetchChannelOrgDirectoryForViewer({ orgId: args.orgId, viewerUserId: args.viewerUserId })).map((r) => r.id)
  );
  return ids.filter((id) => allowed.has(id));
}
