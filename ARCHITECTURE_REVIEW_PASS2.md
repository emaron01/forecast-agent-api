# PASS 2 — Strategic Architecture Review

**Staff-level technical and product architecture review**  
*Code-aware, concrete, actionable.*

---

## 1. Architectural Risks

### 1.1 Correctness Risks

| Risk | Location | Description |
|------|----------|-------------|
| **predictive_eligible never set for CRM-only ingest** | `processIngestionBatch`, `upsert_opportunity` | `predictive_eligible` is set only in `muscle.js` `handleFunctionCall`. CRM ingest via `process_ingestion_batch` → `upsert_opportunity` never touches it. Closed deals from CRM-only ingest remain NULL. Filter `predictive_eligible IS NOT FALSE` includes NULL → closed deals leak into dashboards and training data. |
| **Closed-stage detection inconsistency** | `opportunityOutcome.ts` vs `muscle.js` | `closedOutcomeFromOpportunityRow` checks `forecast_stage` then `sales_stage`. `muscle.js` uses `sales_stage_for_closed ?? opp.sales_stage ?? opp.forecast_stage` for pinning. If caller passes wrong `sales_stage_for_closed`, pinning can misclassify. Comment ingestion passes `salesStage: opp.sales_stage ?? opp.forecast_stage` — consistent, but no validation that stage is authoritative for closed. |
| **AI Forecast/Verdict formula duplicated** | 4+ files | `computeAiFromHealthScore` / `computeAiForecastFromHealthScore` duplicated in `muscle.js`, `forecast/deals`, `commitAdmissionAggregates`, `gap-driving-deals`. Threshold change (e.g., 24→23 for Commit) requires coordinated edits; drift risk is high. |
| **Commit Admission gate categories hardcoded** | `commitAdmission.ts` | Paper, process, timing, budget are literal arrays. If orgs need different gate sets or weights, no configuration path exists. |

### 1.2 Scaling Risks

| Risk | Location | Description |
|------|----------|-------------|
| **Deal review sessions in-memory** | `agent/sessions`, `handsfree/runs` | `sessions` and `handsfreeRuns` are `Map`s. Server restart or horizontal scaling loses all active deal-review state. No persistence, no recovery. |
| **Worker concurrency fixed at 2** | `opportunity-ingest-worker.ts` | `concurrency: 2` is hardcoded. Large Excel uploads (5000 rows) process sequentially in batches of 100; no horizontal worker scaling without Redis cluster awareness. |
| **Executive dashboard N+1-style composition** | `executiveForecastDashboard.ts` | Multiple sequential pool queries (reps, quota periods, pipeline snapshot, commit admission, partners, KPIs, etc.). No batching or parallelization; latency grows with org size. |
| **Gap-driving-deals route complexity** | `gap-driving-deals/route.ts` | ~1500+ lines; heavy SQL and in-memory transforms. Single route handles drivers + risk modes, filters, probability modifiers. Hard to optimize or split. |

### 1.3 Data Integrity Risks

| Risk | Location | Description |
|------|----------|-------------|
| **predictive_eligible gap (see above)** | CRM ingest path | Closed deals from CRM ingest never get `predictive_eligible = false`. Training data and dashboard aggregates are polluted. |
| **No backfill for existing NULL predictive_eligible** | — | Historical opportunities (pre-migration or CRM-only) may have NULL. No migration or job to backfill based on `forecast_stage`/`sales_stage`. |
| **Baseline vs agent race** | Worker + deal review | Worker skips if `baseline_health_score_ts` exists. If deal review and comment ingestion run concurrently on same deal, first-write wins; no locking. Rare but possible. |
| **audit_details.scoring merge** | `muscle.js` | `jsonb_set(COALESCE(audit_details, '{}'), '{scoring}', $3::jsonb)` overwrites entire `scoring` key. If other code writes to `audit_details`, keys can be lost. |

### 1.4 Forecast Credibility Risks

