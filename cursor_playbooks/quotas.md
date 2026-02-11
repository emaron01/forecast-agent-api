-----------------------------------------
TABLE: quota_periods
-----------------------------------------
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

-----------------------------------------
TABLE: quotas
-----------------------------------------
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
You must generate ONLY the SQL migrations for the two tables defined below.
Do not modify any existing tables, functions, or code.
Do not generate TypeScript, UI, or server actions.

[PASTE CANONICAL SCHEMA HERE]

REQUIREMENTS:
- Output ONLY the migration files.
- Do not rename or alter existing tables.
- Do not add fields not listed.
- Do not add indexes unless explicitly required.
- No creativity. No assumptions. No drift.
Generate ONLY the TypeScript models for the two tables defined below.
Do not modify any existing models.
Do not generate migrations, UI, or server actions.

[PASTE CANONICAL SCHEMA HERE]

REQUIREMENTS:
- Use exact field names and types.
- No additional fields.
- No renaming.
- No creativity. No drift.
Generate ONLY server actions for CRUD operations on the tables below.

Actions required:
- createQuotaPeriod
- updateQuotaPeriod
- listQuotaPeriods
- createQuota
- updateQuota
- listQuotasByRep
- listQuotasByManager
- listQuotasByVP
- listQuotasByCRO

[PASTE CANONICAL SCHEMA HERE]

REQUIREMENTS:
- Use parameterized SQL.
- Use the TypeScript models from Step 2.
- Do not modify existing server actions.
- Do not generate UI.
- Do not generate migrations.
- No creativity. No drift.
Generate ONLY the SQL and server-side functions for quota roll-ups:

- rep attainment
- manager attainment
- VP attainment
- CRO/company attainment
- carry-forward logic (missed quota rolls into next period)

[PASTE CANONICAL SCHEMA HERE]

REQUIREMENTS:
- Do not modify ingestion logic.
- Do not modify opportunity tables.
- Do not generate UI.
- Do not generate migrations.
- No creativity. No drift.
Generate ONLY the admin UI pages for:

1. Managing fiscal calendar (quota_periods)
2. Assigning quotas to reps, managers, VPs, CRO
3. Viewing quota roll-ups
4. Viewing attainment dashboards

[PASTE CANONICAL SCHEMA HERE]

REQUIREMENTS:
- Use existing design system.
- Use server actions from Step 3.
- Do not modify existing pages.
- Do not generate migrations.
- No creativity. No drift.
Generate ONLY the logic and SQL needed to compare:

- CRM Forecast Stage
- AI Forecast Stage
- Quota attainment (quarterly + annual)

[PASTE CANONICAL SCHEMA HERE]

REQUIREMENTS:
- Do not modify ingestion.
- Do not modify existing forecast logic.
- Output only new comparison functions and queries.
- No creativity. No drift.
