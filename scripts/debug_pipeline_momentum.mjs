import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: "web/.env" });

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is missing (expected in web/.env)");
  process.exit(1);
}

const { Client } = pg;
const client = new Client({
  connectionString: databaseUrl,
  // Many hosted Postgres providers require SSL; local Postgres often does not.
  // If your DATABASE_URL includes `sslmode=require`, this will work.
  ssl: { rejectUnauthorized: false },
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  await client.connect();

  const orgId = num(process.env.ORG_ID) || null;
  if (!orgId) {
    const orgs = await client.query("SELECT id, public_id::text AS public_id, name FROM organizations ORDER BY id ASC LIMIT 10");
    console.log("Set ORG_ID env var to target one org. Available orgs:");
    console.table(orgs.rows);
    process.exit(0);
  }

  const qp =
    (await client
      .query(
        `
        SELECT id::text AS id, period_start::date AS period_start, period_end::date AS period_end, period_name
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND period_start <= CURRENT_DATE
           AND period_end >= CURRENT_DATE
         ORDER BY period_start DESC, id DESC
         LIMIT 1
        `,
        [orgId]
      )
      .then((r) => r.rows?.[0] || null)
      .catch(() => null)) ||
    (await client
      .query(
        `
        SELECT id::text AS id, period_start::date AS period_start, period_end::date AS period_end, period_name
          FROM quota_periods
         WHERE org_id = $1::bigint
         ORDER BY period_start DESC, id DESC
         LIMIT 1
        `,
        [orgId]
      )
      .then((r) => r.rows?.[0] || null)
      .catch(() => null));

  if (!qp) {
    console.log("No quota_periods found for org_id", orgId);
    process.exit(0);
  }

  console.log("Target org_id:", orgId);
  console.log("Target quota_period:", qp);

  const cols = await client.query(
    `
    SELECT column_name, data_type, udt_name
      FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='opportunities'
       AND column_name IN ('close_date','create_date','create_date_raw','forecast_stage','sales_stage','rep_id','rep_name')
     ORDER BY column_name ASC
    `
  );
  console.table(cols.rows);

  const counts = await client.query(
    `
    WITH qp AS (
      SELECT period_start::date AS period_start, period_end::date AS period_end
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND id = $2::bigint
       LIMIT 1
    ),
    base AS (
      SELECT
        o.id,
        o.close_date,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      WHERE o.org_id = $1
    ),
    in_qtr AS (
      SELECT b.*
        FROM base b
        JOIN qp ON TRUE
       WHERE b.close_date IS NOT NULL
         AND (
           CASE
             WHEN (b.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(b.close_date::text from 1 for 10)::date
             WHEN (b.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN to_date(substring(b.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
             ELSE NULL
           END
         ) >= qp.period_start
         AND (
           CASE
             WHEN (b.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(b.close_date::text from 1 for 10)::date
             WHEN (b.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN to_date(substring(b.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
             ELSE NULL
           END
         ) <= qp.period_end
    ),
    open_in_qtr AS (
      SELECT *
        FROM in_qtr
       WHERE NOT ((' ' || fs || ' ') LIKE '% won %')
         AND NOT ((' ' || fs || ' ') LIKE '% lost %')
         AND NOT ((' ' || fs || ' ') LIKE '% closed %')
    )
    SELECT
      (SELECT COUNT(*)::int FROM base) AS opps_total_org,
      (SELECT COUNT(*)::int FROM base WHERE close_date IS NULL) AS opps_missing_close_date,
      (SELECT COUNT(*)::int FROM in_qtr) AS opps_close_date_in_period,
      (SELECT COUNT(*)::int FROM open_in_qtr) AS opps_open_in_period
    `,
    [orgId, qp.id]
  );
  console.log("Counts:", counts.rows?.[0] || null);

  const openSnap = await client.query(
    `
    WITH qp AS (
      SELECT period_start::date AS period_start, period_end::date AS period_end
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND id = $2::bigint
       LIMIT 1
    ),
    deals AS (
      SELECT
        COALESCE(o.amount, 0)::float8 AS amount,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
        CASE
          WHEN o.close_date IS NULL THEN NULL
          WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
          WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
          ELSE NULL
        END AS close_d
      FROM opportunities o
      WHERE o.org_id = $1
    ),
    deals_in_qtr AS (
      SELECT d.*
        FROM deals d
        JOIN qp ON TRUE
       WHERE d.close_d IS NOT NULL
         AND d.close_d >= qp.period_start
         AND d.close_d <= qp.period_end
    ),
    open_deals AS (
      SELECT *
        FROM deals_in_qtr d
       WHERE NOT ((' ' || d.fs || ' ') LIKE '% won %')
         AND NOT ((' ' || d.fs || ' ') LIKE '% lost %')
         AND NOT ((' ' || d.fs || ' ') LIKE '% closed %')
    )
    SELECT
      COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN 1 ELSE 0 END), 0)::int AS commit_count,
      COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
      COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS best_case_count,
      COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
      COALESCE(SUM(amount), 0)::float8 AS total_amount,
      COUNT(*)::int AS total_count
    FROM open_deals
    `,
    [orgId, qp.id]
  );
  console.log("Open pipeline snapshot:", openSnap.rows?.[0] || null);

  const sample = await client.query(
    `
    SELECT
      id,
      rep_id,
      rep_name,
      forecast_stage,
      close_date::text AS close_date_text,
      amount
    FROM opportunities
    WHERE org_id = $1
    ORDER BY id DESC
    LIMIT 15
    `,
    [orgId]
  );
  console.table(sample.rows);
}

main()
  .catch((e) => {
    console.error(String(e?.message || e));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.end();
    } catch {
      // ignore
    }
  });