| Risk | Location | Description |
|------|----------|-------------|
| **Health score threshold magic numbers** | Multiple | 24 (Commit), 18 (Best Case) are literals. No org override, no A/B testability, no versioning. CRO asks "why 24?" — answer is "code constant." |
| **Commit Admission binary gate** | `commitAdmission.ts` | ≥2 high-confidence gate categories → admitted. No partial credit, no "1.5 high" nuance. Deals at threshold can flip with single category change. |
| **AI Verdict downgrade one level only** | `forecast/deals` | `downgradeAiVerdictOneLevel`: Commit→Best Case, Best Case→Pipeline. If `not_admitted` from weak paper+process+timing+budget, verdict is Best Case. CRO may expect Pipeline for "Commit not supported." |
| **Executive Snapshot cache invalidation** | `executive-snapshot` route | Cache key = `inputHash` of insights. If insights change (new widget, different wording) but semantics are same, cache miss. If insights are stale, cache hit returns outdated snapshot. No TTL or explicit invalidation. |

### 1.5 Queue/Async Risks

| Risk | Location | Description |
|------|----------|-------------|
| **No dead-letter handling** | `opportunity-ingest-worker` | Failed jobs increment `failed`; no retry policy, no DLQ. Permanently failed rows (e.g., bad crm_opp_id) stay in job result but are not retried. |
| **Job progress not transactional** | Worker | `updateProgress` is best-effort. If worker crashes mid-batch, progress is partial; restart reprocesses from job start (no checkpoint). |
| **Redis single point of failure** | `ingest-queue`, worker | `getIngestQueue()` returns null if no REDIS_URL. Excel upload returns 503. No fallback to sync processing for small batches. |
| **Worker and web share no process** | Package scripts | `worker:ingest` is separate process. Deploy must run both; common to forget worker in staging. |

### 1.6 Duplication or Drift Risks

| Risk | Location | Description |
|------|----------|-------------|
| **computeAiFromHealthScore x4** | muscle.js, forecast/deals, commitAdmissionAggregates, gap-driving-deals | Same formula, four implementations. Change one, miss others → inconsistent AI Forecast across surfaces. |
| **CRM bucket regex duplicated** | `commitAdmission.ts`, `executiveForecastDashboard`, gap-driving-deals | `lower(regexp_replace(forecast_stage || sales_stage, '[^a-zA-Z]+', ' ', 'g'))` and `LIKE '% commit %'` patterns repeated. Stage name variants (e.g., "Commit - Best Case") can behave differently across surfaces. |
| **confidence.js + confidence.ts** | Root + web/lib | `confidence.js` (CJS) used by muscle.js; `confidence.ts` in web. Potential drift if one is updated and not the other. |
| **Two deal-review entry points** | `deal-review/start` vs `deal-review/queue/start` | Both exist; `queue/start` uses handsfree runner. Unclear which is canonical; risk of divergent behavior. |

---

## 2. ML Moat Readiness

### 2.1 Telemetry Completeness

| Aspect | Status | Gap |
|--------|--------|-----|
| **evidence_strength** | Stored per category | Comment ingestion does not emit it; only deal review / model can. Baseline from comments has no evidence_strength unless extraction schema extended. |
| **confidence** | Stored + derived | Derivation from evidence_strength works. `applyCommentIngestionToOpportunity` passes `extraction_confidence` but not per-category. |
| **score_event_source** | Persisted | `health_score_source` (or equivalent) stored. Distinguishes baseline vs agent. |
| **predictive_eligible** | Set on save | **Not set on CRM ingest** — critical gap. |
| **comment_ingestion_id** | In audit/tool args | Links score to ingestion record. Good for lineage. |
| **Prompt/model version** | In comment_ingestion, audit_events | `promptVersionHash`, `model` in metadata. Not yet in a queryable training export. |

### 2.2 Point-in-Time Safety

| Aspect | Status | Gap |
|--------|--------|-----|
| **Baseline immutability** | Enforced | Worker skips if baseline exists. Good. |
| **Closed pinning** | Enforced | `ai_forecast`/`ai_verdict` pinned when closed. Good. |
| **Training snapshot** | Not implemented | No "as-of" export. To train on "state at close," would need to reconstruct from audit_events or snapshots. |
| **Stage at score time** | Partial | `sales_stage_for_closed` passed; `forecast_stage` in opp row. If deal closes between score and save, we use passed stage. Adequate. |

