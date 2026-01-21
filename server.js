require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(cors()); 
app.use(express.urlencoded({ extended: true })); 
app.use(express.json()); 

// --- 2. DATABASE CONNECTION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } 
});

// --- 3. SESSION STORAGE ---
const sessions = {}; 

// --- 4. DATABASE UTILITIES ---
async function incrementRunCount(oppId) {
    try {
        await pool.query(`UPDATE opportunities SET run_count = run_count + 1, last_agent_run = CURRENT_TIMESTAMP WHERE id = $1`, [oppId]);
    } catch (err) { console.error("DB Error:", err); }
}

async function saveCallResults(oppId, report) {
    try {
        const score = report.score !== undefined ? report.score : null;
        const summary = report.summary || "No summary provided.";
        const next_steps = report.next_steps || "Review deal manually.";
        const new_stage = report.new_forecast_category || null;

        // Safe JSON Parsing
        let audit_details = report.audit_details || null;
        if (typeof audit_details === 'string') {
             try { audit_details = JSON.parse(audit_details); } catch(e) { audit_details = null; }
        }
        
        let query = `
            UPDATE opportunities
            SET current_score = $1, initial_score = COALESCE(initial_score, $1), 
                last_summary = $2, next_steps = $3, audit_details = $4
        `;
        const params = [score, summary, next_steps, audit_details];
        
        // UPDATE: Writing to 'forecast_stage'
        if (new_stage && new_stage !== "No Change") {
            query += `, forecast_stage = $5 WHERE id = $6`;
            params.push(new_stage, oppId);
            console.log(`🔄 FORECAST MOVED TO: ${new_stage}`);
        } else {
            query += ` WHERE id = $5`;
            params.push(oppId);
        }

        await pool.query(query, params);
        console.log(`💾 Saved Deal ${oppId}: Score ${score}/27`);
    } catch (err) {
        console.error("❌ Save Error:", err);
    }
}

// --- 5. AGENT HELPER FUNCTIONS ---
function escapeXml(unsafe) {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;'; case '>': return '&gt;'; case '&': return '&amp;'; case '\'': return '&apos;'; case '"': return '&quot;';
        }
    });
}

