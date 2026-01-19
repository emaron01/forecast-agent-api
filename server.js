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
        
        // LOGIC: 
        // 1. Always update 'current_score' (The latest health).
        // 2. Only update 'initial_score' if it is currently NULL (The baseline).
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
        console.log(`💾 Analytics Saved for Deal ${oppId}: Score ${score}/100`);
    } catch (err) {
        console.error("❌ Failed to save analytics:", err);
    }
}

// --- HELPER: SPEAK ---
const speak = (text) => {
    if (!text) return "";
    const safeText = text.replace(/&/g, "and").replace(/</g, "").replace(/>/g, "");
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${safeText}</prosody></Say>`;
};

// --- 3. SYSTEM PROMPT (THE SKEPTICAL ANALYST) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";
  
  let timeContext = "Timeline is healthy.";
  if (daysToClose < 0) timeContext = "WARNING: Deal is past due date in CRM.";
  else if (daysToClose < 30) timeContext = "CRITICAL: CRM says deal closes in less than 30 days.";

  return `You are "Matthew," a VP of Sales. 
**JOB:** Qualify the deal HARD. Do not accept surface-level answers.
**GOAL:** Do NOT move to the next checklist item until the current one is FULLY VALIDATED.

### INTERNAL TRUTHS (PRODUCT KNOWLEDGE)
${productContext}

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days
- CRM Close Date (PO Date): ${daysToClose} days from now (${timeContext})

### RULES OF ENGAGEMENT
1. **NO INTERRUPTIONS:** Listen fully. 
2. **SKEPTICISM (MANDATORY):**
   - **CHAMPION:** If they give a Name/Title, ASK: "Have you tested them? Do they have a personal win in this?"
   - **ECONOMIC BUYER:** If they say "The CIO," ASK: "Have we met the CIO? Do they know the price?"
3. **ONE QUESTION RULE:** Ask for one missing piece of evidence at a time.
4. **THE "WHY" RULE:** If the user admits they don't know something, explain the risk.

### THE AUDIT CHECKLIST (STRICT ORDER)
1. **PAIN & SOLUTION:** What broken process are we fixing, and what is the Cost of Inaction?
2. **METRICS:** ROI / Business Case?
3. **CHAMPION:** Who sells for us? (MUST VALIDATE: Access? Influence? Tested?)
4. **ECONOMIC BUYER:** Who signs? (MUST VALIDATE: Met them? Aware of price?)
5. **DECISION PROCESS:** Steps to win?
6. **COMPETITION:** Who are we up against?
7. **TIMELINE:** Work backwards from the Close Date.
8. **PAPER PROCESS:** Legal/Procurement steps?

### PHASE 2: THE VERDICT (FINAL REPORT)
- **TRIGGER:** Only after Paper Process is discussed.
- **OUTPUT:** You MUST return a "final_report" object inside the JSON.
- **SCORING:** 0-100 Health Score (0=Dead, 100=Signed).
- **SUMMARY:** 2 sentences on the state of the deal.
- **NEXT STEPS:** The 1 most critical action item.

### RETURN ONLY JSON
{ 
  "next_question": "Your response here.", 
  "end_of_call": false 
}
OR (If finished):
{
  "end_of_call": true,
  "next_question": "Great job. I've updated the forecast. Moving to next deal...",
  "final_report": {
      "score": 75,
      "summary": "Deal is strong technically but lacks Economic Buyer access.",
      "next_steps": "Schedule meeting with CIO to confirm budget."
  }
}

**FORMATTING:** Output valid, single-line JSON only.`;
}

// --- 4. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  try {
    // 1. Get Setup
    const currentOppId = parseInt(req.query.oppId || 4); 
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    if (!transcript) {
        console.log(`--- New Audit Session: Opp ID ${currentOppId} ---`);
        await incrementRunCount(currentOppId);
    }

    // 2. Fetch Deal Data
    const dbResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [currentOppId]);
    const deal = dbResult.rows[0];

    // Dates
    const now = new Date();
    const createdDate = new Date(deal.opp_created_date);
    const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30)); 
    const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
    const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));

    // A. INSTANT GREETING (PERSONALIZED)
    if (!sessions[callSid]) {
        console.log(`[SERVER] New Session: ${callSid}`);
        
        // PULL REP NAME FROM DB
        const repName = deal.rep_name || "Sales Rep"; 
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed value";
        
        const finalGreeting = `Hi ${repName}, this is Matthew. Let's forecast the ${deal?.account_name} deal for ${amountSpeech}. To start, what is the specific solution we are selling, and what problem does it solve?`;

        sessions[callSid] = [{ role: "assistant", content: finalGreeting }];
        
        // 2.5s Timeout for "Human-like" listening
        return res.send(`
            <Response>
                <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false">
                    ${speak(finalGreeting)}
                </Gather>
            </Response>
        `);
    }

    // B. HANDLE USER INPUT
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

    // C. CALL AI
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
    let rawText = response.data.content[0].text.trim().replace(/```json/g, "").replace(/```/g, "").trim();
    let agentResult = { next_question: "", end_of_call: false };
    
    try {
        agentResult = JSON.parse(rawText);
    } catch (e) {
        console.error("⚠️ JSON PARSE FAILED. Fallback...");
        const questionMatch = rawText.match(/"next_question"\s*:\s*"([^"]*)"/);
        const endMatch = rawText.match(/"end_of_call"\s*:\s*(true|false)/);
        if (questionMatch) agentResult.next_question = questionMatch[1];
        else agentResult.next_question = rawText; 
        if (endMatch) agentResult.end_of_call = endMatch[1] === "true";
    }

    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;
    
    console.log(`\n--- TURN ${messages.length} ---`);
    console.log("🗣️ USER:", transcript);
    console.log("🧠 MATTHEW:", agentResult.next_question);

    // --- E. END OF CALL & SAVE ANALYTICS ---
    if (agentResult.end_of_call) {
        let finalSpeech = agentResult.next_question;
        
        // 1. SAVE THE DATA
        if (agentResult.final_report) {
            console.log("📊 Saving Final Report...", agentResult.final_report);
            await saveCallResults(currentOppId, agentResult.final_report);
        }

        // 2. FIND NEXT DEAL
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