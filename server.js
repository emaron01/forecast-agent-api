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

// --- 3. SYSTEM PROMPT (NATURAL & CONVERSATIONAL) ---
function agentSystemPrompt(deal, ageInDays) {
  const avgCycle = deal?.seller_avg_cycle || 90;
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";

  return `You are "Matthew," the VP of Sales for ${deal?.seller_website || "our company"}.
  
### INTERNAL TRUTHS (DO NOT REFERENCE EXPLICITLY)
${productContext}

### STYLE & TONE RULES (CRITICAL)
1. **NO ROBOT TALK:** NEVER say "My knowledge base indicates" or "Our records show."
2. **BE NATURAL:** If the rep is wrong, just correct them casually.
   - *Bad:* "My knowledge base says we don't do Azure."
   - *Good:* "Wait, I thought we only supported AWS? When did we start doing Azure?"
   - *Bad:* "The minimum time is 4 hours."
   - *Good:* "That sounds fast. Usually, a migration like that takes us at least 4 hours."
3. **AUDIO SAFETY:** Write numbers as words ("four hours", "fifty thousand").

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days (Avg Cycle: ${avgCycle} days)

### PHASE 1: THE STRATEGY SESSION
- FLOW: Identify Pain -> Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition -> Timeline.
- **Goal:** Find the gaps so we can help them close.
- **Product Validation:** If they mention a metric or feature that conflicts with your INTERNAL TRUTHS, politely challenge it.
  - *Example:* "Hold on, I thought we deprecated that feature. How are we handling that?"
- **Champion Check:** If the Champion score is low, ask: "Who else is batting for us?"

### PHASE 2: THE SUMMARY
- If complete, give a encouraging summary.
- Set "end_of_call": true.

### RETURN ONLY JSON
{ "next_question": "Your natural response here...", "end_of_call": false }

**FORMATTING:** Do NOT use bullet points or real line breaks in the JSON. Use full sentences.`;
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
    const ageInDays = deal ? Math.floor((new Date() - new Date(deal.opp_created_date)) / (1000 * 60 * 60 * 24)) : 0;
    
   // A. INSTANT GREETING (PROFESSIONAL BROADCAST FLOW)
    if (!sessions[callSid]) {
        console.log(`[SERVER] New Session: ${callSid} for Opp ID: ${oppId}`);

        const repName = deal.rep_name || "Sales Rep";
        const benchmarkCycle = deal.seller_avg_cycle || 90; 
        const benchmarkSize = deal.seller_avg_deal_size || 10000;
        const isWhale = deal.amount > (benchmarkSize * 1.5);
        const isStuck = ageInDays > (benchmarkCycle * 1.2);
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed value";

        // 1. The Intro & Agenda
        const introPart = `Hi ${repName}, This is Matthew from Sales Forecast. We will jump right into our forecast.`;
        
        // 2. The Anchor (Account & Money)
        const contextPart = `Let's start with the ${deal?.account_name || "Unknown"} deal, an opportunity for ${amountSpeech}.`;

        // 3. The Launch
        let transition = "To kick things off,";
        if (isWhale) transition = "This is a key deal, so let's be thorough. To kick things off,";
        else if (isStuck) transition = "It's been open a while, so let's unblock it. To kick things off,";

        const finalGreeting = `${introPart} ${contextPart} ${transition} what is the main problem they are trying to solve?`;

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
        system: agentSystemPrompt(deal, ageInDays), 
        messages: messages
      },
      { headers: { "x-api-key": process.env.MODEL_API_KEY.trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" } }
    );

    // E. ROBUST PARSE RESPONSE (FIXED JSON CRASH)
    let rawText = response.data.content[0].text.trim();
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let agentResult = { next_question: "", end_of_call: false };
    
    try {
        // Attempt 1: Standard Parse
        agentResult = JSON.parse(rawText);
    } catch (e) {
        console.error("⚠️ JSON PARSE FAILED. Attempting Regex Fallback...");
        // Attempt 2: Regex Extraction (The Life Saver)
        const questionMatch = rawText.match(/"next_question"\s*:\s*"([^"]*)"/);
        const endMatch = rawText.match(/"end_of_call"\s*:\s*(true|false)/);
        
        if (questionMatch) {
            agentResult.next_question = questionMatch[1];
        } else {
            // Worst case: The AI outputted pure text
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
