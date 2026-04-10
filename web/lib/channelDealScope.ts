/**
 * SQL fragments matching /api/forecast/deals channel opportunity scoping.
 * Parameter numbers are explicit ($tr, $pn) for embedding in larger queries.
 */

/** Single scope from getChannelTerritoryRepIds (partner vs territory mutually exclusive). */
export function channelDealScopeWhereStrict(trDollar: number, pnDollar: number): string {
  return `
       AND o.partner_name IS NOT NULL
       AND btrim(o.partner_name) <> ''
       AND (
         (COALESCE(array_length($${pnDollar}::text[], 1), 0) > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($${pnDollar}::text[]))
         OR (
           COALESCE(array_length($${pnDollar}::text[], 1), 0) = 0
           AND COALESCE(array_length($${trDollar}::bigint[], 1), 0) > 0
           AND o.rep_id IS NOT NULL
           AND o.rep_id = ANY($${trDollar}::bigint[])
         )
       )`;
}

/** Union when multiple channel users' scopes are merged (RI explicit selection). */
export function channelDealScopeWhereMerged(trDollar: number, pnDollar: number): string {
  return `
       AND o.partner_name IS NOT NULL
       AND btrim(o.partner_name) <> ''
       AND (
         (COALESCE(array_length($${trDollar}::bigint[], 1), 0) > 0 AND o.rep_id IS NOT NULL AND o.rep_id = ANY($${trDollar}::bigint[]))
         OR (COALESCE(array_length($${pnDollar}::text[], 1), 0) > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($${pnDollar}::text[]))
       )`;
}

export function channelDealScopeIsEmpty(territoryRepIds: number[], partnerNames: string[]): boolean {
  const tr = territoryRepIds.filter((id) => Number.isFinite(id) && id > 0);
  const pn = partnerNames.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  return tr.length === 0 && pn.length === 0;
}
