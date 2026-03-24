/**
 * Canonical partner / CEI motion classification (mutually exclusive).
 * Use the same rules everywhere: executive partner stats, CEI scope, KPI rollups.
 *
 * Precedence: Partner Sourced (registered) → Partner Influenced (named, not registered) → Direct.
 */

export type PartnerDealMotion = "direct" | "partner_influenced" | "partner_sourced";

/** SQL boolean expressions on opportunities alias `o` */
export const partnerMotionPredicatesSql = {
  isPartnerSourced: `o.deal_registration IS TRUE`,
  isPartnerInfluenced: `o.partner_name IS NOT NULL AND btrim(o.partner_name) <> '' AND (o.deal_registration IS FALSE OR o.deal_registration IS NULL)`,
  isDirect: `(o.partner_name IS NULL OR btrim(o.partner_name) = '') AND (o.deal_registration IS FALSE OR o.deal_registration IS NULL)`,
} as const;

/** Same predicates when `partner_name` and `deal_registration` are bare column names (e.g. KPI CTEs). */
export const partnerMotionBarePredicatesSql = {
  isPartnerSourced: `deal_registration IS TRUE`,
  isPartnerInfluenced: `partner_name IS NOT NULL AND btrim(partner_name) <> '' AND (deal_registration IS FALSE OR deal_registration IS NULL)`,
  isDirect: `(partner_name IS NULL OR btrim(partner_name) = '') AND (deal_registration IS FALSE OR deal_registration IS NULL)`,
} as const;

/** Single CASE expression → motion key for SQL GROUP BY (alias `o`). */
export function partnerMotionCaseSql(alias: string = "o"): string {
  const a = alias;
  return `
CASE
  WHEN ${a}.deal_registration IS TRUE THEN 'partner_sourced'
  WHEN ${a}.partner_name IS NOT NULL AND btrim(${a}.partner_name) <> '' AND (${a}.deal_registration IS FALSE OR ${a}.deal_registration IS NULL) THEN 'partner_influenced'
  ELSE 'direct'
END`.trim();
}
