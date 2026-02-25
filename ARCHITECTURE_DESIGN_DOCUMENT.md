# Architecture Design Document — B2B AI Sales Forecasting Platform

**PASS 1: Factual Mapping Only**  
*Code-grounded, no recommendations or speculation.*

---

## 1. System Overview

The platform is a monorepo consisting of:

- **Root package** (`forecast-agent-endpoint`): Node.js with `bullmq`, `ioredis`, `express`, `pg`, `ws`. Scripts: `dev:web`, `build:web`, `start:web`, `migrate`, `worker:ingest`.
- **Web package** (`forecast-agent-web`): Next.js 14 app with Tailwind CSS, React 18, `xlsx`, `zod`.
- **Database**: PostgreSQL (schema managed via migrations in `migrations/`).
- **Queue**: Redis-backed BullMQ for opportunity comment ingestion.

**Entry points:**
- Web: `npm run dev` / `npm run start` (Next.js).
- Ingest worker: `npm run worker:ingest` → `tsx web/workers/opportunity-ingest-worker.ts`.

---

## 2. Core Services & Responsibilities

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **muscle.js** | `muscle.js` (root) | Core scoring tool handler. Exports `handleFunctionCall`; implements `save_deal_data` only. Handles MEDDPICC category writes, health_score recompute, ai_forecast/ai_verdict, predictive_eligible, baseline vs agent provenance, closed-deal pinning. |
| **applyCommentIngestionToOpportunity** | `web/lib/applyCommentIngestionToOpportunity.ts` | Maps comment-ingestion extraction to category args; invokes `handleFunctionCall` with `score_source: "ai_notes"` and `score_event_source: "baseline"` or `"agent"`. |
| **responsesTurn** | `web/lib/responsesTurn.ts` | Deal-review turn orchestration; parses model tool calls, enforces category order, invokes `handleFunctionCall` with `score_event_source: "agent"`. |
| **commitAdmission** | `web/lib/commitAdmission.ts` | Commit Admission logic: `computeCrmBucket`, `isCommitAdmissionApplicable`, `computeCommitAdmission`. Uses paper/process/timing/budget scores and confidence. |
| **commitAdmissionAggregates** | `web/lib/commitAdmissionAggregates.ts` | Server-side aggregation of Commit Admission metrics for dashboards; uses same logic as `commitAdmission.ts`. |
| **executiveForecastDashboard** | `web/lib/executiveForecastDashboard.ts` | Server-side composition of executive forecast summary: CRM vs AI forecast, pipeline stage, commit admission, partners, quota. |
| **executiveSnapshot** | `web/lib/executiveSnapshot.ts` | Synthesizes dashboard insights into Executive Snapshot via LLM; caches in `executive_snapshots` table. |
| **confidence** | `web/lib/confidence.ts`, `confidence.js` (root) | Deterministic confidence computation: `confidence_score`, `confidence_band`, `confidence_summary` from category coverage, recency, source. |
| **ingest-queue** | `web/lib/ingest-queue.ts` | BullMQ queue factory for `opportunity-ingest`; requires `REDIS_URL`. |
| **opportunity-ingest-worker** | `web/workers/opportunity-ingest-worker.ts` | BullMQ worker for `opportunity-ingest`; processes `single-ingest` and `excel-comments` jobs; calls `runCommentIngestionTurn` + `applyCommentIngestionToOpportunity` with `score_event_source: "baseline"`. |

---

## 3. End-to-End Data Flow

### 3.1 CRM / Excel Ingest → Storage

