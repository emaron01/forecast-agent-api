// Dedicated TypeScript models for quota tables (Step 2).
// Exact field names only; no extras; no renames.

export type QuotaPeriodRow = {
  id: string; // BIGSERIAL (bigint as text)
  org_id: string; // BIGINT (bigint as text)

  period_name: string;
  period_start: string; // DATE
  period_end: string; // DATE

  fiscal_year: string;
  fiscal_quarter: string;

  created_at: string | null; // TIMESTAMP
  updated_at: string | null; // TIMESTAMP
};

export type QuotaRow = {
  id: string; // UUID
  org_id: string; // BIGINT (bigint as text)

  rep_id: string | null; // BIGINT (bigint as text)
  manager_id: string | null; // BIGINT (bigint as text)
  role_level: number; // INTEGER

  quota_period_id: string; // BIGINT (bigint as text)

  quota_amount: number; // NUMERIC
  annual_target: number | null; // NUMERIC

  carry_forward: number | null; // NUMERIC
  adjusted_quarterly_quota: number | null; // NUMERIC

  created_at: string | null; // TIMESTAMP
  updated_at: string | null; // TIMESTAMP
};