### 2.3 Leakage Risks

| Risk | Description |
|------|-------------|
| **Closed deals in training** | `predictive_eligible IS NOT FALSE` includes NULL. CRM-only closed deals have NULL → included. |
| **Future info in baseline** | Baseline is first score. If comments mention "signed last week" and close_date is future, no explicit guard. Relies on LLM not hallucinating. |
| **Outcome in prompt** | Comment ingestion prompt includes deal fields. If `forecast_stage` is "Closed Won" and we mistakenly process (inScope bug), outcome could leak. Worker does check `inScope` for open only. |

### 2.4 Signal Quality Risks

| Risk | Description |
|------|-------------|
| **Comment quality variance** | Excel comments are freeform. "TBD" vs detailed MEDDPICC notes produce very different extractions. No quality gate. |
| **Extraction confidence** | `extraction_confidence` in schema; used in confidence computation. Low extraction confidence should down-weight; logic exists but not consistently applied in Commit Admission. |
| **Stale scores** | `updated_at` on opportunities. No "score age" filter in dashboards. Old scores shown without "last updated" prominence. |

### 2.5 Training Readiness

| Aspect | Status |
|--------|--------|
| **Predictive eligibility** | Broken for CRM-only closed deals. |
| **Feature set** | Category scores, evidence_strength, confidence, health_score, CRM bucket, close_date — present. |
| **Label** | Outcome (Won/Lost) derivable from forecast_stage/sales_stage. |
| **Export pipeline** | No dedicated training export. Would need to query opportunities + filters. |
| **Versioning** | prompt_version, logic_version in audit_events. Useful for cohort analysis. |

---

## 3. CRO Trust Factors

### 3.1 Harsh or Confusing Outputs

| Area | Risk |
|------|------|
| **AI Verdict "Commit not supported"** | Downgrade to Best Case with note. Rep may feel penalized without clear remediation path. |
| **"needs_review"** | Verdict note: "AI: Commit evidence is low-confidence; review required." No link to which categories or what to improve. |
| **Risk Radar** | Top drivers by count. "Pain: 12" — 12 deals with weak Pain. No dollar-weighted view; big deals count same as small. |
| **Gap-driving deals** | "Driving the gap" can feel accusatory. No framing that it's "opportunity to improve" vs "at fault." |
| **Executive Snapshot** | LLM-generated. Can sound generic or miss org-specific nuance. "Signal is weak" fallback when few insights — good. |

### 3.2 Hygiene Assumption Breakage

| Assumption | When It Breaks |
|------------|----------------|
| **CRM stages are standardized** | `computeCrmBucket` uses `commit`, `best` substrings. "Commit - Verbal" works; "Committed" may not. Custom stage names (e.g., "Pipeline - Stage 1") map to pipeline. |
| **Reps have hierarchy** | `getScopedRepDirectory`, manager visibility assume `reps` + `users` structure. Flat orgs or missing manager_id break scoping. |
| **Quota periods exist** | Many dashboards require `quota_period_id`. If none configured, empty or error states. |
| **Close dates are valid** | `close_date` parsed from various formats in SQL. Invalid dates can produce NULL and exclude from period filters. |
| **One rep per deal** | Deal review queue enforces single rep per session. Multi-rep deals (co-sell) not supported. |

### 3.3 Dashboard Misleading Leadership

| Risk | Description |
|------|-------------|
| **predictive_eligible NULL included** | Aggregates include CRM-only closed deals → inflated Commit/Best Case numbers. |
| **AI vs CRM gap** | Gap = AI weighted − CRM weighted. If AI is more conservative (Commit Admission downgrades), gap can be negative. CRO may interpret as "AI says we're over-forecasting" — correct, but needs clear framing. |
| **Commit Admission %** | "Verified Commit" vs "Unsupported Commit" — if gate categories are incomplete (e.g., paper not scored), deal can be "needs_review" for wrong reason. |
| **Executive Snapshot cache** | Stale cache returns old snapshot. Leadership may act on outdated synthesis. |
| **No confidence on rollups** | Commit amount, Best Case amount shown without "based on N deals, X% high-confidence." Leadership can't gauge reliability. |

