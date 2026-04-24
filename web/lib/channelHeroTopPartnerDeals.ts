import "server-only";

import { pool } from "./pool";
import { crmBucketCaseSql } from "./crmBucketCaseSql";
import { partnerScopeSql } from "./channelDealScope";

export type ChannelHeroTopPartnerDealRow = {
  opportunity_public_id: string;
  partner_name: string;
  deal_registration: boolean | null;
  account_name: string | null;
  opportunity_name: string | null;
  product: string | null;
  amount: number;
  create_date: string | null;
  close_date: string | null;
  baseline_health_score: number | null;
  health_score: number | null;
};

/** Top-deals query: $7 repIds, $8 partnerNames, $9 repLen, $10 partnerLen */
function channelHeroOppScopeSqlTopDeals(alias: string): string {
  return `(
    ($9::int > 0 AND ${alias}.rep_id = ANY($7::bigint[]))
    OR ($10::int > 0 AND lower(btrim(COALESCE(${alias}.partner_name, ''))) = ANY($8::text[]))
  )`;
}

/**
 * Top won/lost partner deals for the same hero scope used by loadChannelPartnerHeroProps
 * (rep allowlist OR partner-name allowlist). Matches channel dashboard SQL.
 */
export async function listTopPartnerDealsChannelHeroScope(args: {
  orgId: number;
  quotaPeriodId: string;
  outcome: "won" | "lost";
  limit?: number | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  scopeRepIds: number[];
  scopePartnerNames: string[];
  assignedPartnerNames: string[];
}): Promise<ChannelHeroTopPartnerDealRow[]> {
  const wantWon = args.outcome === "won";
  const scopeRep = args.scopeRepIds || [];
  const scopePn = Array.from(
    new Set((args.scopePartnerNames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean))
  );
  const repLen = scopeRep.length;
  const partnerLen = scopePn.length;
  if (repLen === 0 && partnerLen === 0) return [];
  const applyLimit = typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0;
  const { rows } = await pool.query<ChannelHeroTopPartnerDealRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    bucketed AS (
      SELECT
        o.*,
        (${crmBucketCaseSql("o")}) AS crm_bucket
      FROM opportunities o
      LEFT JOIN org_stage_mappings stm
        ON stm.org_id = o.org_id
       AND stm.field = 'stage'
       AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
      LEFT JOIN org_stage_mappings fcm
        ON fcm.org_id = o.org_id
       AND fcm.field = 'forecast_category'
       AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND ${channelHeroOppScopeSqlTopDeals("o")}
        AND ${partnerScopeSql("o", 11)}
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.range_start
        AND o.close_date <= qp.range_end
    )
    SELECT
      o.public_id::text AS opportunity_public_id,
      btrim(o.partner_name) AS partner_name,
      o.deal_registration,
      o.account_name,
      o.opportunity_name,
      o.product,
      COALESCE(o.amount, 0)::float8 AS amount,
      o.create_date::timestamptz::text AS create_date,
      o.close_date::date::text AS close_date,
      o.baseline_health_score::float8 AS baseline_health_score,
      o.health_score::float8 AS health_score
    FROM bucketed o
    WHERE (CASE WHEN $3::boolean THEN o.crm_bucket = 'won' ELSE o.crm_bucket = 'lost' END)
    ORDER BY amount DESC NULLS LAST, o.id DESC
    ${applyLimit ? "LIMIT $4" : ""}
    `,
    [
      args.orgId,
      args.quotaPeriodId,
      wantWon,
      applyLimit ? args.limit : null,
      args.dateStart || null,
      args.dateEnd || null,
      scopeRep,
      scopePn,
      repLen,
      partnerLen,
      args.assignedPartnerNames,
    ]
  );
  return rows || [];
}
