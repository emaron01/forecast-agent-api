/**
 * Mapping-aware CRM bucket CASE expression for SQL queries.
 *
 * IMPORTANT: This helper assumes the surrounding query provides:
 * - A row alias (passed as `rowAlias`) with `forecast_stage` and `sales_stage` fields.
 * - `LEFT JOIN org_stage_mappings` tables aliased as:
 *   - `stm` for field = 'stage' (sales_stage)
 *   - `fcm` for field = 'forecast_category' (forecast_stage)
 *
 * Buckets: won, lost, excluded, commit, best_case, pipeline
 */
export function crmBucketCaseSql(rowAlias: string) {
  const fc = `lower(btrim(COALESCE(${rowAlias}.forecast_stage::text, '')))`;
  const st = `lower(btrim(COALESCE(${rowAlias}.sales_stage::text, '')))`;
  return `
CASE
  WHEN stm.bucket IS NOT NULL THEN stm.bucket
  WHEN fcm.bucket IS NOT NULL THEN fcm.bucket
  WHEN ${fc} = 'closed won' OR ${st} LIKE '%won%' THEN 'won'
  WHEN ${st} LIKE '%lost%' OR ${st} LIKE '%loss%' THEN 'lost'
  WHEN ${st} LIKE '%duplicate%' OR ${st} LIKE '%dead%' OR ${st} LIKE '%disqualified%' OR ${st} LIKE '%cancelled%' OR ${st} LIKE '%omitted%' THEN 'excluded'
  WHEN ${fc} LIKE '%commit%' THEN 'commit'
  WHEN ${fc} LIKE '%best%' THEN 'best_case'
  ELSE 'pipeline'
END`.trim();
}

