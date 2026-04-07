import { pool } from "./pool";

export type ChannelTerritoryScope = {
  repIds: number[];
  partnerNames: string[];
};

export async function getChannelTerritoryRepIds(args: {
  orgId: number;
  channelUserId: number;
}): Promise<ChannelTerritoryScope> {
  const orgId = Number(args.orgId);
  const channelUserId = Number(args.channelUserId);
  const empty: ChannelTerritoryScope = { repIds: [], partnerNames: [] };
  if (!Number.isFinite(orgId) || orgId <= 0) return empty;
  if (!Number.isFinite(channelUserId) || channelUserId <= 0) return empty;

  const { rows: alignmentRows } = await pool.query<{ sales_leader_id: number }>(
    `
    SELECT DISTINCT sales_leader_id
      FROM channel_territory_alignments
     WHERE org_id = $1::bigint
       AND channel_user_id = $2::int
     ORDER BY sales_leader_id ASC
    `,
    [orgId, channelUserId]
  );

  const hasTerritoryAlignment = (alignmentRows || []).length > 0;

  const { rows: partnerRows } = await pool.query<{ partner_name: string | null }>(
    `
    SELECT partner_name
      FROM partner_channel_assignments
     WHERE org_id = $1::bigint
       AND channel_rep_id = $2::int
    `,
    [orgId, channelUserId]
  );

  const partnerNamesRaw: string[] = (partnerRows || [])
    .map((row) => String(row.partner_name ?? "").trim().toLowerCase())
    .filter(Boolean);
  const partnerNamesUnique: string[] = Array.from(new Set(partnerNamesRaw));
  const hasPartnerAssignments = partnerNamesUnique.length > 0;

  let repIds: number[] = [];

  if (hasTerritoryAlignment) {
    const salesLeaderIds = (alignmentRows || [])
      .map((row) => Number(row.sales_leader_id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (salesLeaderIds.length > 0) {
      const { rows } = await pool.query<{ id: number }>(
        `
        WITH RECURSIVE tree AS (
          SELECT
            r.id,
            r.manager_rep_id,
            u.hierarchy_level,
            ARRAY[r.id] AS path
          FROM reps r
          JOIN users u
            ON u.id = r.user_id
           AND u.org_id = $1::bigint
          WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
            AND r.user_id = ANY($2::bigint[])
            AND (r.active IS TRUE OR r.active IS NULL)
            AND COALESCE(u.active, TRUE) IS TRUE

          UNION ALL

          SELECT
            c.id,
            c.manager_rep_id,
            uc.hierarchy_level,
            t.path || c.id
          FROM reps c
          JOIN tree t
            ON c.manager_rep_id = t.id
          LEFT JOIN users uc
            ON uc.id = c.user_id
           AND uc.org_id = $1::bigint
          WHERE COALESCE(c.organization_id, c.org_id::bigint) = $1::bigint
            AND (c.active IS TRUE OR c.active IS NULL)
            AND COALESCE(uc.active, TRUE) IS TRUE
            AND NOT (c.id = ANY(t.path))
        )
        SELECT DISTINCT id
          FROM tree
         WHERE COALESCE(hierarchy_level, 99) IN (1, 2, 3)
         ORDER BY id ASC
        `,
        [orgId, salesLeaderIds]
      );

      repIds = (rows || [])
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id) && id > 0);
    }
  }

  const partnerNames: string[] = hasPartnerAssignments ? partnerNamesUnique : [];

  return {
    repIds,
    partnerNames,
  };
}