| Step | Flow | Sync/Async |
|------|------|------------|
| **A. Excel upload** | `POST /api/ingest/excel-comments` → parses Excel via `xlsx`, maps `crm_opp_id` + comments column → enqueues `excel-comments` job to `opportunity-ingest` queue | Async (queue) |
| **B. Staging** | `POST /api/ingestion/stage` → `stageIngestionRows` → inserts into `ingestion_staging` (organization_id, mapping_set_id, raw_row) | Sync |
| **C. Process** | `POST /api/ingestion/process` → `processIngestionBatch` → calls `public.process_ingestion_batch(org_id, mapping_set_id)` | Sync |
| **D. DB function** | `process_ingestion_batch` iterates staging rows, normalizes via `normalize_row`, validates via `validate_row`, upserts via `upsert_opportunity(jsonb,integer)` | Sync (DB) |

**Ingestion sources:** `web/app/admin/actions/excelOpportunities.ts`, `web/app/api/ingestion/upload/route.ts`, `web/app/api/ingestion/stage/route.ts`, `web/app/api/ingestion/process/route.ts`.

### 3.2 Comment Ingestion (AI Scoring) → Storage

| Step | Flow | Sync/Async |
|------|------|------------|
| **A. Enqueue** | Excel comments → `getIngestQueue().add("excel-comments", {orgId, fileName, rows})` | Async |
| **B. Worker** | `opportunity-ingest-worker` processes `excel-comments` or `single-ingest`; for each row: `runCommentIngestionTurn` + `insertCommentIngestion` + `applyCommentIngestionToOpportunity` | Async |
| **C. Apply** | `applyCommentIngestionToOpportunity` → `handleFunctionCall("save_deal_data", {score_source: "ai_notes", score_event_source: "baseline"})` | Sync |

**Scope:** Open deals only; skips if `baseline_health_score_ts` already set. `inScope` checks `outcome !== "Open"` → skip.

### 3.3 Storage → Scoring → AI Forecast → AI Verdict → Dashboards

| Step | Flow | Sync/Async |
|------|------|------------|
| **1. Scoring** | `save_deal_data` in `muscle.js` (from agent or comment ingestion) updates `opportunities.*_score`, `*_summary`, `*_tip`, `*_evidence_strength`, `*_confidence` | Sync |
| **2. Health score** | `recomputeTotalScore` sums all `*_score` (excluding `eb_score` duplicates); writes `health_score` | Sync |
| **3. AI Forecast** | `computeAiForecastFromHealthScore`: 24+ → Commit, 18–23 → Best Case, 0–17 → Pipeline | Sync |
| **4. AI Verdict** | Commit Admission: if applicable, `computeCommitAdmission` may downgrade (not_admitted) or flag (needs_review); AI Verdict = adjusted Forecast or note | Sync |
| **5. Dashboards** | `executiveForecastDashboard`, `commitAdmissionAggregates`, `gap-driving-deals` route, `forecast/deals` route read from `opportunities` | Sync |

### 3.4 Predictive Eligibility

- **Set:** `muscle.js` `handleFunctionCall` → `predictive_eligible = (closed == null)` (closed = closedOutcomeFromOpportunityRow).
- **Enforced:** `executiveForecastDashboard`, `commitAdmissionAggregates`, `gap-driving-deals` route, `forecast/deals` route: `WHERE (o.predictive_eligible IS NOT FALSE)`.

---

## 4. Forecast Intelligence Stack

### 4.1 CRM Forecast Usage

- **Source:** `forecast_stage`, `sales_stage` on `opportunities`.
- **Bucket:** `computeCrmBucket` in `commitAdmission.ts`: `commit` → `best_case` → `pipeline`; null for closed.
- **Usage:** `executiveForecastDashboard` aggregates by `fs` (lowercased regexp-replaced forecast_stage + sales_stage); `commitAdmissionAggregates` uses `computeCrmBucket`; `forecast/deals` and `gap-driving-deals` use CRM bucket for filtering and display.

### 4.2 AI Forecast Computation

- **Formula:** `health_score` (0–30) → Commit (24+), Best Case (18–23), Pipeline (0–17). Implemented in `muscle.js` (`computeAiForecastFromHealthScore`), `forecast/deals` (`computeAiFromHealthScore`), `commitAdmissionAggregates`, `gap-driving-deals`.
- **Storage:** `opportunities.ai_forecast` written by `save_deal_data`; never overwritten by CRM.

