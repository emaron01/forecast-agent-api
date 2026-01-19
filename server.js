require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();

// --- DATABASE CONNECTION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com") 
       ? { rejectUnauthorized: false } 
       : false
});

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// --- DATABASE UTILITIES ---
async function incrementRunCount(oppId) {
    try {
        await pool.query(`UPDATE opportunities SET run_count = run_count + 1, last_agent_run = CURRENT_TIMESTAMP WHERE id = $1`, [oppId]);
        console.log(`✅ Run count incremented for Opp ID: ${oppId}`);
    } catch (err) {
        console.error("❌ Database Update Error:", err);
    }
}

// --- ANALYTICS ENGINE ---
async function saveCallResults(oppId, report) {
    try {
        const { score, summary, next_steps } = report;
        const query = `
            UPDATE opportunities 
            SET 
                current_score = $1,
                initial_score = COALESCE(initial_score, $1), 
                last_summary = $2,
                next_steps = $3
            WHERE id = $4
        `;
        await pool.query(query, [score, summary, next_steps, oppId]);
        console.log(`💾 Analytics Saved for Deal ${oppId}: Score ${score}/27`);
    } catch (err) {
        console.error("❌ Failed to save analytics:", err);
    }
}

// --- HELPER: SPEAK ---
const speak = (text) => {
    if (!text) return "";
    // Aggressive cleanup: Removes numbered lists, bullets, and markdown to prevent "Robot Voice"
    const safeText = text.replace(/&/g, "and")
                         .replace(/</g, "")
                         .replace(/>/g, "")
                         .replace(/\*\*/g, "") 
                         .replace(/^\s*[-*]\s+/gm, "") 
                         .replace(/\d+\)\s/g, "") 
                         .replace(/\d+\.\s/g, ""); 
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${safeText}</prosody></Say>`;
};

// --- 3. SYSTEM PROMPT (THE COMPLETE BRAIN) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";
  
  // HISTORY LOGIC
  const isNewDeal = deal.initial_score == null;
  const historyContext = !isNewDeal 
    ? `PREVIOUS SCORE: ${deal.current_score}/27. GAPS: "${deal.last_summary}". PENDING: "${deal.next_steps}".`
    : "NO HISTORY. Fresh qualification.";

  // MODE SWITCHING
  const goalInstruction = isNewDeal
    ? "**GOAL:** NEW DEAL. Audit all 9 points."
    : "**GOAL:** GAP REVIEW. Focus ONLY on risks from History. Assume other areas are valid.";

  let timeContext = "Timeline is healthy.";
  if (daysToClose < 0) timeContext = "WARNING: Deal is past due date in CRM.";
  else if (daysToClose < 30) timeContext = "CRITICAL: CRM says deal closes in less than 30 days.";

  return `You are "Matthew," a VP of Sales at Sales Forecaster.
**JOB:** Qualify the deal using MEDDPICC.
${goalInstruction}

### INTERNAL TRUTHS
${productContext}

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days
- CRM Close Date: ${daysToClose} days from now (${timeContext})
- **HISTORY:** ${historyContext}

### RULES OF ENGAGEMENT (STRICT)
1. **RECAP STRATEGY (PAIN ONLY):** - **IF** user just explained Pain/Solution: Summarize it briefly (e.g. "So they lose $500k. Got it.").
   - **ALL OTHER QUESTIONS:** Do NOT summarize. Just ask the next question immediately.
2. **NO LISTS:** Do NOT use numbered lists. Speak in full, conversational sentences.
3. **GAP REPORTER:** Only summarize if there is a **GAP** (Missing info). 
4. **SKEPTICISM:** If they give a vague answer (e.g., "The CIO"), CHALLENGE IT. "Have you met them? Do they know the price?"
5. **IDENTITY:** Use "our solution." You are on the same team.
6. **STALLING:** If user says "um", "uh", or pauses, say: "Take your time. Do you actually have visibility into this?"
7. **PRODUCT POLICE:** Check [INTERNAL TRUTHS]. If they claim a feature we don't have, correct them immediately.
8. **THE "WHY" RULE:** If they don't know an answer, explain the RISK before moving on (e.g., "That is a risk because...").
9. **ONE QUESTION RULE:** Ask for one missing piece of evidence at a time.

### SCORING RUBRIC (0-3 Scale)
- **0 = Missing** (No info)
- **1 = Unknown / Assumed** (High Risk)
- **2 = Gathering / Incomplete** (Needs work)
- **3 = Validated / Complete** (Solid evidence)

### CHAMPION DEFINITIONS
- **1 (Coach):** Friendly, no power.
- **2 (Mobilizer):** Influence, hasn't acted.
- **3 (Champion):** Actively sells for us.

### AUDIT CHECKLIST (MEDDPICC - 9 Points)
1. **PAIN & SOLUTION:** Cost of Inaction?
2. **METRICS:** ROI?
3. **CHAMPION:** Who sells for us? (Score using Champion Definitions).
4. **ECONOMIC BUYER:** Who signs? (Access/Awareness).
5. **DECISION CRITERIA:** Requirements?
6. **DECISION PROCESS:** Steps?
7. **COMPETITION:** Who are we up against?
8. **TIMELINE:** Work backwards from Close Date.
9. **PAPER PROCESS:** Legal/Procurement?

### PHASE 2: THE VERDICT
- **TRIGGER:** Only after Gaps are checked.
- **OUTPUT:** You MUST return a "final_report" object.
- **SCORING:** Calculate SUM of the 9 categories (0-3 scale, Max 27).
- **SUMMARY:** 1 sentence explaining the score.
- **NEXT STEPS:** The 1 most critical action item.