---

## 4. Feature-Function Alignment

### 4.1 Ingestion

| Aspect | Assessment |
|--------|------------|
| **Strong** | Two paths (CRM staging + comment queue) are separated. Field mapping is flexible. process_ingestion_batch is DB-native, robust. |
| **Fragile** | Comment ingestion requires Redis. CRM ingest never sets predictive_eligible. normalize_row uses mapping_set_id in a confusing way (second arg is mapping_set_id, not org_id in some migrations). |
| **Missing** | Backfill of predictive_eligible post-CRM ingest. Validation that crm_opp_id resolves before comment job. Idempotency keys for duplicate uploads. |

### 4.2 Scoring

| Aspect | Assessment |
|--------|------------|
| **Strong** | Single entry point (muscle.js). Baseline immutability. Evidence/confidence derivation. Closed pinning. |
| **Fragile** | Duplicated AI Forecast formula. confidence.js vs confidence.ts. No schema version on score_definitions (org-specific rubric changes not versioned). |
| **Missing** | Org-level threshold overrides. Score versioning for reproducibility. Batch scoring API for backfills. |

### 4.3 AI Forecast

| Aspect | Assessment |
|--------|------------|
| **Strong** | Deterministic health_score → bucket. Stored on opportunity. Consistent across reads. |
| **Fragile** | Formula duplicated in 4 places. Thresholds are magic numbers. |
| **Missing** | Confidence interval or range. Historical forecast tracking (what did AI say last week?). |

### 4.4 AI Verdict

| Aspect | Assessment |
|--------|------------|
| **Strong** | Commit Admission logic is clear. Downgrade and needs_review are explicit. |
| **Fragile** | One-level downgrade may under-penalize. Gate categories hardcoded. |
| **Missing** | Explanatory link from verdict to specific categories. Override with audit trail. |

### 4.5 Commit Admission

| Aspect | Assessment |
|--------|------------|
| **Strong** | Shared logic in commitAdmission + commitAdmissionAggregates. Gate categories and confidence rules are explicit. |
| **Fragile** | Binary ≥2 high-confidence. No partial credit. Org-specific gate sets not supported. |
| **Missing** | Per-deal "what to improve" checklist. Trend over time (improving vs degrading). |

### 4.6 Risk Radar

| Aspect | Assessment |
|--------|------------|
| **Strong** | Uses gap-driving-deals API. Risk flags from scores + confidence. Evidence fragility called out. |
| **Fragile** | Count-based, not dollar-weighted. Tone (bad/warn/good) is heuristic. |
| **Missing** | Dollar impact per driver. Link from driver to specific deals. |

### 4.7 Executive Dashboards

| Aspect | Assessment |
|--------|------------|
| **Strong** | Rich composition. Commit Admission aggregates. Partners view. Quota integration. |
| **Fragile** | Many sequential queries. predictive_eligible filter can include NULL. Executive Snapshot cache semantics. |
| **Missing** | Loading states for slow queries. Export to PDF/Excel. Role-based default views. |

---

## 5. Prioritized Punch List

### 🔥 Critical (Correctness / Credibility Risks)

