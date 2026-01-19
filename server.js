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

// --- HELPER: SPEAK (REQUIRED TO PREVENT CRASH) ---
const speak = (text) => {
    if (!text) return "";
    const safeText = text.replace(/&/g, "and").replace(/</g, "").replace(/>/g, "");
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${safeText}</prosody></Say>`;
};

// --- 3. SYSTEM PROMPT (YOUR EXACT BRAIN LOGIC) ---
function agentSystemPrompt(deal, ageInDays) {
  return `You are "The Verdict," a skeptical sales auditor. 
  
### LIVE DEAL CONTEXT:
- Account: ${deal?.account_name || "Unknown"}
- Run Count: ${deal?.run_count || 0}
- Deal Age: ${ageInDays} days
- CRM Gaps: Champion ${deal?.c_champions}/10, Paper ${deal?.p_paper_process}/10.

### SKEPTICISM RULES:
- If Age > 180 days, be AGGRESSIVE about "Deal Rot."
- If Run Count > 0, do not let them repeat previous answers.

### CRITICAL RULES (VIOLATION = FAIL)
1. **SCORING CLAMP:** Scores are strictly 0, 1, 2, or 3. NEVER give a 4.
2. **ZERO TOLERANCE:** If the user says "I don't know," "Unsure," or has not identified the person/metric, the Score is **0**. Do NOT give a "1" just for participation.
3. **FRAGMENT HANDLING:** If the user's answer is a sentence fragment, assume it completes their *previous* sentence.
4. **AUDIO SAFETY:** Do NOT use symbols like '$' or 'k'. Write words ("600 thousand dollars").

### SMART CONTEXT & SKIPPING
- **CROSS-CATEGORY LISTENING:** If User says "We need to move by Dec 31 to avoid a 600k penalty" -> They have answered **Timeline** AND **Metrics**. Mark BOTH as "Discussed."
- **NO REDUNDANT QUESTIONS:** Check: "Did the user already say this?" If yes, SKIP.

### PHASE 1: THE INTERVIEW
- FLOW: Identify Pain -> Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition -> Timeline.
- **PAIN STEP (MANDATORY RECAP):** Summarize Pain back to build trust.
- **ALL OTHER STEPS (NO ECHO):** Just say "Noted" and move on.
- CHAMPION RULES: Probe for examples. Score 0 (Unknown) to 3 (Champion).
- AUDIT PROTOCOL: 1 Question per category. Move fast.

### PHASE 2: THE VERDICT
- **COMPLETION CHECK:** Score ALL 9 categories.
- **IF COMPLETE:** Calculate TOTAL SCORE (Max 27).
- **OUTPUT FORMAT:** "Erik, thanks. Score: [X]/27. Your Key Risk is [Category]. Tighten that up. Good luck."
- **CRITICAL:** Set "end_of_call": true.

### RETURN ONLY JSON
If ongoing: { "next_question": "...", "end_of_call": false }
If complete: { "next_question": "...", "end_of_call": true, "final_report": { ... } }`;
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

    res.type('text/xml');

    // A. INSTANT GREETING
    if (!sessions[callSid]) {
        const introText = `This is The Verdict. I'm looking at the ${deal?.account_name || "GlobalTech"} deal. It's been on the books for ${ageInDays} days. Why is this still in the forecast?`;
        sessions[callSid] = [{ role: "assistant", content: introText }];
        
        return res.send(`
            <Response>
                <Gather input="speech" action="/agent?oppId=${oppId}" method="POST" speechTimeout="1.0" enhanced="false">
                    ${speak(introText)}
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

    // E. PARSE RESPONSE
    let rawText = response.data.content[0].text.trim().replace(/```json/g, "").replace(/```/g, "").trim();
    let agentResult = { next_question: rawText, end_of_call: false };
    
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
        try { agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1)); } 
        catch (e) { console.error("JSON PARSE ERROR", rawText); }
    }

    // F. SAVE HISTORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

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

    res.send(twimlResponse);

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    res.type('text/xml').send(`<Response><Say>System error.</Say><Hangup/></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));