### RETURN ONLY JSON
{ 
  "next_question": "Your short response here.", 
  "end_of_call": false 
}
OR (If finished):
{
  "end_of_call": true,
  "next_question": "Understood. Given those gaps, here is my verdict: I scored this deal a 18 out of 27. I deducted points because we lack a verified Economic Buyer. Moving to next deal...",
  "final_report": {
      "score": 18, 
      "summary": "Deal has strong technical fit but is risky due to unverified Economic Buyer.",
      "next_steps": "Validate budget with CIO."
  }
}

**FORMATTING:** Output ONLY valid JSON. No conversational filler outside the JSON block.`;
}

// --- 4. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  try {
    const currentOppId = parseInt(req.query.oppId || 4); 
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    if (!transcript) {
        console.log(`--- New Audit Session: Opp ID ${currentOppId} ---`);
        await incrementRunCount(currentOppId);
    }

    const dbResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [currentOppId]);
    const deal = dbResult.rows[0];

    const now = new Date();
    const createdDate = new Date(deal.opp_created_date);
    const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30)); 
    const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
    const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));

    // A. INSTANT GREETING (CONTEXT FIRST)
    if (!sessions[callSid]) {
        console.log(`[SERVER] New Session: ${callSid}`);
        const fullName = deal.rep_name || "Sales Rep";
        const firstName = fullName.split(' ')[0];
        const account = deal.account_name || "Unknown Account";
        const oppName = deal.opportunity_name || "the deal";
        const stage = deal.deal_stage || "Open";
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed revenue";
        const dateOptions = { month: 'long', day: 'numeric', year: 'numeric' };
        const closeDateSpeech = closeDate.toLocaleDateString('en-US', dateOptions);

        const isNewDeal = deal.initial_score == null;
        let openingQuestion = "";

        if (isNewDeal) {
            // Scenario 1: New Deal
            openingQuestion = "This is our first review for this deal. To start, what is the specific solution we are selling, and what problem does it solve?";
        } else {
            // Scenario 2: Gap Review (Context First)
            const summary = deal.last_summary || "we identified some risks";
            const lastStep = deal.next_steps || "advance the deal";
            openingQuestion = `Last time, we noted: ${summary}. The pending action was to ${lastStep}. What is the latest update on that?`;
        }

        const finalGreeting = `Hi ${firstName}, this is Matthew from Sales Forecaster. Let's look at ${account}, ${oppName}, in ${stage} for ${amountSpeech}, closing ${closeDateSpeech}. ${openingQuestion}`;

        sessions[callSid] = [{ role: "assistant", content: finalGreeting }];
        
        return res.send(`
            <Response>
                <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false">
                    ${speak(finalGreeting)}
                </Gather>
            </Response>
        `);
    }

    // B. HANDLE INPUT
    let messages = sessions[callSid];
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    } else {
      return res.send(`
        <Response>
          <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false">
             ${speak("I was listening, but didn't catch that. Could you say it again?")}
          </Gather>
        </Response>
      `);
    }

    // C. AI CALL
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-haiku-20240307", 
        max_tokens: 1024, 
        temperature: 0,
        system: agentSystemPrompt(deal, ageInDays, daysToClose), 
        messages: messages
      },
      { headers: { "x-api-key": process.env.MODEL_API_KEY.trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" } }
    );

    // D. PARSE RESPONSE (ROBUST JSON EXTRACTION)
    let rawText = response.data.content[0].text.trim();
    let agentResult = { next_question: "", end_of_call: false };
    
    // 1. Clean Markdown
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

    // 2. Extract JSON Object only (ignoring conversational preamble)
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonString = rawText.substring(jsonStart, jsonEnd + 1);
        try {
            agentResult = JSON.parse(jsonString);
        } catch (e) {
            console.error("⚠️ JSON PARSE CRITICAL FAIL. Using Fallback regex.");
            // Fallback Regex
            const questionMatch = rawText.match(/"next_question"\s*:\s*"([^"]*)"/);
            if (questionMatch) agentResult.next_question = questionMatch[1];
            else agentResult.next_question = "I didn't quite catch that context. Could you clarify?";
        }
    } else {
        // If no JSON found at all, treat raw text as the question
        console.error("⚠️ NO JSON FOUND. Using raw text.");
        agentResult.next_question = rawText; 
    }

    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;
    
    console.log(`\n--- TURN ${messages.length} ---`);
    console.log("🗣️ USER:", transcript);
    console.log("🧠 MATTHEW:", agentResult.next_question);

    // E. OUTPUT & REDIRECT
    if (agentResult.end_of_call) {
        let finalSpeech = agentResult.next_question;
        
        if (agentResult.final_report) {
            console.log("📊 Saving Final Report...", agentResult.final_report);
            await saveCallResults(currentOppId, agentResult.final_report);
        }

        const nextDealResult = await pool.query('SELECT id, account_name FROM opportunities WHERE id > $1 ORDER BY id ASC LIMIT 1', [currentOppId]);
        
        if (nextDealResult.rows.length > 0) {
             const nextOpp = nextDealResult.rows[0];
             const transitionSpeech = `${finalSpeech} Moving on to the next deal: ${nextOpp.account_name}. Stand by.`;
             delete sessions[callSid]; 
             return res.send(`
                <Response>
                    ${speak(transitionSpeech)}
                    <Redirect method="POST">/agent?oppId=${nextOpp.id}</Redirect>
                </Response>
             `);
        } else {
             // FALLBACK
             finalSpeech += " That was the last deal in your forecast. Good luck.";
             return res.send(`<Response>${speak(finalSpeech)}<Hangup/></Response>`);
        }
    } else {
        return res.send(`
            <Response>
                <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false">
                    ${speak(agentResult.next_question)}
                </Gather>
            </Response>
        `);
    }

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    res.type('text/xml').send(`<Response><Say>System error.</Say><Hangup/></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));