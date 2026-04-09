import type { AuthUser } from "./auth";
import { getChannelTerritoryRepIds } from "./channelTerritoryScope";

/**
 * Same visibility as `/api/forecast/deals` for channel roles (6/7/8): partner-named opps only,
 * scoped by assigned partner names or territory rep ids (mutually exclusive, matching the deals route).
 */
export async function channelUserCanViewOpportunity(args: {
  orgId: number;
  user: AuthUser;
  opportunity: { rep_id?: unknown; partner_name?: unknown };
}): Promise<boolean> {
  const scope = await getChannelTerritoryRepIds({
    orgId: args.orgId,
    channelUserId: args.user.id,
  });
  const territoryRepIds = scope.repIds.filter((id) => Number.isFinite(id) && id > 0);
  const partnerNames = scope.partnerNames;
  const hasScope = partnerNames.length > 0 || territoryRepIds.length > 0;
  if (!hasScope) return false;

  const partnerOnOpp = String(args.opportunity.partner_name ?? "").trim().toLowerCase();
  if (!partnerOnOpp) return false;

  if (partnerNames.length > 0) {
    return partnerNames.includes(partnerOnOpp);
  }

  const rid = Number(args.opportunity.rep_id);
  return Number.isFinite(rid) && rid > 0 && territoryRepIds.includes(rid);
}
