-- Table 1: Territory alignment
-- Maps channel users to sales territories
CREATE TABLE IF NOT EXISTS channel_territory_alignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id bigint NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,
  channel_user_id integer NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,
  sales_leader_id integer NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,
  align_full_team boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_territory_alignments_unique
  ON channel_territory_alignments(org_id, channel_user_id, sales_leader_id);

CREATE INDEX IF NOT EXISTS idx_channel_territory_alignments_org
  ON channel_territory_alignments(org_id);

CREATE INDEX IF NOT EXISTS idx_channel_territory_alignments_user
  ON channel_territory_alignments(channel_user_id);

-- Table 2: Partner assignments
-- Maps partner names to channel reps
CREATE TABLE IF NOT EXISTS partner_channel_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id bigint NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,
  partner_name text NOT NULL,
  channel_rep_id integer NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_channel_assignments_unique
  ON partner_channel_assignments(org_id, partner_name);

CREATE INDEX IF NOT EXISTS idx_partner_channel_assignments_org
  ON partner_channel_assignments(org_id);
