CREATE TABLE quota_periods (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id),

    period_name TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    fiscal_year TEXT NOT NULL,
    fiscal_quarter TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE quotas (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id),

    rep_id BIGINT REFERENCES reps(id),
    manager_id BIGINT REFERENCES reps(id),
    role_level INTEGER NOT NULL,

    quota_period_id BIGINT NOT NULL REFERENCES quota_periods(id),

    quota_amount NUMERIC NOT NULL,
    annual_target NUMERIC,

    carry_forward NUMERIC DEFAULT 0,
    adjusted_quarterly_quota NUMERIC,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