| # | Item | Why It Matters | Risk If Ignored | Effort | Direction |
|---|------|----------------|-----------------|--------|-----------|
| 1 | **Set predictive_eligible on CRM ingest** | Closed deals from CRM-only ingest have NULL and are included in aggregates and training. | Training data pollution; inflated Commit/Best Case; CRO trust erosion. | M | Add post-process in `processIngestionBatch` after `process_ingestion_batch`: `UPDATE opportunities SET predictive_eligible = (NOT closed) WHERE org_id = $1` with closed derived from forecast_stage/sales_stage. Or add to `upsert_opportunity` in DB migration if repo can propose migration. |
| 2 | **Backfill predictive_eligible for existing rows** | Historical opportunities may have NULL. | Same as above for legacy data. | M | One-time migration or script: `UPDATE opportunities SET predictive_eligible = CASE WHEN (forecast_stage ~* '\y(won|lost|closed)\y' OR sales_stage ~* '\y(won|lost|closed)\y') THEN false ELSE true END WHERE predictive_eligible IS NULL`. |
| 3 | **Centralize AI Forecast formula** | Four copies of 24/18 thresholds. | Drift → inconsistent AI Forecast across forecast/deals, gap-driving-deals, commit admission, muscle. | S | Extract to `web/lib/aiForecast.ts`: `computeAiBucketFromHealthScore(score): "Commit" \| "Best Case" \| "Pipeline" \| null`. Import in muscle.js (via small bridge if needed), forecast/deals, commitAdmissionAggregates, gap-driving-deals. |
| 4 | **Training export: require scored closed deals** | Training needs outcomes (Won/Lost) + features (scores). CRM-only closed deals have outcome but no scores. | Training on rows with outcome but no features → noise, unlearnable. | S | Training export: `WHERE (closed) AND (health_score IS NOT NULL OR baseline_health_score IS NOT NULL)`. Ensures we only train on deals that were scored before close. predictive_eligible backfill (item 2) fixes dashboard aggregates; training filter is separate. |

### ⚠️ High-Value Improvements

| # | Item | Why It Matters | Risk If Ignored | Effort | Direction |
|---|------|----------------|-----------------|--------|-----------|
| 5 | **Persist deal-review sessions** | In-memory Maps lose state on restart. | Reps lose mid-review progress; support burden. | L | Add `deal_review_sessions` table (session_id, org_id, rep_name, deals_json, index, state, updated_at). On start, insert; on input, update. Runner reads from DB. TTL or explicit cleanup for stale sessions. |
| 6 | **Worker retry + DLQ** | Failed jobs are not retried. | Permanently failed rows require manual re-upload. | M | BullMQ retry: `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`. On final failure, move to DLQ or mark job as `failed` with `failedReason`. Add admin UI to list failed jobs and retry. |
| 7 | **Executive dashboard query batching** | Sequential queries add latency. | Slow dashboard loads; timeout risk for large orgs. | M | Use `Promise.all` for independent queries (reps, quota periods, pipeline snapshot, commit admission, partners). Keep dependent queries sequential. Add query timeout. |
| 8 | **Commit Admission explanatory link** | "needs_review" / "not_admitted" without which categories. | Reps don't know what to fix. | S | In `computeCommitAdmission`, extend `reasons` to include specific categories (e.g., "Paper: low confidence", "Process: score 1"). Surface in deal cards and gap-driving-deals. |
| 9 | **Executive Snapshot cache TTL** | Cache never expires. | Stale snapshots after new data. | S | Add `created_at` to cache; invalidate if older than 24h or if input hash changes. Or add explicit "Regenerate" button that bypasses cache. |
| 10 | **Gap-driving-deals dollar-weighted Risk Radar** | Count-based drivers underweight large deals. | CRO sees "Pain: 12" but $2M is in one deal. | M | Add `amount` to risk driver aggregation. Option: `mode=dollar` to show "Pain: $2.1M (12 deals)" vs `mode=count`. |

### 🧱 Structural Technical Debt

| # | Item | Why It Matters | Risk If Ignored | Effort | Direction |
|---|------|----------------|-----------------|--------|-----------|
| 11 | **Unify confidence.js and confidence.ts** | Two implementations can drift. | Bug fixes in one not reflected in other. | S | Make `confidence.ts` canonical. Export from web/lib. muscle.js imports via dynamic require or move muscle to TypeScript. Or: ensure confidence.js is generated from confidence.ts (build step). |
| 12 | **Extract CRM bucket logic** | Regex and LIKE patterns duplicated. | Stage name changes require multi-file edits. | M | Create `web/lib/crmBucket.ts`: `computeCrmBucket(row)`, `isCommitStage(fs)`, `isBestCaseStage(fs)`. Use shared regex. Import in commitAdmission, executiveForecastDashboard, gap-driving-deals. |
| 13 | **Clarify deal-review entry points** | `deal-review/start` vs `deal-review/queue/start`. | Confusion; divergent behavior. | S | Document: `queue/start` is canonical for queue-based review. Deprecate or alias `start` to `queue/start`. Remove duplicate if truly redundant. |
| 14 | **Gap-driving-deals route split** | 1500+ lines, mixed concerns. | Hard to test, optimize, or extend. | L | Extract: (1) data fetching + filters, (2) driver computation, (3) risk computation, (4) response shaping. Consider separate routes for drivers vs risk if query patterns differ. |
| 15 | **audit_details merge strategy** | `jsonb_set` overwrites `scoring`. | Other keys in audit_details can be lost. | S | Use `jsonb_set(audit_details, '{scoring}', (COALESCE(audit_details->'scoring','{}') || $3::jsonb))` or merge in app layer before write. |

