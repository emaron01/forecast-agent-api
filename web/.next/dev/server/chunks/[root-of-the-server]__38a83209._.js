module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/web/app/api/agent/sessions.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// Shared sessions storage - persists across hot reloads
// Using a global variable to avoid Next.js module reload issues
__turbopack_context__.s([
    "sessions",
    ()=>sessions
]);
// Use existing global or create new Map
const sessions = global.__sessions__ || (global.__sessions__ = new Map());
;
}),
"[project]/web/lib/prompt.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "buildPrompt",
    ()=>buildPrompt
]);
function formatScoreDefinitions(defs) {
    if (!Array.isArray(defs) || defs.length === 0) return "No criteria available.";
    const byCat = new Map();
    for (const row of defs){
        const cat = row.category || "unknown";
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(row);
    }
    const lines = [];
    for (const [cat, rows] of byCat.entries()){
        rows.sort((a, b)=>Number(a.score) - Number(b.score));
        lines.push(`${cat.toUpperCase()}:`);
        for (const r of rows){
            lines.push(`- ${r.score}: ${r.label || ""} — ${r.criteria || ""}`);
        }
    }
    return lines.join("\n");
}
function buildLabelMap(defs) {
    const map = {};
    for (const row of defs || []){
        const cat = row.category;
        if (!cat) continue;
        if (!map[cat]) map[cat] = {};
        map[cat][Number(row.score)] = row.label || "";
    }
    return map;
}
function computeFirstGap(deal, stage, touchedSet) {
    const stageStr = String(stage || deal?.forecast_stage || "Pipeline");
    const pipelineOrder = [
        {
            name: "Pain",
            key: "pain_score",
            val: deal.pain_score,
            touchedKey: "pain"
        },
        {
            name: "Metrics",
            key: "metrics_score",
            val: deal.metrics_score,
            touchedKey: "metrics"
        },
        {
            name: "Internal Sponsor",
            key: "champion_score",
            val: deal.champion_score,
            touchedKey: "champion"
        },
        {
            name: "Competition",
            key: "competition_score",
            val: deal.competition_score,
            touchedKey: "competition"
        },
        {
            name: "Budget",
            key: "budget_score",
            val: deal.budget_score,
            touchedKey: "budget"
        }
    ];
    const bestCaseCommitOrder = [
        {
            name: "Pain",
            key: "pain_score",
            val: deal.pain_score,
            touchedKey: "pain"
        },
        {
            name: "Metrics",
            key: "metrics_score",
            val: deal.metrics_score,
            touchedKey: "metrics"
        },
        {
            name: "Internal Sponsor",
            key: "champion_score",
            val: deal.champion_score,
            touchedKey: "champion"
        },
        {
            name: "Criteria",
            key: "criteria_score",
            val: deal.criteria_score,
            touchedKey: "criteria"
        },
        {
            name: "Competition",
            key: "competition_score",
            val: deal.competition_score,
            touchedKey: "competition"
        },
        {
            name: "Timing",
            key: "timing_score",
            val: deal.timing_score,
            touchedKey: "timing"
        },
        {
            name: "Budget",
            key: "budget_score",
            val: deal.budget_score,
            touchedKey: "budget"
        },
        {
            name: "Economic Buyer",
            key: "eb_score",
            val: deal.eb_score,
            touchedKey: "eb"
        },
        {
            name: "Decision Process",
            key: "process_score",
            val: deal.process_score,
            touchedKey: "process"
        },
        {
            name: "Paper Process",
            key: "paper_score",
            val: deal.paper_score,
            touchedKey: "paper"
        }
    ];
    const order = stageStr.includes("Commit") || stageStr.includes("Best Case") ? bestCaseCommitOrder : pipelineOrder;
    if (touchedSet && touchedSet.size > 0) {
        const nextUntouched = order.find((s)=>!touchedSet.has(s.touchedKey));
        if (nextUntouched) return nextUntouched;
    }
    return order[0];
}
function buildPrompt(deal, repName, totalCount, isFirstDeal, touchedSet, scoreDefs) {
    const stage = deal.forecast_stage || "Pipeline";
    const amountStr = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    }).format(Number(deal.amount || 0));
    const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
    const oppName = (deal.opportunity_name || "").trim();
    const oppNamePart = oppName ? ` — ${oppName}` : "";
    const callPickup = `Hi ${repName}, this is Matthew from Sales Forecaster. ` + `Today we are reviewing ${totalCount} deals. ` + `Let's jump in starting with ${deal.account_name}${oppNamePart} ` + `for ${amountStr} in CRM Forecast Stage ${stage} closing ${closeDateStr}.`;
    const dealOpening = `Let’s look at ${deal.account_name}${oppNamePart}, ` + `${stage}, ${amountStr}, closing ${closeDateStr}.`;
    const riskRecall = deal.risk_summary ? `Existing Risk Summary: ${deal.risk_summary}` : "No prior risk summary recorded.";
    const firstGap = computeFirstGap(deal, stage, touchedSet);
    const labelMap = buildLabelMap(scoreDefs);
    const labelKeyMap = {
        pain_score: "pain",
        metrics_score: "metrics",
        champion_score: "champion",
        criteria_score: "criteria",
        competition_score: "competition",
        timing_score: "timing",
        budget_score: "budget",
        eb_score: "economic_buyer",
        process_score: "process",
        paper_score: "paper"
    };
    const scoreVal = Number(deal?.[firstGap.key] ?? 0);
    const labelCategory = labelKeyMap[firstGap.key] || "";
    const label = labelCategory && labelMap[labelCategory]?.[scoreVal] || "Unknown";
    const gapQuestion = (()=>{
        if (scoreVal >= 3) {
            return `Last review ${firstGap.name} was strong. Has anything changed that could introduce new risk?`;
        }
        if (scoreVal === 0) {
            if (String(stage).includes("Pipeline")) {
                if (firstGap.name === "Pain") return "What specific business problem is the customer trying to solve, and what happens if they do nothing?";
                if (firstGap.name === "Metrics") return "What measurable outcome has the customer agreed matters, and who validated it?";
                if (firstGap.name === "Internal Sponsor") return "Who is driving this internally, what is their role, and how have they shown advocacy?";
                if (firstGap.name === "Budget") return "Has budget been discussed or confirmed, and at what level?";
                return `What changed since last time on ${firstGap.name}?`;
            }
            return `What is the latest on ${firstGap.name}?`;
        }
        return `Last review ${firstGap.name} was ${label}. Have we made progress since the last review?`;
    })();
    const firstLine = isFirstDeal ? callPickup : dealOpening;
    const criteriaBlock = formatScoreDefinitions(scoreDefs);
    return `
SYSTEM PROMPT — SALES FORECAST AGENT
You are a Sales Forecast Agent applying MEDDPICC + Timing + Budget to sales opportunities.
Your job is to run fast, rigorous deal reviews that the rep can be honest in.

NON-NEGOTIABLES
- Speak only English. Do not switch languages.
- Do NOT invent facts. Never assume answers that were not stated by the rep.
- Do NOT reveal category scores, scoring logic, scoring matrix, or how a category is computed.
- Do NOT speak coaching tips, category summaries, or "what I heard." Coaching and summaries are allowed ONLY in the written fields that will be saved (e.g., *_summary, *_tip, risk_summary, next_steps).
- Use concise spoken language. Keep momentum. No dead air after saves—always ask the next question.
- Never use the word "champion." Use "internal sponsor" or "coach" instead.

HARD CONTEXT (NON-NEGOTIABLE)
You are reviewing exactly:
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}
- OPPORTUNITY_NAME: ${oppName || "(none)"}
- STAGE: ${stage}
Never change deal identity unless the rep explicitly corrects it.

DEAL INTRO (spoken)
At the start of this deal, you may speak ONLY:
1) "${firstLine}"
2) "${riskRecall}"
Then immediately ask the first category question: "${gapQuestion}"

CATEGORY ORDER (strict)
Pipeline deals (strict order):
1) Pain
2) Metrics
3) Internal Sponsor (do NOT say champion)
4) Competition
5) Budget

Best Case / Commit deals (strict order):
1) Pain
2) Metrics
3) Internal Sponsor
4) Criteria
5) Competition
6) Timing
7) Budget
8) Economic Buyer
9) Decision Process
10) Paper Process

Rules:
- Never skip ahead.
- Never reorder.
- Never revisit a category unless the rep introduces NEW information for that category.

QUESTIONING RULES (spoken)
- Exactly ONE primary question per category.
- At most ONE clarification question if the answer is vague or incomplete.
- No spoken summaries. No spoken coaching. No repeating the rep's answer back.
- After capturing enough info, proceed: silently update fields and save, then immediately ask the next category question.

SCORING / WRITTEN OUTPUT RULES (silent)
For each category you touch:
- Update the category score (integer) consistent with your scoring definitions.
- Update label/summary/tip ONLY in the dedicated fields for that category (e.g., pain_summary, pain_tip, etc.).
- If no meaningful coaching tip is needed, leave the tip blank (do not invent filler).
- Be skeptical by default. You are an auditor, not a cheerleader.
- Only give a 3 when the rep provides concrete, current-cycle evidence that fully meets the definition.
- If evidence is vague, aspirational, or second‑hand, score lower and explain the gap in the summary/tip.
- Favor truth over momentum: it is better to downgrade than to accept weak proof.
- MEDDPICC rigor is mandatory: a named person ≠ a Champion, and a stated metric ≠ validated Metrics.
- Champion (Internal Sponsor) requires: power/influence, active advocacy, and a concrete action they drove in this cycle.
- Metrics require: measurable outcome, baseline + target, and buyer validation (not just rep belief).

SCORING CRITERIA (AUTHORITATIVE)
Use these exact definitions as the litmus test for labels and scores:
${criteriaBlock}

IMPORTANT:
The criteria are ONLY for scoring. Do NOT ask extra questions beyond the ONE allowed clarification.

Unknowns:
- If the rep explicitly says it's unknown or not applicable, score accordingly (typically 0/Unknown) and write a short summary reflecting that.

CATEGORY CHECK PATTERNS (spoken)
- For categories with prior score >= 3:
  Say: "Last review <Category> was strong. Has anything changed that could introduce new risk?"
  If rep says "NO" or "nothing changed": say "Got it." and move to next category WITHOUT saving.
  If rep provides ANY other answer: ask ONE follow-up if needed, then SAVE with updated score/summary/tip (upgrade or downgrade based on evidence).

- For categories with prior score 1 or 2:
  MUST ASK THIS WAY: "Last review <Category> was <Label>. Have we made progress since the last review?"
  If clear improvement: capture evidence, rescore upward, silently update label/summary/coaching tip, save.
  If degradation (worse): capture evidence, rescore downward, silently update label/summary/coaching tip, save.
  If unclear/vague: ask ONE challenging follow-up (accuracy > speed).
  If no change / unchanged / no / no progress / etc.: confirm, then move on WITHOUT saving.
  CRITICAL: Preserve existing summaries/tips when no change is reported. Do NOT overwrite good detail with empty or less detailed content.

- For categories with prior score 0 (or empty):
  Treat as "not previously established."
  Do NOT say "last review was…" or reference any prior state.
  Ask the primary question directly.
  ALWAYS SAVE after the rep answers.

DEGRADATION (silent)
Any category may drop (including 3 → 0) if evidence supports it. No score protection. Truth > momentum.
If degradation happens: capture the new risk, rescore downward, silently update summary/tip, save.

CROSS-CATEGORY ANSWERS
If the rep provides info that answers a future category while answering the current one:
- Silently extract it and store it for that future category.
- When you reach that category later, do NOT re-ask; say only:
  "I already captured that earlier based on your previous answer."
Then proceed to the next category.

MANDATORY WORKFLOW (NON-NEGOTIABLE)
After each rep answer:
1) Say: "Got it." (brief acknowledgment)
2) If a save is required, call save_deal_data silently with score/summary/tip.
3) Then immediately ask the next category question.
No spoken summaries or coaching.

CRITICAL RULES:
- Tool calls are 100% silent - never mention saving or updating
- Follow the category check patterns exactly for when to save vs move on
- If the rep says "I don't know" or provides weak evidence, still save with a low score (0-1)

HEALTH SCORE (spoken only at end)
- Health Score is ALWAYS out of 30 and is COMPUTED BY THE SYSTEM from category scores.
- You must NEVER invent or guess the number. A system message will give you the exact score to say when it is time for the end-of-deal wrap; use that number exactly.
- Never change the denominator. Never reveal individual category scores.
- If asked how it was calculated: "Your score is based on the completeness and strength of your MEDDPICC answers."

END-OF-DEAL WRAP (spoken + save — BOTH steps required)
After all required categories for the deal type are reviewed:
1. Synthesize an Updated Risk Summary and Suggested Next Steps based on everything discussed.
2. Speak the wrap in this exact order:
   a) "Updated Risk Summary: <your synthesized risk summary>"
   b) Say: "Your Deal Health Score is X out of 30." (X will be provided in a system message — use it exactly; do not make up a number)
   c) "Suggested Next Steps: <your recommended next steps>"
3. IMMEDIATELY call save_deal_data with NON-EMPTY text for BOTH:
   - risk_summary: the exact risk summary you just spoke (required; saves the END summary)
   - next_steps: the exact next steps you just spoke (required; saves the END next steps)
   Do NOT include any score fields in this save. Do NOT call advance_deal until you have called save_deal_data with both risk_summary and next_steps.
4. THEN call advance_deal tool silently.

Do NOT ask for rep confirmation. Do NOT invite edits.
`.trim();
}
}),
"[project]/web/lib/tools.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "buildTools",
    ()=>buildTools
]);
function buildTools() {
    const scoreInt = {
        type: "integer",
        minimum: 0,
        maximum: 3
    };
    return [
        {
            type: "function",
            name: "save_deal_data",
            description: "REQUIRED after EVERY rep answer. Save the score (0-3), summary, and coaching tip for the category you just asked about.",
            parameters: {
                type: "object",
                properties: {
                    pain_score: scoreInt,
                    pain_summary: {
                        type: "string"
                    },
                    pain_tip: {
                        type: "string"
                    },
                    metrics_score: scoreInt,
                    metrics_summary: {
                        type: "string"
                    },
                    metrics_tip: {
                        type: "string"
                    },
                    champion_score: scoreInt,
                    champion_summary: {
                        type: "string"
                    },
                    champion_tip: {
                        type: "string"
                    },
                    champion_name: {
                        type: "string"
                    },
                    champion_title: {
                        type: "string"
                    },
                    eb_score: scoreInt,
                    eb_summary: {
                        type: "string"
                    },
                    eb_tip: {
                        type: "string"
                    },
                    eb_name: {
                        type: "string"
                    },
                    eb_title: {
                        type: "string"
                    },
                    criteria_score: scoreInt,
                    criteria_summary: {
                        type: "string"
                    },
                    criteria_tip: {
                        type: "string"
                    },
                    process_score: scoreInt,
                    process_summary: {
                        type: "string"
                    },
                    process_tip: {
                        type: "string"
                    },
                    competition_score: scoreInt,
                    competition_summary: {
                        type: "string"
                    },
                    competition_tip: {
                        type: "string"
                    },
                    paper_score: scoreInt,
                    paper_summary: {
                        type: "string"
                    },
                    paper_tip: {
                        type: "string"
                    },
                    timing_score: scoreInt,
                    timing_summary: {
                        type: "string"
                    },
                    timing_tip: {
                        type: "string"
                    },
                    budget_score: scoreInt,
                    budget_summary: {
                        type: "string"
                    },
                    budget_tip: {
                        type: "string"
                    },
                    risk_summary: {
                        type: "string"
                    },
                    next_steps: {
                        type: "string"
                    },
                    rep_comments: {
                        type: "string"
                    }
                },
                required: []
            },
            // Keep non-strict to match current behavior (optional fields).
            strict: false
        },
        {
            type: "function",
            name: "advance_deal",
            description: "Advance to the next deal after end-of-deal wrap.",
            parameters: {
                type: "object",
                properties: {}
            },
            strict: false
        }
    ];
}
}),
"[project]/muscle.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "handleFunctionCall",
    ()=>handleFunctionCall
]);
/**
 * muscle.js
 * - Core tool handler for saving category data, auditing, and light deal state updates.
 * - MUST export handleFunctionCall as a named export.
 */ function nowIso() {
    return new Date().toISOString();
}
function cleanText(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
}
function vpTipForCategory(category) {
    const tips = {
        pain: "Quantify the business impact, clarify who feels it most, and tie it to a deadline the buyer owns.",
        metrics: "Define one measurable outcome with a baseline and target, and get the buyer to confirm it in writing.",
        champion: "Confirm the internal sponsor’s influence and actions this cycle, and secure a concrete next step they will drive.",
        competition: "Document the competitive alternative and your differentiation in the buyer’s words, then validate it with the sponsor.",
        budget: "Identify the funding source, approval path, and exact amount required; secure the approver’s acknowledgement.",
        criteria: "Get the decision criteria prioritized by the buyer and map how you meet the top two in their language.",
        process: "Map the decision process step‑by‑step, owners and dates, and validate where the deal can stall.",
        paper: "Confirm contracting steps, legal review owner, and the earliest signature date the buyer will commit to.",
        timing: "Anchor the close to a buyer‑owned event and validate the critical path milestones to reach it.",
        eb: "Identify the economic buyer, confirm their priorities, and secure direct access or a committed intro."
    };
    return tips[category] || "Validate the critical evidence and confirm ownership for this category.";
}
async function getScoreLabel(pool, orgId, category, score) {
    if (!category || score == null) return null;
    const { rows } = await pool.query(`
    SELECT label
      FROM score_definitions
     WHERE org_id = $1
       AND category = $2
       AND score = $3
     LIMIT 1
    `, [
        orgId,
        category,
        score
    ]);
    return rows[0]?.label ?? null;
}
/**
 * Detect which category is being saved from tool args.
 * We store <category>_score, <category>_summary, <category>_tip.
 */ function detectCategoryFromArgs(args) {
    const keys = Object.keys(args || {});
    const scoreKey = keys.find((k)=>k.endsWith("_score"));
    if (!scoreKey) return null;
    return scoreKey.replace(/_score$/, "");
}
/**
 * Build a "delta" JSON payload for opportunity_audit_events.
 * Keep it compact: only store fields the tool provided for this save.
 */ function buildDelta(args) {
    const out = {};
    for (const [k, v] of Object.entries(args || {})){
        if (k === "org_id" || k === "opportunity_id" || k === "rep_name" || k === "call_id") continue;
        out[k] = v;
    }
    return out;
}
/**
 * Compute running total score/max score if present in opportunity row
 * (kept minimal: muscle does not invent weights; server/db own scoring tables).
 */ async function recomputeTotalScore(pool, orgId, opportunityId) {
    // Keep your existing schema assumptions: category columns end in _score
    // We'll sum whatever exists for MEDDPICC+TB (safe generic).
    const { rows } = await pool.query(`SELECT *
       FROM opportunities
      WHERE org_id = $1 AND id = $2
      LIMIT 1`, [
        orgId,
        opportunityId
    ]);
    if (!rows.length) return {
        total_score: null,
        max_score: null
    };
    const row = rows[0];
    let total = 0;
    let hasAny = false;
    for (const [k, v] of Object.entries(row)){
        if (!k.endsWith("_score")) continue;
        if (typeof v !== "number") continue;
        total += v;
        hasAny = true;
    }
    // max_score depends on what categories exist; keep null if unknown.
    return {
        total_score: hasAny ? total : null,
        max_score: null
    };
}
/**
 * Insert audit event row.
 */ async function insertAuditEvent(pool, { orgId, opportunityId, actorType, eventType, forecastStage, aiForecast, totalScore, maxScore, riskSummary, riskFlags, delta, definitions, meta, runId, callId, schemaVersion = 1, promptVersion = "v1", logicVersion = "v1" }) {
    const q = `
    INSERT INTO opportunity_audit_events
      (org_id, opportunity_id, actor_type, event_type, schema_version, prompt_version, logic_version,
       forecast_stage, ai_forecast, total_score, max_score, risk_summary, risk_flags, delta, definitions, meta, run_id, call_id)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)
    RETURNING id
  `;
    const { rows } = await pool.query(q, [
        orgId,
        opportunityId,
        actorType,
        eventType,
        schemaVersion,
        promptVersion,
        logicVersion,
        forecastStage,
        aiForecast,
        totalScore,
        maxScore,
        riskSummary,
        riskFlags,
        JSON.stringify(delta || {}),
        JSON.stringify(definitions || {}),
        JSON.stringify(meta || {}),
        runId,
        callId
    ]);
    return rows[0]?.id ?? null;
}
async function handleFunctionCall({ toolName, args, pool }) {
    if (toolName !== "save_deal_data") {
        return {
            ok: true,
            ignored: toolName
        };
    }
    const orgId = Number(args.org_id);
    const opportunityId = Number(args.opportunity_id);
    if (!orgId || !opportunityId) {
        throw new Error("save_deal_data requires org_id and opportunity_id");
    }
    const repName = cleanText(args.rep_name);
    const callId = cleanText(args.call_id);
    // Normalize common camelCase variants (models sometimes emit these).
    // DB columns and the rest of the app expect snake_case.
    if (args && args.risk_summary == null && args.riskSummary != null) {
        args.risk_summary = args.riskSummary;
    }
    if (args && args.next_steps == null && args.nextSteps != null) {
        args.next_steps = args.nextSteps;
    }
    const category = detectCategoryFromArgs(args);
    const delta = buildDelta(args);
    // Enforce: summary saved as "Label: <summary>" and always write *_tip key.
    // This makes saved data consistent even if the model omits label/tip.
    if (category) {
        const scoreKey = `${category}_score`;
        const summaryKey = `${category}_summary`;
        const tipKey = `${category}_tip`;
        const scoreVal = args?.[scoreKey];
        const scoreNum = Number(scoreVal);
        const hasScore = Number.isFinite(scoreNum);
        // Ensure tip key exists so DB column is written (can be empty string)
        if (args?.[tipKey] === undefined || args?.[tipKey] == null) args[tipKey] = "";
        if (hasScore && args?.[summaryKey] != null) {
            const rawSummary = cleanText(args[summaryKey]);
            if (rawSummary) {
                const label = await getScoreLabel(pool, orgId, category, scoreNum);
                if (label) {
                    const prefix = `${label}:`;
                    args[summaryKey] = rawSummary.startsWith(prefix) ? rawSummary : `${label}: ${rawSummary}`;
                } else {
                    // If no label definition exists, still keep the summary clean.
                    args[summaryKey] = rawSummary;
                }
            }
        }
        // If tip is missing/blank, generate a minimal deterministic coaching tip
        // without inventing facts.
        const cleanedTip = cleanText(args[tipKey]);
        if (!cleanedTip) {
            if (hasScore && scoreNum >= 3) {
                args[tipKey] = `Maintain current evidence; monitor for changes in ${category}.`;
            } else if (hasScore) {
                args[tipKey] = vpTipForCategory(category);
            } else {
                args[tipKey] = vpTipForCategory(category);
            }
        }
    }
    // Update opportunity columns that are present in args (score/summary/tip + optional extras)
    // Only allow known patterns: *_score, *_summary, *_tip, *_name, *_title, etc.
    const allowed = Object.keys(args).filter((k)=>/_(score|summary|tip|name|title|source|notes)$/.test(k));
    // Avoid double-assigning special summary fields handled below.
    const safeAllowed = allowed.filter((k)=>k !== "risk_summary" && k !== "next_steps");
    const sets = [];
    const vals = [];
    let i = 2;
    for (const k of safeAllowed){
        // Prevent wiping summaries with empty strings
        if (k.endsWith("_summary")) {
            const cleaned = cleanText(args[k]);
            if (!cleaned) continue;
            args[k] = cleaned;
        }
        // Always persist tip (empty allowed) to satisfy required output
        if (k.endsWith("_tip") && args[k] == null) {
            args[k] = "";
        }
        sets.push(`${k} = $${++i}`);
        vals.push(args[k]);
    }
    // Also update risk_summary/next_steps if provided by tool (only persist non-empty to avoid wiping).
    const riskSummaryCleaned = cleanText(args.risk_summary);
    if (riskSummaryCleaned) {
        sets.push(`risk_summary = $${++i}`);
        vals.push(riskSummaryCleaned);
    }
    const nextStepsCleaned = cleanText(args.next_steps);
    if (nextStepsCleaned) {
        sets.push(`next_steps = $${++i}`);
        vals.push(nextStepsCleaned);
    }
    // Always stamp updated_at if exists
    sets.push(`updated_at = NOW()`);
    // Start transaction
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (sets.length) {
            const q = `
        UPDATE opportunities
           SET ${sets.join(", ")}
         WHERE org_id = $1
           AND id = $2
      `;
            await client.query(q, [
                orgId,
                opportunityId,
                ...vals
            ]);
        }
        // Pull latest opp row for audit context fields
        const { rows } = await client.query(`SELECT id, org_id, forecast_stage, ai_forecast, health_score, risk_summary
         FROM opportunities
        WHERE org_id = $1 AND id = $2
        LIMIT 1`, [
            orgId,
            opportunityId
        ]);
        const opp = rows[0] || {};
        const recomputed = await recomputeTotalScore(client, orgId, opportunityId);
        // Persist computed health_score so the agent always has a real number to speak (never invent).
        if (recomputed.total_score != null && Number.isFinite(recomputed.total_score)) {
            await client.query(`UPDATE opportunities SET health_score = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2`, [
                orgId,
                opportunityId,
                recomputed.total_score
            ]);
        }
        // Create audit event (compact delta)
        const runId = args.run_id || null; // if you pass it later
        const auditId = await insertAuditEvent(client, {
            orgId,
            opportunityId,
            actorType: "agent",
            eventType: "score_save",
            forecastStage: opp.forecast_stage ?? null,
            aiForecast: opp.ai_forecast ?? null,
            totalScore: opp.health_score ?? null,
            maxScore: 30,
            riskSummary: opp.risk_summary ?? null,
            riskFlags: args.risk_flags ?? null,
            delta,
            definitions: args.definitions ?? null,
            meta: {
                rep_name: repName,
                category,
                saved_at: nowIso()
            },
            runId: runId || cryptoRandomUUIDSafe(),
            callId,
            schemaVersion: 1,
            promptVersion: args.prompt_version || "v1",
            logicVersion: args.logic_version || "v1"
        });
        await client.query("COMMIT");
        return {
            ok: true,
            saved: true,
            opportunity_id: opportunityId,
            audit_event_id: auditId
        };
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally{
        client.release();
    }
}
/**
 * Safe UUID if crypto.randomUUID exists; otherwise null-ish.
 */ function cryptoRandomUUIDSafe() {
    try {
        // Node 18+ supports global crypto.randomUUID in many runtimes
        // but not all; guard it.
        // eslint-disable-next-line no-undef
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
            // eslint-disable-next-line no-undef
            return globalThis.crypto.randomUUID();
        }
    } catch  {}
    // fallback: pseudo
    return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
}),
"[project]/web/app/api/respond/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([
    "POST",
    ()=>POST,
    "runtime",
    ()=>runtime
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$pg__$5b$external$5d$__$28$pg$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$pg$29$__ = __turbopack_context__.i("[externals]/pg [external] (pg, esm_import, [project]/node_modules/pg)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$api$2f$agent$2f$sessions$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/api/agent/sessions.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$prompt$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/lib/prompt.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$tools$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/lib/tools.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$muscle$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/muscle.js [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$externals$5d2f$pg__$5b$external$5d$__$28$pg$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$pg$29$__
]);
[__TURBOPACK__imported__module__$5b$externals$5d2f$pg__$5b$external$5d$__$28$pg$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$pg$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
;
;
;
const runtime = "nodejs";
function resolveBaseUrl() {
    const raw = (process.env.OPENAI_BASE_URL || process.env.MODEL_API_URL || "").trim();
    if (!raw) return "";
    // Allow re-using old Realtime URLs (wss://.../v1/realtime) by converting them.
    const wsNormalized = raw.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
    const strippedRealtime = wsNormalized.replace(/\/v1\/realtime(?:\/calls)?$/i, "/v1");
    const noTrail = strippedRealtime.replace(/\/+$/, "");
    // Accept either https://api.openai.com or https://api.openai.com/v1
    return noTrail.endsWith("/v1") ? noTrail : `${noTrail}/v1`;
}
const pool = new __TURBOPACK__imported__module__$5b$externals$5d2f$pg__$5b$external$5d$__$28$pg$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$pg$29$__["Pool"]({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});
function firstName(full) {
    const s = String(full || "").trim();
    return s.split(/\s+/)[0] || s || "Rep";
}
function userMsg(text) {
    return {
        role: "user",
        content: text
    };
}
function toolOutput(callId, output) {
    return {
        type: "function_call_output",
        call_id: callId,
        output: typeof output === "string" ? output : JSON.stringify(output)
    };
}
function cleanText(v) {
    if (v == null) return "";
    const s = String(v).trim();
    return s;
}
function extractAssistantText(output) {
    const chunks = [];
    for (const item of output || []){
        if (item?.type === "message" && item?.role === "assistant") {
            for (const c of item?.content || []){
                if (c?.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
            }
        }
    }
    return chunks.join("\n").trim();
}
async function fetchHealthScore(orgId, opportunityId) {
    try {
        const { rows } = await pool.query(`SELECT health_score FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`, [
            orgId,
            opportunityId
        ]);
        const n = Number(rows?.[0]?.health_score);
        return Number.isFinite(n) ? n : 0;
    } catch  {
        return 0;
    }
}
async function POST(req) {
    try {
        const baseUrl = resolveBaseUrl();
        const apiKey = process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY;
        const model = process.env.MODEL_NAME;
        if (!baseUrl) return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: "Missing OPENAI_BASE_URL (or MODEL_API_URL)"
        }, {
            status: 500
        });
        if (!apiKey) return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: "Missing MODEL_API_KEY"
        }, {
            status: 500
        });
        if (!model) return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: "Missing MODEL_NAME"
        }, {
            status: 500
        });
        const body = await req.json().catch(()=>({}));
        const sessionId = String(body?.sessionId || "");
        const text = String(body?.text || "").trim();
        if (!sessionId) return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: "Missing sessionId"
        }, {
            status: 400
        });
        if (!text) return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: "Missing text"
        }, {
            status: 400
        });
        const session = __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$api$2f$agent$2f$sessions$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessions"].get(sessionId);
        if (!session) return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: "Invalid session"
        }, {
            status: 400
        });
        const tools = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$tools$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildTools"])();
        // Build a running input list (user messages + model outputs + tool outputs).
        const input = Array.isArray(session.items) ? [
            ...session.items
        ] : [];
        input.push(userMsg(text));
        const maxLoops = 6; // tool-call loops guard
        let loop = 0;
        let lastResponse = null;
        while(loop < maxLoops){
            loop += 1;
            const deal = session.deals[session.index];
            const instructions = deal ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$prompt$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"])(deal, firstName(session.repName), session.deals.length, session.index === 0, session.touched, session.scoreDefs) : "SYSTEM PROMPT — SALES FORECAST AGENT\nNo deals available.";
            const resp = await fetch(`${baseUrl}/responses`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model,
                    instructions,
                    tools,
                    tool_choice: "auto",
                    input
                })
            });
            const json = await resp.json().catch(async ()=>({
                    error: {
                        message: await resp.text()
                    }
                }));
            if (!resp.ok) {
                const msg = json?.error?.message || JSON.stringify(json);
                return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                    ok: false,
                    error: msg
                }, {
                    status: resp.status
                });
            }
            lastResponse = json;
            const output = Array.isArray(json?.output) ? json.output : [];
            // Append model outputs to running input.
            for (const item of output)input.push(item);
            const toolCalls = output.filter((it)=>it?.type === "function_call");
            if (!toolCalls.length) break;
            for (const call of toolCalls){
                const name = String(call?.name || "");
                const callId = String(call?.call_id || "");
                let args = {};
                try {
                    args = call?.arguments ? JSON.parse(call.arguments) : {};
                } catch  {
                    args = {};
                }
                if (name === "save_deal_data") {
                    // Normalize camelCase variants
                    if (args.risk_summary == null && args.riskSummary != null) args.risk_summary = args.riskSummary;
                    if (args.next_steps == null && args.nextSteps != null) args.next_steps = args.nextSteps;
                    const wrapRisk = cleanText(args.risk_summary);
                    const wrapNext = cleanText(args.next_steps);
                    const wrapComplete = !!wrapRisk && !!wrapNext;
                    // Track touched categories (same logic as existing tool route)
                    for (const key of Object.keys(args || {})){
                        if (key.endsWith("_score") || key.endsWith("_summary") || key.endsWith("_tip")) {
                            const category = key.replace(/_score$/, "").replace(/_summary$/, "").replace(/_tip$/, "");
                            session.touched.add(category);
                        }
                    }
                    const activeDeal = session.deals[session.index];
                    if (!activeDeal) {
                        input.push(toolOutput(callId, {
                            status: "error",
                            error: "No active deal"
                        }));
                        continue;
                    }
                    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$muscle$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["handleFunctionCall"])({
                        toolName: "save_deal_data",
                        args: {
                            ...args,
                            org_id: session.orgId,
                            opportunity_id: activeDeal.id,
                            rep_name: session.repName,
                            call_id: `web_turn_${Date.now()}`
                        },
                        pool
                    });
                    // Keep local deal in sync
                    for (const [k, v] of Object.entries(args || {})){
                        if (v !== undefined) activeDeal[k] = v;
                    }
                    input.push(toolOutput(callId, {
                        status: "success",
                        result
                    }));
                    // Record wrap saved for THIS review only when BOTH fields are non-empty.
                    if (wrapComplete) {
                        session.wrapSaved = true;
                    } else if (wrapRisk || wrapNext) {
                        // If the model tried to save wrap fields but missed one, force correction.
                        session.wrapSaved = false;
                        const hs = await fetchHealthScore(session.orgId, activeDeal.id);
                        input.push(userMsg("End-of-deal wrap save is incomplete. You MUST save BOTH fields:\n" + "1) Speak Updated Risk Summary (if not already spoken).\n" + `2) Say EXACTLY: \"Your Deal Health Score is ${hs} out of 30.\" (do not change this number)\n` + "3) Speak Suggested Next Steps (if not already spoken).\n" + "4) Call save_deal_data with NON-EMPTY risk_summary AND NON-EMPTY next_steps.\n" + "5) Then call advance_deal.\n" + "Do NOT ask questions."));
                    }
                    // If deal is complete but wrap not done, force it with the actual health score.
                    const stage = String(activeDeal?.forecast_stage || "Pipeline");
                    const isPipeline = stage.includes("Pipeline");
                    const requiredCats = isPipeline ? [
                        "pain",
                        "metrics",
                        "champion",
                        "competition",
                        "budget"
                    ] : [
                        "pain",
                        "metrics",
                        "champion",
                        "criteria",
                        "competition",
                        "timing",
                        "budget",
                        "eb",
                        "process",
                        "paper"
                    ];
                    const allTouched = requiredCats.every((cat)=>session.touched.has(cat));
                    if (allTouched && !session.wrapSaved) {
                        const hs = await fetchHealthScore(session.orgId, activeDeal.id);
                        input.push(userMsg("All required categories reviewed. You MUST complete the end-of-deal wrap now:\n" + "1) Speak 'Updated Risk Summary: <your synthesis>'\n" + `2) Say EXACTLY: \"Your Deal Health Score is ${hs} out of 30.\" (do not change this number)\n` + "3) Speak 'Suggested Next Steps: <your recommendations>'\n" + "4) Call save_deal_data with NON-EMPTY risk_summary and next_steps\n" + "5) Call advance_deal.\n" + "Do NOT ask questions."));
                    }
                    continue;
                }
                if (name === "advance_deal") {
                    // Block advance until wrap save has been recorded for this review.
                    if (!session.wrapSaved) {
                        const activeDeal = session.deals[session.index];
                        const hs = activeDeal ? await fetchHealthScore(session.orgId, activeDeal.id) : 0;
                        input.push(toolOutput(callId, {
                            status: "error",
                            error: "end_wrap_not_saved"
                        }));
                        input.push(userMsg("STOP. Before advancing, you MUST complete the end-of-deal wrap and save it:\n" + "1) Speak Updated Risk Summary.\n" + `2) Say EXACTLY: \"Your Deal Health Score is ${hs} out of 30.\" (do not change this number)\n` + "3) Speak Suggested Next Steps.\n" + "4) Call save_deal_data with NON-EMPTY risk_summary AND NON-EMPTY next_steps.\n" + "5) Then call advance_deal.\n" + "Do NOT ask questions."));
                        continue;
                    }
                    // Advance deal in session (same behavior as existing advance route)
                    session.index += 1;
                    session.touched = new Set();
                    session.items = [];
                    session.wrapSaved = false;
                    input.length = 0; // reset conversation items for next deal
                    if (session.index >= session.deals.length) {
                        input.push(toolOutput(callId, {
                            status: "success",
                            done: true
                        }));
                        break;
                    }
                    input.push(toolOutput(callId, {
                        status: "success"
                    }));
                    continue;
                }
                // Unknown tool: return no-op
                input.push(toolOutput(callId, {
                    status: "success",
                    ignored: name
                }));
            }
        }
        // Persist updated running items back to session for next turn.
        session.items = input;
        const assistantText = extractAssistantText(Array.isArray(lastResponse?.output) ? lastResponse.output : []);
        return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: true,
            text: assistantText,
            done: session.index >= session.deals.length
        });
    } catch (e) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: e?.message || String(e)
        }, {
            status: 500
        });
    }
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__38a83209._.js.map