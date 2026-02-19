## Executive Dashboard (alternative) — How it works

### Where the data comes from

- **Hero + KPI numbers (Quota / AI Forecast / CRM Forecast / Gap)**:
  - Computed server-side in `web/lib/executiveForecastDashboard.ts` via `getExecutiveForecastDashboardSummary()`.
  - Uses the **same quarter scoping** model as the existing forecast summary:
    - quarter is selected by `quota_period_id` from `quota_periods`
    - deals are quarter-scoped by `opportunities.close_date` falling inside the period start/end
    - pipeline buckets are derived from `opportunities.forecast_stage`
  - Uses existing calculation utilities:
    - `computeSalesVsVerdictForecastSummary()` in `web/lib/forecastSummary.ts`
    - `getForecastStageProbabilities()` in `web/lib/forecastStageProbabilities.ts`
  - Quota is summed from `quotas` for the in-scope reps (`role_level = 3`).

- **Deals Driving the Gap (and risk flags)**:
  - Fetched client-side from the existing endpoint: `GET /api/forecast/gap-driving-deals`.
  - This is the same data path used by the current “Deals Driving the Gap” report (`GapDrivingDealsClient`).
  - Each deal row links to the existing Deal Display route:
    - `/opportunities/:id/deal-review`

### How aggregation is computed

All aggregation is computed **client-side** from the deals returned by `/api/forecast/gap-driving-deals`:

- **AI Risk Radar** (`RiskRadar`):
  - Counts occurrences of each MEDDPICC+TB `risk_flags[].key` across the currently displayed deal set.
  - Adds one synthetic executive signal:
    - **Commit Deals Softening** = number of commit-bucket deals with a negative gap.

- **MEDDPICC Risk Distribution** (`MeddpiccRiskDistribution`):
  - Uses the same counts, rendered as horizontal bars (muted base + existing accent token).

### How to add/remove KPIs

- **KPI strip** is rendered in `web/components/dashboard/executive/KpiCardsRow.tsx`.
  - Add/remove tiles by editing the JSX and passing any new props from:
    - `web/app/dashboard/executive/page.tsx` (server-derived numbers)
    - `web/components/dashboard/executive/ExecutiveGapInsightsClient.tsx` (deal-derived counts like “Deals at Risk”)

### Files to know

- **Route**: `web/app/dashboard/executive/page.tsx`
- **Server metrics helper**: `web/lib/executiveForecastDashboard.ts`
- **Client gap/risk section (filters + radar + delta + deals + distribution)**: `web/components/dashboard/executive/ExecutiveGapInsightsClient.tsx`