### 4.3 AI Verdict Computation

- **Formula:** Same as AI Forecast; then Commit Admission may downgrade or flag.
- **Logic:** `computeCommitAdmission` in `commitAdmission.ts`: `not_admitted` if any gate category score ≤ 1; `admitted` if ≥2 of paper/process/timing/budget at high confidence; else `needs_review`.
- **Storage:** `opportunities.ai_verdict` written by `save_deal_data`; `verdict_note` set when downgraded or needs_review.

### 4.4 Commit Admission Logic

- **Applicability:** `isCommitAdmissionApplicable`: open deal AND (CRM bucket = Commit OR ai_forecast = Commit).
- **Gate categories:** paper, process, timing, budget (scores + confidence).
- **Output:** `admitted` | `not_admitted` | `needs_review`; `commitAdmissionAggregates` uses this for dashboard metrics.

### 4.5 Risk Radar Inputs

- **RiskRadar:** `web/components/dashboard/executive/RiskRadar.tsx` — receives `items: RiskDriverItem[]` (key, label, count, tone).
- **RiskRadarPlot:** `web/components/dashboard/executive/RiskRadarPlot.tsx` — receives `deals: RadarDeal[]`.
- **Data source:** `ExecutiveGapInsightsClient` and `GapDrivingDealsClient` fetch from `/api/forecast/gap-driving-deals`; `mode=drivers` vs `mode=risk`; risk flags derived from `extractRiskFlags` (deal scores, tips, confidence).

---

## 5. Scoring & Evidence Pipeline

### 5.1 Scoring Origins

| Origin | Path | score_event_source |
|--------|------|--------------------|
| **Comment ingestion (worker)** | `applyCommentIngestionToOpportunity` → `handleFunctionCall` | `baseline` |
| **Deal review (agent)** | `responsesTurn` / `update-category` → `handleFunctionCall` | `agent` |
| **Baseline** | First scoring when `baseline_health_score_ts` is NULL | `baseline` |
| **Agent** | Subsequent scoring when `baseline_health_score_ts` exists | `agent` |

### 5.2 Evidence Strength + Confidence Flow

- **Schema:** `opportunities.<category>_evidence_strength`, `<category>_confidence` (text, per migration `2026-02-23_telemetry_evidence_confidence_predictive.sql`).
- **Derivation:** `muscle.js` EVIDENCE_TO_CONFIDENCE: `explicit_verified` → high, `credible_indirect` → medium, `vague_rep_assertion` / `unknown_missing` → low. If `*_confidence` missing, derived from `*_evidence_strength`.
- **Storage:** `muscle.js` allows `*_evidence_strength`, `*_confidence` in `safeAllowed`; writes NULL when empty.

### 5.3 score_event_source Handling

- **Args:** `score_event_source` passed by caller; `muscle.js` uses `args.score_event_source === "baseline" || args.score_event_source === "agent"` or infers `baselineAlreadyExists ? "agent" : "baseline"`.
- **Storage:** `health_score_source` (or equivalent) persisted; `ai_forecast` / `ai_verdict` written with same provenance.

### 5.4 Baseline vs Agent Paths

- **Baseline:** `baseline_health_score_ts` NULL → first scoring; sets `baseline_health_score`, `baseline_health_score_ts`; worker skips if `baseline_health_score_ts` already set.
- **Agent:** `baseline_health_score_ts` non-null → `save_deal_data` updates `health_score`, `ai_forecast`, `ai_verdict`; does NOT touch `baseline_*`.

---

## 6. Risk & Commit Integrity Pipeline

