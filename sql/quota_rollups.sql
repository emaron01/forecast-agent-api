-- Quota roll-ups (Step 4).
-- This file defines SQL functions only (not a migration).
-- Does not modify ingestion logic or opportunity tables.

SET search_path = public;

-- Helper: get quota period bounds.
CREATE OR REPLACE FUNCTION quota_period_bounds(p_org_id integer, p_quota_period_id bigint)
RETURNS TABLE (period_start date, period_end date, fiscal_year text)
LANGUAGE sql
STABLE
AS $$
  SELECT qp.period_start, qp.period_end, qp.fiscal_year
    FROM quota_periods qp
   WHERE qp.org_id = p_org_id::bigint
     AND qp.id = p_quota_period_id
   LIMIT 1;
$$;

-- Helper: prior period id (by period_end < current period_start).
CREATE OR REPLACE FUNCTION prior_quota_period_id(p_org_id integer, p_quota_period_id bigint)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  WITH cur AS (
    SELECT period_start
      FROM quota_period_bounds(p_org_id, p_quota_period_id)
  )
  SELECT qp.id
    FROM quota_periods qp, cur
   WHERE qp.org_id = p_org_id::bigint
     AND qp.period_end < cur.period_start
   ORDER BY qp.period_end DESC, qp.id DESC
   LIMIT 1;
$$;

-- ----------------------------
-- Carry-forward logic
-- ----------------------------
--
-- For each quota row in a period, compute "missed" amount:
--   missed = max(0, quota_amount - actual_amount)
-- Then the carry_forward for the *next* period is the prior period's missed amount for the same (role_level, rep_id, manager_id).

CREATE OR REPLACE FUNCTION quota_rep_actual_amount(p_org_id integer, p_quota_period_id bigint, p_rep_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(o.amount), 0)::numeric
    FROM opportunities o
    JOIN quota_period_bounds(p_org_id, p_quota_period_id) b ON TRUE
   WHERE o.org_id = p_org_id
     AND o.rep_id = p_rep_id::int
     AND o.close_date IS NOT NULL
     AND o.close_date >= b.period_start
     AND o.close_date <= b.period_end;
$$;

