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
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
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
"[project]/web/app/api/agent/init/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$prompt$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/lib/prompt.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$tools$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/lib/tools.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$api$2f$agent$2f$sessions$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/api/agent/sessions.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$externals$5d2f$pg__$5b$external$5d$__$28$pg$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$pg$29$__
]);
[__TURBOPACK__imported__module__$5b$externals$5d2f$pg__$5b$external$5d$__$28$pg$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$pg$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
;
;
const runtime = "nodejs";
const pool = new __TURBOPACK__imported__module__$5b$externals$5d2f$pg__$5b$external$5d$__$28$pg$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$pg$29$__["Pool"]({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});
;
async function POST(req) {
    try {
        const body = await req.json();
        const orgId = Number(body.orgId || 1);
        const repName = String(body.repName || "Rep");
        const result = await pool.query(`
      SELECT o.*
      FROM opportunities o
      WHERE o.org_id = $1
        AND o.rep_name = $2
        AND o.review_now = TRUE
        AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
      ORDER BY o.id ASC
      `, [
            orgId,
            repName
        ]);
        const defsRes = await pool.query(`
      SELECT category, score, label, criteria
      FROM score_definitions
      WHERE org_id = $1
      ORDER BY category ASC, score ASC
      `, [
            orgId
        ]);
        const deals = result.rows || [];
        const scoreDefs = defsRes.rows || [];
        const sessionId = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["randomUUID"])();
        const touched = new Set();
        __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$api$2f$agent$2f$sessions$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessions"].set(sessionId, {
            orgId,
            repName,
            deals,
            index: 0,
            scoreDefs,
            touched,
            items: [],
            wrapSaved: false
        });
        const deal = deals[0];
        const instructions = deal ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$prompt$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"])(deal, repName.split(" ")[0] || repName, deals.length, true, touched, scoreDefs) : [
            "SYSTEM PROMPT — SALES FORECAST AGENT",
            "You are Matthew from Sales Forecaster. Speak only English.",
            "We are doing a structured forecast review.",
            "No deals were found for this rep. Do NOT chat generally.",
            "Ask the rep to provide a deal to review with:",
            "- account name",
            "- opportunity name (optional)",
            "- forecast stage",
            "- amount",
            "- close date",
            "Then ask the first MEDDPICC gap question for the provided stage."
        ].join("\n");
        return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            sessionId,
            instructions,
            tools: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$tools$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildTools"])()
        });
    } catch (e) {
        const fallbackInstructions = [
            "SYSTEM PROMPT — SALES FORECAST AGENT",
            "You are Matthew from Sales Forecaster. Speak only English.",
            "We are doing a structured forecast review.",
            "I couldn't load deals from the system.",
            "Ask the rep to provide a deal to review with:",
            "- account name",
            "- opportunity name (optional)",
            "- forecast stage",
            "- amount",
            "- close date",
            "Then ask the first MEDDPICC gap question for the provided stage."
        ].join("\n");
        const sessionId = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["randomUUID"])();
        __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$api$2f$agent$2f$sessions$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessions"].set(sessionId, {
            orgId: 1,
            repName: "Rep",
            deals: [],
            index: 0,
            scoreDefs: [],
            touched: new Set(),
            items: [],
            wrapSaved: false
        });
        return __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            sessionId,
            instructions: fallbackInstructions,
            tools: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$lib$2f$tools$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildTools"])(),
            error: "Init failed",
            detail: e?.message || String(e)
        });
    }
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__dfa6c136._.js.map