- **Commit Admission:** `commitAdmission.ts` + `commitAdmissionAggregates.ts`; gate categories paper/process/timing/budget; high-confidence ≥2 required for `admitted`.
- **Gap-driving deals:** `web/app/api/forecast/gap-driving-deals/route.ts` — `predictive_eligible IS NOT FALSE`, CRM vs AI bucket comparison, risk flags, evidence fragility.
- **Evidence fragility:** `extractRiskFlags` marks low-confidence gate categories; `evidence_fragility` when `conf !== "high"` for paper/process/timing/budget.

---

## 7. Async / Queue Architecture

| Queue | Name | Producer | Consumer | Job Types |
|-------|------|----------|----------|-----------|
| **opportunity-ingest** | `opportunity-ingest` | `getIngestQueue().add()` | `opportunity-ingest-worker` | `excel-comments`, `single-ingest` |

- **Redis:** `REDIS_URL`; `getIngestQueue()` returns null if unset.
- **Worker:** `web/workers/opportunity-ingest-worker.ts`; concurrency 2; batch size 100.
- **Job status:** `GET /api/ingest/jobs/[jobId]` returns state, progress, counts.

---

## 8. Closed-Deal Safeguards

### 8.1 Where Closed Won/Lost Is Detected

- **opportunityOutcome.ts:** `closedOutcomeFromOpportunityRow` — `forecast_stage` or `sales_stage` contains `won` / `lost` / `closed`.
- **muscle.js:** `closedOutcomeFromOpportunityRow`, `isClosedStage`, `normalizeClosedForecast`; `sales_stage_for_closed` from args.

### 8.2 Where ai_forecast / ai_verdict Are Pinned

- **muscle.js:** `pinnedClosed = isClosedStage(stageForClosed) ? normalizeClosedForecast(stageForClosed) : null`; if `pinnedClosed` set, `aiForecast = pinnedClosed` (no health-score mapping).
- **forecast/deals:** `closedOutcomeFromOpportunityRow` → `ai_verdict` and `ai_forecast` set to `normalizeClosedForecast(closed)`.

### 8.3 Where Predictive Eligibility Is Enforced

- **Set:** `muscle.js` `handleFunctionCall` → `predictive_eligible = (closed == null)`.
- **Filter:** `executiveForecastDashboard`, `commitAdmissionAggregates`, `gap-driving-deals` route: `WHERE (o.predictive_eligible IS NOT FALSE)`.

### 8.4 Deal Review Closed Guard

- **deal-review/queue/start:** Rejects if any selected deal is closed (`closedOutcomeFromOpportunityRow`).
- **deal-review/opportunities/[id]/state:** Returns 409 if opportunity is closed.

---

## 9. UI Composition Layer

### 9.1 Executive Dashboard

- **Data:** `executiveForecastDashboard.ts` → `getExecutiveForecastSummary`; `getPipelineStageSnapshotForPeriod`; `getCommitAdmissionAggregates`; `getCommitAdmissionDealPanels`; `getForecastStageProbabilities`; `getQuarterKpisSnapshot`; `computeSalesVsVerdictForecastSummary`.
- **Pages:** `web/app/analytics/quotas/executive/page.tsx`, `web/app/analytics/partners/executive/page.tsx`, `web/app/dashboard/page.tsx`.
- **Components:** `ExecutiveGapInsightsClient`, `ExecutiveDealsDrivingGapModule`, `RiskRadar`, `RiskRadarPlot`, `HeroBand`.

### 9.2 ERM / Risk Cockpit

- **Gap-driving deals:** `web/app/analytics/meddpicc-tb/gap-driving-deals/`; `GapDrivingDealsClient` fetches `/api/forecast/gap-driving-deals`; modes `drivers` / `risk`.
- **Risk flags:** `extractRiskFlags` in gap-driving-deals route; `evidence_fragility` for low-confidence gate categories.

### 9.3 Gap-Driving Deals