const speak = (text) => {
    if (!text) return "";
    let cleanText = text.replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "").replace(/\d+\)\s/g, "").replace(/\d+\.\s/g, "");
    if (cleanText.length > 800) cleanText = cleanText.substring(0, 800) + "...";
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${escapeXml(cleanText)}</prosody></Say>`;
};

// --- 6. SYSTEM PROMPT (ALL SECTIONS RESTORED) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "PRODUCT: Unknown.";
  
  // UPDATE: Reading from 'forecast_stage'
  const category = deal?.forecast_stage || "Pipeline";
  
  const isPipeline = ["Pipeline", "Discovery", "Qualification", "Prospecting"].includes(category);
  const isBestCase = ["Best Case", "Upside", "Solution Validation"].includes(category);
  const isCommit = ["Commit", "Closing", "Negotiation"].includes(category);
  const isNewDeal = deal.initial_score == null;

  // Forecast Rules
  let instructions = "";
  let bannedTopics = "None.";
  
  if (isPipeline) {
     instructions = `
     **MODE: PIPELINE (The Skeptic)**
     - **STRICT CEILING:** This deal CANNOT score > 15.
     - **FOCUS:** Pain, Metrics, Champion.
     - **AUTO-FAIL:** If they don't know the Pain, score is 0.
     - **IGNORED SCORES:** Paper Process and Decision Process are ALWAYS 0/3.`;
     bannedTopics = "Do NOT ask about: Legal, Procurement, Signatures, Redlines, Close Date specifics.";
  } else if (isBestCase) {
     instructions = `
     **MODE: BEST CASE (The Gap Hunter)**
     - **GOAL:** Find the missing link preventing Commit.
     - **LOGIC:** Look at [HISTORY]. If a category is '3', DO NOT ASK about it. Attack the '1s'.`;
  } else {
     const scoreConcern = (deal.current_score && deal.current_score < 22) 
        ? "WARNING: Deal is in COMMIT but score is <22. Challenge confidence." 
        : "";
     instructions = `
     **MODE: COMMIT (The Closer)**
     - **GOAL:** Protect the forecast.
     - **FOCUS:** Paper Process, Timeline, Signatures.
     - **SPECIAL RULE:** ${scoreConcern}`;
  }

  const goalInstruction = isNewDeal ? `**GOAL:** New Deal Audit.` : "**GOAL:** Gap Review (Check History).";
  const historyContext = !isNewDeal ? `PREVIOUS SCORE: ${deal.current_score}/27. SUMMARY: "${deal.last_summary}".` : "NO HISTORY.";

  return `You are "Matthew," a VP of Sales Auditor. You are cynical, direct, and data-driven.
  ${goalInstruction}

  ### DEAL CONTEXT
  - Prospect: ${deal?.account_name}
  - Forecast Stage: ${category}
  - Value: $${deal?.amount} (Avg: $${avgSize})
  - Age: ${ageInDays} days (Close in: ${daysToClose} days)
  - **HISTORY:** ${historyContext}

  ### PRODUCT CONTEXT
  ${productContext}

  ### AUDIT INSTRUCTIONS
  ${instructions}

  ### RULES OF ENGAGEMENT
  1. **NO SUMMARIES:** Do not summarize. Just ask the next question.
  2. **INVISIBLE MATH:** Calculate scores silently. Never speak them.
  3. **PRODUCT POLICE:** Correct users if they lie about product features.
  4. **NON-ANSWERS:** If user is vague, treat it as RISK (Score 1).
  5. **BANNED TOPICS:** ${bannedTopics}
  6. **NO COACHING:** Never ask for feedback.
  7. **DATA EXTRACTION:** Extract Full Names and Job Titles.

  ### CHAMPION DEFINITIONS (CRITICAL)
  - **1 (Coach):** Friendly, no power.
  - **2 (Mobilizer):** Has influence, hasn't acted.
  - **3 (Champion):** Power AND is selling for us.

  ### SCORING RUBRIC (0-3)
  - **0 = Missing**
  - **1 = Unknown/Assumed** (High Risk)
  - **2 = Gathering**
  - **3 = Validated**

  ### RETURN ONLY JSON
  { "next_question": "Your short question.", "end_of_call": false }
  
  OR IF AUDIT COMPLETE:
  {
    "end_of_call": true,
    "next_question": "Verdict: [Score]/27. [Reason].",
    "final_report": {
        "score": [0-27],
        "new_forecast_category": "No Change" | "Pipeline" | "Best Case" | "Commit",
        "summary": "Brief summary.",
        "next_steps": "Action item.",
        "audit_details": {
            "metrics_score": 0-3, "economic_buyer_score": 0-3, "decision_criteria_score": 0-3,
            "decision_process_score": 0-3, "paper_process_score": 0-3, "pain_score": 0-3,
            "champion_score": 0-3, "competition_score": 0-3, "timeline_score": 0-3,
            "champion_name": "Full Name", "champion_title": "Job Title",
            "economic_buyer_name": "Full Name", "economic_buyer_title": "Job Title",
            "competitor_name": "Company"
        }
    }
  }`;
}

//// --- 7. UI DASHBOARD ROUTE (Fixed) ---
app.get("/get-deal", async (req, res) => {
  const { oppId } = req.query;
  try {
    const result = await pool.query("SELECT * FROM opportunities WHERE id = $1", [oppId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    
    const deal = result.rows[0];
    res.json({
      account_name: deal.account_name,
      forecast_category: deal.forecast_stage, // The "Stage"
      amount: deal.amount,
      summary: deal.last_summary || deal.summary,
      next_steps: deal.next_steps, // <--- ADDED THIS LINE (Fixes the blank box)
      seller_product_rules: deal.seller_product_rules,
      audit_details: deal.audit_details || { metrics_score: 0, pain_score: 0 },
      close_date: deal.close_date,
      rep_name: deal.rep_name
    });
  } catch (err) { console.error("Dash Error:", err); res.status(500).send("DB Error"); }
});

// --- 8. HELPER: LIST ALL DEALS ---
app.get("/get-all-opps", async (req, res) => {
    try {
        const result = await pool.query("SELECT id, account_name FROM opportunities ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json([]); }
});

// --- 9. THE AGENT ROUTE (POST) ---
app.post("/agent", async (req, res) => {
  try {
    const currentOppId = parseInt(req.query.oppId || 4);
    const isTransition = req.query.transition === 'true';
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    if (!transcript) {
        console.log(`--- New Session: Opp ${currentOppId} ---`);
        await incrementRunCount(currentOppId);
    }

    const dbResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [currentOppId]);
    const deal = dbResult.rows[0];

    const now = new Date();
    const createdDate = new Date(deal.opp_created_date);
    const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30));
    const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
    const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));

    // A. GREETING
    if (!sessions[callSid]) {
        console.log(`[SERVER] Start: ${callSid}`);
        const firstName = (deal.rep_name || "Rep").split(' ')[0];
        // UPDATE: Reading 'forecast_stage'
        const category = deal.forecast_stage || "Pipeline";
        const isNewDeal = deal.initial_score == null;
        
        const countRes = await pool.query('SELECT COUNT(*) FROM opportunities WHERE id >= $1', [currentOppId]);
        const dealsLeft = countRes.rows[0].count;

        let openingQuestion = "";
        if (isNewDeal) {
            openingQuestion = "To start, what are we selling and what problem does it solve?";
        } else {
            let summary = deal.last_summary || "we identified risks";
            if (summary.length > 300) summary = summary.substring(0, 300) + "...";
            openingQuestion = `Last time: ${summary}. What is the update?`;
        }

        const finalGreeting = isTransition 
            ? `Next up: ${deal.account_name}. It's in ${category}. ${openingQuestion}`
            : `Hi ${firstName}, Matthew here. Reviewing ${dealsLeft} deals. Starting with ${deal.account_name} in ${category}. ${openingQuestion}`;

        sessions[callSid] = [{ role: "assistant", content: finalGreeting }];
        return res.send(`<Response><Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto">${speak(finalGreeting)}</Gather></Response>`);
    }

    // B. HANDLE INPUT
    let messages = sessions[callSid];
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    } else {
      return res.send(`<Response><Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto">${speak("I didn't hear you. Say that again?")}</Gather></Response>`);
    }

    // C. AI CALL
    try {
        const response = await axios.post(
          "https://api.anthropic.com/v1/messages",
          {
            model: "claude-3-haiku-20240307",
            max_tokens: 800,
            temperature: 0,
            system: agentSystemPrompt(deal, ageInDays, daysToClose),
            messages: messages
          },
          { headers: { "x-api-key": process.env.MODEL_API_KEY.trim(), "anthropic-version": "2023-06-01" }, timeout: 12000 }
        );

        let rawText = response.data.content[0].text.trim().replace(/```json/g, "").replace(/```/g, "");
        let agentResult = { next_question: "", end_of_call: false };
        
        try {
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            if (jsonStart !== -1) {
                agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
            } else {
                agentResult.next_question = rawText;
            }
        } catch (e) { agentResult.next_question = rawText; }

        messages.push({ role: "assistant", content: rawText });
        sessions[callSid] = messages;
        
        console.log(`\n--- TURN ${messages.length} ---`);
        console.log("🗣️ USER:", transcript);
        console.log("🧠 MATTHEW:", agentResult.next_question);

        // E. OUTPUT & TRANSITION
        if (agentResult.end_of_call) {
            if (agentResult.final_report) {
                console.log("📊 Saving Report...");
                await saveCallResults(currentOppId, agentResult.final_report);
            }

            const nextDeal = await pool.query('SELECT id FROM opportunities WHERE id > $1 ORDER BY id ASC LIMIT 1', [currentOppId]);
            if (nextDeal.rows.length > 0) {
                 delete sessions[callSid]; 
                 return res.send(`<Response>${speak(agentResult.next_question + " Moving to next deal.")}<Redirect method="POST">/agent?oppId=${nextDeal.rows[0].id}&amp;transition=true</Redirect></Response>`);
            } else {
                 return res.send(`<Response>${speak(agentResult.next_question + " That was the last deal. Goodbye.")}<Hangup/></Response>`);
            }
        } else {
            return res.send(`<Response><Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto">${speak(agentResult.next_question)}</Gather></Response>`);
        }

    } catch (apiError) {
        console.error("LLM Error:", apiError.message);
        return res.send(`<Response><Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto">${speak("I'm calculating metrics. What's the timeline?")}</Gather></Response>`);
    }

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    res.type('text/xml').send(`<Response><Say>System error.</Say><Hangup/></Response>`);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Audit Server live on port ${PORT}`));