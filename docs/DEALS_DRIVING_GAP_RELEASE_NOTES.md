## Deals Driving the Gap — Release notes / tracker

### Purpose
This work adds a deal-level report and embedded module to explain **why** CRM (rep‑weighted) outlook differs from SalesForecast.IO (AI/Verdict) outlook, and to surface **which deals are at risk** (AI outlook below CRM).

### Major additions
- **New report page**: `Analytics → MEDDPICC+TB → Deals Driving the Gap`
- **API endpoint**: `GET /api/forecast/gap-driving-deals`
- **Embedded module**: Added under the Forecast “Verdict Forecast” module (above Rep breakdown).

### “Deals Driving the Gap” report behavior
- **Two modes**
  - **Gap Drivers**: surfaces the highest-contribution deals explaining the AI−CRM delta.
  - **All At Risk**: shows all deals where AI outlook < CRM outlook (sorted by downside).
- **Totals clarity**
  - Header totals reflect the **full deal universe** for the selected scope/quarter.
  - UI also shows **“Showing $X of $Y gap from displayed deals”** so it’s clear when the list is a subset.

### Scoping / correctness fixes (critical)
- Aligns report scoping with Forecast summary scoping to prevent:
  - **Rep shows a GAP but report shows 0 deals**
  - **Forecast totals not matching embedded report totals**
- Supports opportunities where:
  - `rep_id` may be missing but `rep_name` is present (name-key fallback).
  - REP/user → rep mapping is imperfect in test data.
- On rep dashboards, the embedded module defaults to the **current rep** via `rep_name` unless a rep filter is explicitly set.

### UX improvements
- Filters redesigned into compact checkbox groups; quarter selection stays deterministic.
- Added **Refresh data** button for the report module.
- Prevented “quarter jumping” caused by stale `fiscal_year` param when using report reset buttons.
- Deal cards:
  - Added **Sales Rep** before close date.
  - Shows **CRM Forecast Stage** and **AI Verdict Stage** side-by-side with upgrade/downgrade coloring.
  - MEDDPICC+TB heatmap shows **only Red/Yellow**; click opens AI assessment (label, tip, evidence).

### Rep breakdown table (under Forecast)
- Simplified columns and formatting for readability.
- Fixed alignment and corrected GAP sign logic (AI−CRM).

### Where to look (files)
- **API**: `web/app/api/forecast/gap-driving-deals/route.ts`
- **Report UI**: `web/app/analytics/meddpicc-tb/gap-driving-deals/ui/GapDrivingDealsClient.tsx`
- **Forecast embed + rep breakdown**: `web/app/forecast/_components/QuarterSalesForecastSummary.tsx`

### Notes / operational
- If you need a GitHub Issue for this tracker: paste this file content into an issue titled:
  - **“Deals Driving the Gap report — release notes & fixes”**

