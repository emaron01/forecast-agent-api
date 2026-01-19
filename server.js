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

// --- ANALYTICS ENGINE (PARANOIA PROOF) ---
async function saveCallResults(oppId, report) {
    try {
        // NULL SAFETY: Default to null/text if AI forgets a field to prevent crash
        const score = report.score !== undefined ? report.score : null;
        const summary = report.summary || "No summary provided.";
        const next_steps = report.next_steps || "Review deal manually.";
        const audit_details = report.audit_details || null;
        
        const query = `
            UPDATE opportunities 
            SET 
                current_score = $1,
                initial_score = COALESCE(initial_score, $1), 
                last_summary = $2,
                next_steps = $3,
                audit_details = $4
            WHERE id = $5
        `;
        await pool.query(query, [score, summary, next_steps, audit_details, oppId]);
        console.log(`💾 Analytics Saved for Deal ${oppId}: Score ${score}/27`);
    } catch (err) {
        console.error("❌ Failed to save analytics:", err);
    }
}

// --- HELPER: SPEAK (Safety Edition) ---
const speak = (text) => {
    if (!text) return "";
    
    // 1. Clean Markdown & Lists
    let safeText = text.replace(/&/g, "and")
                         .replace(/</g, "")
                         .replace(/>/g, "")
                         .replace(/\*\*/g, "") 
                         .replace(/^\s*[-*]\s+/gm, "") 
                         .replace(/\d+\)\s/g, "") 
                         .replace(/\d+\.\s/g, "");
    
    // 2. SAFETY TRUNCATION (Global Emergency Brake)
    // Limits total audio to ~50 seconds to prevent Twilio timeout.
    if (safeText.length > 800) {
        console.log("⚠️ Truncating long response for audio safety.");
        safeText = safeText.substring(0, 800) + "...";
    }
    
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${safeText}</prosody></Say>`;
};

// --- 3. SYSTEM PROMPT (SILENT SCORER & DATA MINER) ---
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
1. **INVISIBLE SCORING (CRITICAL):** Do NOT speak the score of a category during the conversation. Keep the math internal. Only announce the Total Score at the very end.
2. **CONNECT THE DOTS:** If user mentions a fact that answers a future question, mark it as VALIDATED silently.
3. **GAP MODE BEHAVIOR:** If this is a GAP REVIEW, do **NOT** ask about Pain/Metrics/Champion unless they are specifically listed in **HISTORY** as Gaps.
4. **NON-ANSWERS:** If user says "Okay", "Sure", or "I don't know" to an update question, **RE-ASK IT**. Do not move on until you get the update.
5. **RECAP STRATEGY:** Summarize Pain briefly for empathy. Do NOT summarize anything else.
6. **NO LISTS:** Do NOT use numbered lists. Speak in full, conversational sentences.
7. **SKEPTICISM:** If they give a vague answer, CHALLENGE IT.
8. **IDENTITY:** Use "our solution." You are on the same team.

### SCORING RUBRIC (0-3 Scale)
- **0 = Missing** (No info)
- **1 = Unknown / Assumed** (High Risk)
- **2 = Gathering / Incomplete** (Needs work)
- **3 = Validated / Complete** (Solid evidence)

### AUDIT CHECKLIST (MEDDPICC - 9 Points)
1. **PAIN & SOLUTION:** Cost of Inaction?
2. **METRICS:** ROI?
3. **CHAMPION:** Who sells for us? (Evidence: Did they get us access to power?)
4. **ECONOMIC BUYER:** Who signs? (Evidence: Have we met them?)
5. **DECISION CRITERIA:** Requirements?
6. **DECISION PROCESS:** Steps?
7. **COMPETITION:** Who are we up against?
8. **TIMELINE:** Work backwards from Close Date.
9. **PAPER PROCESS:** Legal/Procurement?

### PHASE 2: THE VERDICT
- **TRIGGER:** Only after Gaps are checked.
- **OUTPUT:** You MUST return a "final_report" object.
- **SCORING:** Calculate SUM of the 9 categories (0-3 scale, Max 27).
- **DETAILS:** Extract specific names (Champion, EB) and score each category individually in the JSON.

### RETURN ONLY JSON
{ 
  "next_question": "Your short response here.", 
  "end_of_call": false 
}
OR (If finished):
{
  "end_of_call": true,
  "next_question": "Understood. Given those gaps, here is my verdict: I scored this deal a 24 out of 27. The only risk is Paper Process. Moving to next deal...",
  "final_report": {
      "score": 24, 
      "summary": "Strong deal with verified Champion and Economic Buyer, but Paper Process is unknown.",
      "next_steps": "Send contract to legal.",
      "audit_details": {
          "champion_name": "Bob Smith",
          "economic_buyer_name": "Susan (CIO)",
          "pain_score": 3,
          "metrics_score": 3,
          "champion_score": 3,
          "economic_buyer_score": 3,
          "decision_criteria_score": 2,
          "decision_process_score": 2,
          "competition_score": 3,
          "timeline_score": 3,
          "paper_process_score": 0
      }
  }
}

**FORMATTING:** Output ONLY valid JSON. No conversational filler.`;
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

    // A. INSTANT GREETING (SMART TRUNCATION)
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
            openingQuestion = "This is our first review for this deal. To start, what is the specific solution we are selling, and what problem does it solve?";
        } else {
            // 1. Get Summary
            let summary = deal.last_summary || "we identified some risks";
            
            // 2. Chop Summary ONLY (Leaving 400 chars is plenty context)
            if (summary.length > 400) {
                summary = summary.substring(0, 400) + "...";
            }
            
            const lastStep = deal.next_steps || "advance the deal";
            
            // 3. Attach Question (Guaranteed safe)
            openingQuestion = `Last time we noted: ${summary}. The pending action was to ${lastStep}. What is the latest update on that?`;
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

    // D. PARSE RESPONSE
    let rawText = response.data.content[0].text.trim();
    let agentResult = { next_question: "", end_of_call: false };
    
    // Clean and Extract JSON
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonString = rawText.substring(jsonStart, jsonEnd + 1);
        try {
            agentResult = JSON.parse(jsonString);
        } catch (e) {
            console.error("⚠️ JSON PARSE FAIL. Using Fallback.");
            const questionMatch = rawText.match(/"next_question"\s*:\s*"([^"]*)"/);
            if (questionMatch) agentResult.next_question = questionMatch[1];
            else agentResult.next_question = "I didn't quite catch that. Could you clarify?";
        }
    } else {
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