### 🚀 Future Moat Enhancers

| # | Item | Why It Matters | Risk If Ignored | Effort | Direction |
|---|------|----------------|-----------------|--------|-----------|
| 16 | **Training export pipeline** | Need point-in-time snapshots for model training. | Ad-hoc exports; no reproducibility. | L | Add `GET /api/analytics/training-export` (or batch job) with filters: org, period, predictive_eligible=true, outcome known. Output: opportunities + scores + outcome. Version with schema_version. |
| 17 | **evidence_strength from comment ingestion** | Baseline scores lack evidence_strength. | Training features incomplete. | M | Extend `CommentIngestionExtracted` and extraction prompt to include per-category evidence_strength. Map to `*_evidence_strength` in applyCommentIngestionToOpportunity. |
| 18 | **Org-level threshold overrides** | 24/18 may not fit all orgs. | One-size-fits-all; CRO customization requests. | M | Add `org_settings` or `score_definitions` extension: `commit_threshold`, `best_case_threshold`. Thread through computeAiBucket. Default to 24/18. |
| 19 | **Score versioning** | Rubric changes over time. | Can't reproduce "what was score at close?" | L | Add `score_schema_version` or `rubric_version` to opportunities. On save, stamp version. Migration to backfill from score_definitions checksum. |
| 20 | **Worker horizontal scaling** | Concurrency 2 limits throughput. | Large orgs wait for ingestion. | M | Make concurrency configurable (env). Use BullMQ job priorities. Consider multiple queues (e.g., by org) for isolation. |

### 🧪 Nice-to-Have Polish

| # | Item | Why It Matters | Risk If Ignored | Effort | Direction |
|---|------|----------------|-----------------|--------|-----------|
| 21 | **Dashboard "last updated" prominence** | Scores can be stale. | Reps trust old data. | S | Add `updated_at` or `score_age_days` to deal cards. Gray out or badge "Stale" if > 14 days. |
| 22 | **Sync fallback for small comment batches** | Redis required for any Excel comments. | Small orgs hit 503 without Redis. | M | If rows < 10 and no Redis, run `processSingleIngest`-style logic inline. Skip queue. |
| 23 | **Commit Admission trend** | "Verified Commit %" over time. | No visibility into improvement. | M | Add time-series query to commitAdmissionAggregates. Chart in dashboard. |
| 24 | **AI Verdict override with audit** | CRO may want to override downgrade. | No escape hatch. | M | Add `ai_verdict_override` column, `override_reason`, `override_by`, `override_at`. Commit Admission respects override when set. |
| 25 | **Worker progress checkpoint** | Crash loses progress. | Large jobs restart from zero. | M | Persist `lastProcessedIndex` to Redis or DB per job. On restart, resume from checkpoint. |

---

## 6. Summary

**Critical path:** Fix predictive_eligible for CRM ingest and backfill (items 1–2). Centralize AI Forecast formula (item 3). These directly affect correctness and credibility.

**High leverage:** Session persistence (5), worker retry (6), dashboard batching (7), Commit Admission explanations (8). These improve reliability and UX without large rewrites.

**Moat:** Training export (16), evidence_strength in ingestion (17), threshold overrides (18). These enable future ML differentiation and org customization.

**Debt:** Unify confidence, extract CRM bucket, split gap-driving-deals. Reduces drift and maintenance cost.

---

*End of PASS 2 — Strategic Architecture Review*
