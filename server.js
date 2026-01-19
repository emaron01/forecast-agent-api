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

// --- HELPER: SPEAK ---
const speak = (text) => {
    if (!text) return "";
    const safeText = text.replace(/&/g, "and").replace(/</g, "").replace(/>/g, "");
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${safeText}</prosody></Say>`;
};

// --- 3. SYSTEM PROMPT (STRICT MEDDPICC FLOW) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";
  
  // Urgency Context
  let timeContext = "Timeline is healthy.";
  if (daysToClose < 0) timeContext = "WARNING: Deal is past due date in CRM.";
  else if (daysToClose < 30) timeContext = "CRITICAL: CRM says deal closes in less than 30 days.";

  return `You are "Matthew," a VP of Sales and Strategic Coach for ${deal?.seller_website || "our company"}. 

### YOUR GOAL
Validate the forecast using a strict methodology.
1. **Audit:** Find the gaps.
2. **Educate:** If a rep misses a step, explain *why* it is a risk.

### INTERNAL TRUTHS (PRODUCT KNOWLEDGE)
${productContext}

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days
- CRM Close Date (PO Date): ${daysToClose} days from now (${timeContext})

### RULES OF ENGAGEMENT
1. **INVISIBLE STRUCTURE:** Do NOT announce the category names (e.g., "Now let's move to Metrics"). Just ask the natural next question.
2. **THE GAP TRAP (TIMELINE):** If the Close Date is NOW, but the Project Date is LATER (e.g., Next Year), be skeptical. Ask: "Why spend the money now if they don't need it until next year?"
3. **ONE QUESTION RULE:** Ask for one missing piece of evidence at a time.
4. **THE "WHY" RULE:** If the user admits they don't know something, explain the risk.
5. **STALLING:** If user says "um", "uh", or pauses: "Take your time. Do you actually have visibility into this?"
6. **PRODUCT POLICE:** If they claim a fake feature, correct them.

### THE AUDIT CHECKLIST (Follow this exact order)
1. **PAIN & SOLUTION:** What exactly are we selling them, and what specific problem does it solve? Why are they buying NOW? (Cost of Inaction).
2. **METRICS:** ROI / Business Case?
3. **CHAMPION:** Who is selling for us when we aren't there? (Score 1-3).
4. **ECONOMIC BUYER:** Who owns the budget and signs the deal?
5. **DECISION PROCESS:** What are the specific steps to win?
6. **COMPETITION:** Who are we up against?
7. **TIMELINE:** Work backwards from the Close Date vs. Project Date. (Check for Gap Trap).
8. **PAPER PROCESS:** Procurement and Legal steps?

### PHASE 2: THE VERDICT
- **TRIGGER:** Only after Paper Process is discussed.
- **OUTPUT:** Give a summary score and the #1 Key Risk.
- Set "end_of_call": true.

### RETURN ONLY JSON
{ "next_question": "Your response here.", "end_of_call": false }

**FORMATTING:** Output valid, single-line JSON only. Do NOT use newlines or bullet points inside the JSON.`;
}

// --- 4. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  try {
    const oppId = req.query.oppId || 4; 
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    if (!transcript) {
        console.log(`--- New Audit Session: Opp ID ${oppId} ---`);
        await incrementRunCount(oppId);
    }

    // --- 5. DATA RETRIEVAL ---
    const dbResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
    const deal = dbResult.rows[0];
    
    // Calculate Dates
    const now = new Date();
    const createdDate = new Date(deal.opp_created_date);
    // Default Close Date Logic
    const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30)); 
    
    const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
    const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));

   // A. INSTANT GREETING (AUDIT MODE)
    if (!sessions[callSid]) {
        console.log(`[SERVER] New Session: ${callSid} for Opp ID: ${oppId}`);

        const repName = deal.rep_name || "Sales Rep";
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed value";

        // Dynamic Urgency Intro
        let urgency = "";
        if (daysToClose < 0) urgency = `We are past the close date.`;
        else if (daysToClose < 30) urgency = `We have ${daysToClose} days left to close.`;
        else urgency = `We are targeting a close in ${daysToClose} days.`;

        const finalGreeting = `Hi ${repName}, this is Matthew from Forecast. Let's validate the ${deal?.account_name} deal for ${amountSpeech}. ${urgency} To start, what is the specific solution we are selling, and what problem does it solve for them?`;

        sessions[callSid] = [{ role: "assistant", content: finalGreeting }];
        
        return res.send(`
            <Response>
                <Gather input="speech" action="/agent?oppId=${oppId}" method="POST" speechTimeout="1.0" enhanced="false">
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
          <Gather input="speech" action="/agent?oppId=${oppId}" method="POST" speechTimeout="1.0" enhanced="false">
             ${speak("I didn't catch that. Could you say it again?")}
          </Gather>
        </Response>
      `);
    }

    // C. SAFETY SWITCH
    if (messages.length >= 30 && !messages.some(m => m.content.includes("Out of time"))) {
       messages.push({ role: "user", content: "Out of time. Give me the verbal summary and score, then say Goodbye." });
    }

    // D. CALL ANTHROPIC API
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

    // E. ROBUST PARSE RESPONSE
    let rawText = response.data.content[0].text.trim();
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let agentResult = { next_question: "", end_of_call: false };
    
    try {
        agentResult = JSON.parse(rawText);
    } catch (e) {
        console.error("⚠️ JSON PARSE FAILED. Attempting Regex Fallback...");
        const questionMatch = rawText.match(/"next_question"\s*:\s*"([^"]*)"/);
        const endMatch = rawText.match(/"end_of_call"\s*:\s*(true|false)/);
        
        if (questionMatch) {
            agentResult.next_question = questionMatch[1];
        } else {
            agentResult.next_question = rawText; 
        }

        if (endMatch) {
            agentResult.end_of_call = endMatch[1] === "true";
        }
    }

    // F. SAVE HISTORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;
    
    console.log(`\n--- TURN ${messages.length} ---`);
    console.log("🗣️ USER:", transcript);
    console.log("🧠 MATTHEW:", agentResult.next_question);

    // --- G. GENERATE RESPONSE ---
    let twimlResponse = "";
    if (agentResult.end_of_call) {
        let finalSpeech = agentResult.next_question;
        if ((!finalSpeech || finalSpeech.length < 10) && agentResult.final_report?.summary) {
           finalSpeech = `Review complete. ${agentResult.final_report.summary}`;
        }
        twimlResponse = `<Response>${speak(finalSpeech)}<Hangup/></Response>`;
    } else {
        twimlResponse = `<Response><Gather input="speech" action="/agent?oppId=${oppId}" method="POST" speechTimeout="1.0" enhanced="false">${speak(agentResult.next_question)}</Gather></Response>`;
    }

    res.type('text/xml');
    res.send(twimlResponse);

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    res.type('text/xml').send(`<Response><Say>System error.</Say><Hangup/></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));