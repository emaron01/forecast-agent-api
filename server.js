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

// --- 3. SYSTEM PROMPT (THE VIRTUAL VP) ---
function agentSystemPrompt(deal, ageInDays) {
  // 1. Get the Benchmarks (The Physics)
  const avgCycle = deal?.seller_avg_cycle || 90;
  const avgSize = deal?.seller_avg_deal_size || 10000;
  
  // 2. Get the Product Knowledge (The Truth)
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";

  return `You are "Matthew," the VP of Sales for ${deal?.seller_website || "our company"}.
  
### YOUR KNOWLEDGE BASE (THE TRUTH)
${productContext}
*INSTRUCTION: Use the knowledge above to validate what the rep says. If they claim a benefit or feature that contradicts the text above, politely challenge them.*

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Value: $${deal?.amount} (Our Avg: $${avgSize})
- Age: ${ageInDays} days (Our Cycle: ${avgCycle} days)

### YOUR PERSONALITY
- **VP Level Insight:** You know the product. If a rep says "Migration takes 1 minute" and you know it takes an hour, flag it.
- **Upbeat & Collaborative:** "Help me understand..." not "You are wrong."

### CRITICAL RULES
1. **SCORING:** Keep the 0-3 scale for your internal tracking, but don't say the score out loud unless asked.
2. **ZERO TOLERANCE ON FACTS:** If they don't know a detail, gently press: "That's a key detail we need. Who can we ask to find that out?"
3. **AUDIO SAFETY:** Write numbers as words ("two hundred days").

### PHASE 1: THE STRATEGY SESSION
- FLOW: Identify Pain -> Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition -> Timeline.
- **Goal:** Find the gaps so we can help them close.
- **Product Validation:** When they discuss "Metrics" or "Decision Criteria," compare it against your KNOWLEDGE BASE. 
  - *Example:* If they say "Customer wants Feature X," and your Knowledge Base says we don't do Feature X, ask: "I thought we deprecated Feature X last year. How are we handling that?"
- **Champion Check:** If the Champion score is low, ask: "Do we have anyone else who can advocate for us when we aren't in the room?"

### PHASE 2: THE SUMMARY
- If complete, give a encouraging summary: "Great job on [Strongest Area]. To get this across the line, let's focus on [Weakest Area]. I'll send you the notes. Good luck!"
- Set "end_of_call": true.

### RETURN ONLY JSON
{ "next_question": "...", "end_of_call": false }`;
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

    // Calculate Age
    const ageInDays = deal ? Math.floor((new Date() - new Date(deal.opp_created_date)) / (1000 * 60 * 60 * 24)) : 0;
    
   // A. INSTANT GREETING (PROFESSIONAL BROADCAST FLOW)
    if (!sessions[callSid]) {
        console.log(`[SERVER] New Session: ${callSid} for Opp ID: ${oppId}`);

        const repName = deal.rep_name || "Sales Rep";
        
        // --- CONTEXT LOGIC ---
        const benchmarkCycle = deal.seller_avg_cycle || 90; 
        const benchmarkSize = deal.seller_avg_deal_size || 10000;
        const isWhale = deal.amount > (benchmarkSize * 1.5);
        const isStuck = ageInDays > (benchmarkCycle * 1.2);

        // Format amount for speech
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed value";

        // 1. The Intro & Agenda
        const introPart = `Hi ${repName}, This is Matthew from Sales Forecast. We will jump right into our forecast.`;
        
        // 2. The Anchor (Account & Money)
        const contextPart = `Let's start with the ${deal?.account_name || "Unknown"} deal, an opportunity for ${amountSpeech}.`;

        // 3. The Launch (Context-Aware Transition)
        let transition = "To kick things off,";
        if (isWhale) {
            transition = "This is a key deal, so let's be thorough. To kick things off,";
        } else if (isStuck) {
            transition = "It's been open a while, so let's unblock it. To kick things off,";
        }

        // Combine them
        const finalGreeting = `${introPart} ${contextPart} ${transition} what is the main problem they are trying to solve?`;

        // Initialize History
        sessions[callSid] = [
            { role: "assistant", content: finalGreeting }
        ];
        
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
      // If user stayed silent, ask again
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
    
    // Log the interaction
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