- **API:** `GET /api/forecast/gap-driving-deals`; filters: `quota_period_id`, `rep_public_id`, `stage`, `bucket_*`, `risk_category`, `suppressed_only`, `health_min/max_pct`, `mode` (drivers/risk).
- **Logic:** CRM vs AI bucket comparison; probability modifiers; `predictive_eligible IS NOT FALSE`; Commit Admission status.

### 9.4 Deal Review Flows

- **Start:** `POST /api/deal-review/queue/start` → `runUntilPauseOrEnd` (`web/app/api/handsfree/runner.ts`); `session` in `agent/sessions`, `run` in `handsfree/runs` (in-memory Maps).
- **State:** `GET /api/deal-review/opportunities/[id]/state` — opportunity, categories, health, scoring.
- **Update:** `POST /api/deal-review/opportunities/[id]/update-category` — `handleFunctionCall("save_deal_data")` with `score_event_source: "agent"`. (Legacy: `responsesTurn` used by handsfree runner.)

### 9.5 Executive Snapshot

- **API:** `POST /api/executive-snapshot`; body: `orgId`, `quotaPeriodId`, `insights`.
- **Logic:** `preprocessInsights` → `generateSnapshot` (LLM) → cache in `executive_snapshots`; input hash for cache key.

---

## 10. Key Files / Modules

| Responsibility | Key Files |
|----------------|-----------|
| **Ingestion** | `web/lib/db.ts` (stageIngestionRows, processIngestionBatch), `web/app/api/ingestion/*`, `web/app/api/ingest/excel-comments/route.ts`, `web/workers/opportunity-ingest-worker.ts`, migrations |
| **Scoring** | `muscle.js`, `web/lib/applyCommentIngestionToOpportunity.ts`, `web/lib/commentIngestionTurn.ts`, `web/lib/commentIngestionValidation.ts` |
| **Normalization** | DB functions `normalize_row`, `validate_row`, `upsert_opportunity` (migrations) |
| **Aggregation** | `web/lib/executiveForecastDashboard.ts`, `web/lib/commitAdmissionAggregates.ts`, `web/lib/forecastStageProbabilities.ts`, `web/lib/quarterKpisSnapshot.ts` |
| **Dashboard composition** | `web/lib/executiveForecastDashboard.ts`, `web/app/api/forecast/gap-driving-deals/route.ts`, `web/app/api/forecast/deals/route.ts`, `web/app/api/executive-snapshot/route.ts` |
| **Commit Admission** | `web/lib/commitAdmission.ts`, `web/lib/commitAdmissionAggregates.ts` |
| **Confidence** | `web/lib/confidence.ts`, `confidence.js` |
| **Deal review** | `web/app/api/deal-review/queue/start/route.ts`, `web/app/api/handsfree/runner.ts`, `web/lib/responsesTurn.ts`, `web/app/api/deal-review/opportunities/[id]/update-category/route.ts`, `web/app/api/deal-review/opportunities/[id]/state/route.ts` |

---

## 11. Notable Strengths (Factual)

- **Single scoring path:** All scoring flows through `muscle.js` `handleFunctionCall` → `save_deal_data`.
- **Baseline immutability:** `baseline_health_score_ts` gates first scoring; worker skips when baseline exists.
- **Closed-deal pinning:** `ai_forecast` / `ai_verdict` pinned to Closed Won/Lost when stage indicates closed; no health-score overwrite.
- **Predictive eligibility:** `predictive_eligible` set on every save; consistently filtered in dashboards and aggregates.
- **Commit Admission:** Shared logic in `commitAdmission.ts` and `commitAdmissionAggregates.ts`; gate categories and confidence rules explicit.
- **Evidence/confidence telemetry:** `*_evidence_strength`, `*_confidence` stored; derived mapping when confidence missing.
- **Queue isolation:** Comment ingestion uses BullMQ; job polling via `/api/ingest/jobs/[jobId]`.
- **Deal review closed guard:** Queue start and state endpoints reject closed deals.

---

*End of PASS 1 — Architecture Design Document — Factual Mapping Only*
