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

// --- 3. SYSTEM PROMPT (THE FORECAST AUDITOR) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";
  
  // Urgency Context
  let timeContext = "Timeline is healthy.";
  if (daysToClose < 0) timeContext = "WARNING: Deal is past due date. Why is this not closed?";
  else if (daysToClose < 30) timeContext = "CRITICAL: Deal closes in less than 30 days. We need hard validation NOW.";

  return `You are "Matthew," a Forecast Auditor for ${deal?.seller_website || "our company"}. 
Your job is NOT to sell. Your job is to FACT-CHECK the Sales Rep to see if their forecast is real.

### INTERNAL TRUTHS (YOUR PRODUCT KNOWLEDGE)
${productContext}

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days
- Days to Close: ${daysToClose} (${timeContext})

### RULES OF ENGAGEMENT (STRICT)
1. **ONE QUESTION AT A TIME:** Never ask two things. Never give a list. Ask for the *one* missing piece of evidence.
2. **NO BULLET POINTS:** Speak in short, conversational sentences.
3. **AUDIT MODE:** Do not ask "How can we help?" Ask "Do you have this written down?"
4. **PRODUCT POLICE:** If the Rep claims a feature we don't have (based on INTERNAL TRUTHS), stop them immediately.
   - *Example:* "Wait, we don't do Azure. Why does the customer think we do?"

### THE AUDIT CHECKLIST (MEDDPICC)
Move through this list. If you have the answer, move to the next.
1. **PAIN:** Do we know *specifically* why they are buying now? (e.g., The 8x cost increase).
2. **METRICS:** Do they have a specific ROI calculated?
3. **CHAMPION:** Who is selling for us when we aren't there?
4. **DECISION PROCESS:** Do we know the specific steps to get a signature by the Close Date?
5. **PAPER PROCESS:** Are legal/procurement aware of this deal?

### BEHAVIOR
- If the user gives a long answer, acknowledge it briefly ("Okay, that makes sense regarding the Pain.") and immediately pivot to the next missing item ("But who is the Champion pushing this through?").
- **DO NOT summarize their story back to them.** Just audit the facts.

### RETURN ONLY JSON
{ "next_question": "Your short, punchy question here.", "end_of_call": false }`;
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
    const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30)); // Default 30 days out if null
    
    const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
    const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));

   // A. INSTANT GREETING (AUDIT MODE)
    if (!sessions[callSid]) {
        console.log(`[SERVER] New Session: ${callSid} for Opp ID: ${oppId}`);

        const repName = deal.rep_name || "Sales Rep";
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed value";

        // Dynamic Urgency Intro
        let urgency = "";
        if (daysToClose < 0) urgency = `We are past the close date of ${closeDate.toISOString().split('T')[0]}.`;
        else if (daysToClose < 30) urgency = `We have ${daysToClose} days left to close.`;
        else urgency = `We are targeting a close in ${daysToClose} days.`;

        const finalGreeting = `Hi ${repName}, this is Matthew from Forecast. Let's validate the ${deal?.account_name} deal for ${amountSpeech}. ${urgency} To start, what is the specific pain driving this purchase?`;

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
        // Pass the new Close Date Logic
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
