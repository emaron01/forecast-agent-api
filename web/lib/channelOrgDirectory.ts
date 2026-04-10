import "server-only";

import { pool } from "./pool";

export type ChannelOrgDirectoryRow = {
  id: number;
  name: string;
  manager_rep_id: number | null;
  role: string;
  hierarchy_level: number | null;
};

/**
 * Channel org tree under the viewer (6/7): self, direct reports, and one level of indirect reports.
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

  const { rows } = await pool.query<{
    id: number;
    name: string | null;
    manager_rep_id: number | null;
    role: string | null;
    hierarchy_level: number | null;
  }>(
    `
    SELECT
      u.id,
      COALESCE(NULLIF(btrim(u.display_name), ''), '(Unnamed)') AS name,
      u.manager_user_id AS manager_rep_id,
      COALESCE(u.role::text, '') AS role,
      u.hierarchy_level
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
    `,
    [orgId, viewerUserId]
  );

  return (rows || []).map((r) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    role: String(r.role || "").trim() || "CHANNEL_REP",
    hierarchy_level: r.hierarchy_level == null ? null : Number(r.hierarchy_level),
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
