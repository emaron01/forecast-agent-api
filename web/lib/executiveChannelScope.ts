import { pool } from "./pool";
import { HIERARCHY } from "./roleHelpers";
import { getChannelTerritoryRepIds } from "./channelTerritoryScope";

export type ExecutiveChannelScope = {
  territoryRepIds: number[];
  partnerNames: string[];
};

export async function loadExecutiveChannelScope(args: {
  orgId: number;
  visibleRepIds: number[];
}): Promise<ExecutiveChannelScope> {
  const orgId = Number(args.orgId);
  const visibleRepIds = Array.from(
    new Set((args.visibleRepIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (!Number.isFinite(orgId) || orgId <= 0 || visibleRepIds.length === 0) {
    return { territoryRepIds: [], partnerNames: [] };
  }

  const visibleRepIdSet = new Set(visibleRepIds);
  const channelScopeUserIds = await pool
    .query<{ user_id: number }>(
      `
      SELECT DISTINCT r.user_id
      FROM reps r
      INNER JOIN users u
        ON u.id = r.user_id
       AND u.org_id = $1::bigint
      WHERE r.organization_id = $1::bigint
        AND (r.active IS TRUE OR r.active IS NULL)
        AND (u.active IS TRUE OR u.active IS NULL)
        AND u.hierarchy_level = $2::int
        AND r.user_id IS NOT NULL
      ORDER BY r.user_id ASC
      `,
      [orgId, HIERARCHY.CHANNEL_REP]
    )
    .then((res) =>
      (res.rows || [])
        .map((row) => Number(row.user_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
    .catch(() => []);

  if (channelScopeUserIds.length === 0) return { territoryRepIds: [], partnerNames: [] };

  const scopes = await Promise.all(
    channelScopeUserIds.map((channelUserId) =>
      getChannelTerritoryRepIds({ orgId, channelUserId }).catch(() => ({
        repIds: [] as number[],
        partnerNames: [] as string[],
      }))
    )
  );

  const filteredScopes = scopes
    .map((scope) => ({
      repIds: (scope.repIds || []).filter((id) => visibleRepIdSet.has(Number(id))),
      partnerNames: (scope.partnerNames || [])
        .map((name) => String(name || "").trim().toLowerCase())
        .filter(Boolean),
    }))
    .filter((scope) => scope.repIds.length > 0);

  return {
    territoryRepIds: Array.from(
      new Set(
        filteredScopes
          .flatMap((scope) => scope.repIds)
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    ),
    partnerNames: Array.from(
      new Set(
        filteredScopes
          .flatMap((scope) => scope.partnerNames)
          .map((name) => String(name || "").trim().toLowerCase())
          .filter(Boolean)
      )
    ),
  };
}