CREATE OR REPLACE FUNCTION quota_manager_actual_amount(p_org_id integer, p_quota_period_id bigint, p_manager_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH reps_under AS (
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = p_org_id
       AND r.manager_rep_id = p_manager_id::int
  )
  SELECT COALESCE(SUM(o.amount), 0)::numeric
    FROM opportunities o
    JOIN quota_period_bounds(p_org_id, p_quota_period_id) b ON TRUE
   WHERE o.org_id = p_org_id
     AND o.rep_id IN (SELECT id FROM reps_under)
     AND o.close_date IS NOT NULL
     AND o.close_date >= b.period_start
     AND o.close_date <= b.period_end;
$$;

CREATE OR REPLACE FUNCTION quota_vp_actual_amount(p_org_id integer, p_quota_period_id bigint, p_vp_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH managers_under AS (
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = p_org_id
       AND r.manager_rep_id = p_vp_id::int
  ),
  reps_under AS (
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = p_org_id
       AND (r.manager_rep_id = p_vp_id::int OR r.manager_rep_id IN (SELECT id FROM managers_under))
  )
  SELECT COALESCE(SUM(o.amount), 0)::numeric
    FROM opportunities o
    JOIN quota_period_bounds(p_org_id, p_quota_period_id) b ON TRUE
   WHERE o.org_id = p_org_id
     AND o.rep_id IN (SELECT id FROM reps_under)
     AND o.close_date IS NOT NULL
     AND o.close_date >= b.period_start
     AND o.close_date <= b.period_end;
$$;

CREATE OR REPLACE FUNCTION quota_company_actual_amount(p_org_id integer, p_quota_period_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(o.amount), 0)::numeric
    FROM opportunities o
    JOIN quota_period_bounds(p_org_id, p_quota_period_id) b ON TRUE
   WHERE o.org_id = p_org_id
     AND o.close_date IS NOT NULL
     AND o.close_date >= b.period_start
     AND o.close_date <= b.period_end;
$$;

CREATE OR REPLACE FUNCTION quota_missed_amount_for_period(p_org_id integer, p_quota_period_id bigint)
RETURNS TABLE (
  quota_id bigint,
  role_level integer,
  rep_id bigint,
  manager_id bigint,
  quota_amount numeric,
  actual_amount numeric,
  missed_amount numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    q.id AS quota_id,
    q.role_level,
    q.rep_id,
    q.manager_id,
    q.quota_amount,
    CASE
      WHEN q.role_level = 3 AND q.rep_id IS NOT NULL THEN quota_rep_actual_amount(p_org_id, p_quota_period_id, q.rep_id)
      WHEN q.role_level = 2 AND q.manager_id IS NOT NULL THEN quota_manager_actual_amount(p_org_id, p_quota_period_id, q.manager_id)
      WHEN q.role_level = 1 AND q.manager_id IS NOT NULL THEN quota_vp_actual_amount(p_org_id, p_quota_period_id, q.manager_id)
      WHEN q.role_level = 0 THEN quota_company_actual_amount(p_org_id, p_quota_period_id)
      ELSE 0::numeric
    END AS actual_amount,
    GREATEST(
      0::numeric,
      q.quota_amount - CASE
        WHEN q.role_level = 3 AND q.rep_id IS NOT NULL THEN quota_rep_actual_amount(p_org_id, p_quota_period_id, q.rep_id)
        WHEN q.role_level = 2 AND q.manager_id IS NOT NULL THEN quota_manager_actual_amount(p_org_id, p_quota_period_id, q.manager_id)
        WHEN q.role_level = 1 AND q.manager_id IS NOT NULL THEN quota_vp_actual_amount(p_org_id, p_quota_period_id, q.manager_id)
        WHEN q.role_level = 0 THEN quota_company_actual_amount(p_org_id, p_quota_period_id)
        ELSE 0::numeric
      END
    ) AS missed_amount
  FROM quotas q
  WHERE q.org_id = p_org_id::bigint
    AND q.quota_period_id = p_quota_period_id;
$$;

CREATE OR REPLACE FUNCTION quota_carry_forward_for_period(p_org_id integer, p_quota_period_id bigint)
RETURNS TABLE (
  quota_id bigint,
  role_level integer,
  rep_id bigint,
  manager_id bigint,
  carry_forward numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH prev AS (
    SELECT prior_quota_period_id(p_org_id, p_quota_period_id) AS prev_id
  ),
  prev_missed AS (
    SELECT m.role_level, m.rep_id, m.manager_id, m.missed_amount
      FROM prev
      JOIN LATERAL quota_missed_amount_for_period(p_org_id, prev.prev_id) m ON prev.prev_id IS NOT NULL
  )
  SELECT
    q.id AS quota_id,
    q.role_level,
    q.rep_id,
    q.manager_id,
    COALESCE(pm.missed_amount, 0::numeric) AS carry_forward
  FROM quotas q
  LEFT JOIN prev_missed pm
    ON pm.role_level = q.role_level
   AND COALESCE(pm.rep_id, 0) = COALESCE(q.rep_id, 0)
   AND COALESCE(pm.manager_id, 0) = COALESCE(q.manager_id, 0)
  WHERE q.org_id = p_org_id::bigint
    AND q.quota_period_id = p_quota_period_id;
$$;

-- ----------------------------
-- Attainment functions
-- ----------------------------

CREATE OR REPLACE FUNCTION rep_attainment(p_org_id integer, p_quota_period_id bigint)
RETURNS TABLE (
  quota_id bigint,
  rep_id bigint,
  rep_name text,
  quota_amount numeric,
  carry_forward numeric,
  adjusted_quota_amount numeric,
  actual_amount numeric,
  attainment numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    q.id AS quota_id,
    q.rep_id,
    r.rep_name,
    q.quota_amount,
    cf.carry_forward,
    (q.quota_amount + cf.carry_forward)::numeric AS adjusted_quota_amount,
    quota_rep_actual_amount(p_org_id, p_quota_period_id, q.rep_id)::numeric AS actual_amount,
    CASE
      WHEN (q.quota_amount + cf.carry_forward) = 0 THEN NULL
      ELSE quota_rep_actual_amount(p_org_id, p_quota_period_id, q.rep_id) / (q.quota_amount + cf.carry_forward)
    END AS attainment
  FROM quotas q
  JOIN reps r ON r.id = q.rep_id::int AND r.organization_id = p_org_id
  JOIN quota_carry_forward_for_period(p_org_id, p_quota_period_id) cf ON cf.quota_id = q.id
  WHERE q.org_id = p_org_id::bigint
    AND q.quota_period_id = p_quota_period_id
    AND q.role_level = 3
    AND q.rep_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION manager_attainment(p_org_id integer, p_quota_period_id bigint)
RETURNS TABLE (
  quota_id bigint,
  manager_id bigint,
  manager_name text,
  quota_amount numeric,
  carry_forward numeric,
  adjusted_quota_amount numeric,
  actual_amount numeric,
  attainment numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    q.id AS quota_id,
    q.manager_id,
    mgr.rep_name AS manager_name,
    q.quota_amount,
    cf.carry_forward,
    (q.quota_amount + cf.carry_forward)::numeric AS adjusted_quota_amount,
    quota_manager_actual_amount(p_org_id, p_quota_period_id, q.manager_id)::numeric AS actual_amount,
    CASE
      WHEN (q.quota_amount + cf.carry_forward) = 0 THEN NULL
      ELSE quota_manager_actual_amount(p_org_id, p_quota_period_id, q.manager_id) / (q.quota_amount + cf.carry_forward)
    END AS attainment
  FROM quotas q
  JOIN reps mgr ON mgr.id = q.manager_id::int AND mgr.organization_id = p_org_id
  JOIN quota_carry_forward_for_period(p_org_id, p_quota_period_id) cf ON cf.quota_id = q.id
  WHERE q.org_id = p_org_id::bigint
    AND q.quota_period_id = p_quota_period_id
    AND q.role_level = 2
    AND q.manager_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION vp_attainment(p_org_id integer, p_quota_period_id bigint)
RETURNS TABLE (
  quota_id bigint,
  vp_id bigint,
  vp_name text,
  quota_amount numeric,
  carry_forward numeric,
  adjusted_quota_amount numeric,
  actual_amount numeric,
  attainment numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    q.id AS quota_id,
    q.manager_id AS vp_id,
    vp.rep_name AS vp_name,
    q.quota_amount,
    cf.carry_forward,
    (q.quota_amount + cf.carry_forward)::numeric AS adjusted_quota_amount,
    quota_vp_actual_amount(p_org_id, p_quota_period_id, q.manager_id)::numeric AS actual_amount,
    CASE
      WHEN (q.quota_amount + cf.carry_forward) = 0 THEN NULL
      ELSE quota_vp_actual_amount(p_org_id, p_quota_period_id, q.manager_id) / (q.quota_amount + cf.carry_forward)
    END AS attainment
  FROM quotas q
  JOIN reps vp ON vp.id = q.manager_id::int AND vp.organization_id = p_org_id
  JOIN quota_carry_forward_for_period(p_org_id, p_quota_period_id) cf ON cf.quota_id = q.id
  WHERE q.org_id = p_org_id::bigint
    AND q.quota_period_id = p_quota_period_id
    AND q.role_level = 1
    AND q.manager_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION cro_attainment(p_org_id integer, p_quota_period_id bigint)
RETURNS TABLE (
  quota_id bigint,
  quota_amount numeric,
  carry_forward numeric,
  adjusted_quota_amount numeric,
  actual_amount numeric,
  attainment numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    q.id AS quota_id,
    q.quota_amount,
    cf.carry_forward,
    (q.quota_amount + cf.carry_forward)::numeric AS adjusted_quota_amount,
    quota_company_actual_amount(p_org_id, p_quota_period_id)::numeric AS actual_amount,
    CASE
      WHEN (q.quota_amount + cf.carry_forward) = 0 THEN NULL
      ELSE quota_company_actual_amount(p_org_id, p_quota_period_id) / (q.quota_amount + cf.carry_forward)
    END AS attainment
  FROM quotas q
  JOIN quota_carry_forward_for_period(p_org_id, p_quota_period_id) cf ON cf.quota_id = q.id
  WHERE q.org_id = p_org_id::bigint
    AND q.quota_period_id = p_quota_period_id
    AND q.role_level = 0;
$$;

RESET search_path;

