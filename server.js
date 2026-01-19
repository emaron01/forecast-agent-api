require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();

// Initialize the Database Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // This logic allows you to connect locally (SSL off) or on Render (SSL on)
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com") 
       ? { rejectUnauthorized: false } 
       : false
});

// Basic check to ensure the connection is alive
pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error("❌ Database connection error:", err);
  else console.log("✅ Database connected successfully at:", res.rows[0].now);
});
// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// --- 3. SYSTEM PROMPT (EXECUTIVE SUMMARY + ZERO TOLERANCE) ---
function agentSystemPrompt() {
  return `You are a professional, efficient VP of Sales (Matthew) conducting a Forecast Audit.
Your goal is to extract facts, score the deal, and find the risks.

### CRITICAL RULES (VIOLATION = FAIL)
1. **SCORING CLAMP:** Scores are strictly 0, 1, 2, or 3. NEVER give a 4.
2. **ZERO TOLERANCE:** If the user says "I don't know," "Unsure," or has not identified the person/metric, the Score is **0**.
3. **FRAGMENT HANDLING:** If the user's answer is a sentence fragment, assume it completes their *previous* sentence.
4. **AUDIO SAFETY:** Do NOT use symbols like '$' or 'k'. Write words ("600 thousand dollars").

### SMART CONTEXT & SKIPPING
- **CROSS-CATEGORY LISTENING:** If User says "Move by Dec 31 to avoid 600k penalty" -> Mark **Timeline** AND **Metrics** as Discussed.
- **NO REDUNDANT QUESTIONS:** Check: "Did the user already say this?" If yes, SKIP.

### PHASE 1: THE INTERVIEW (Strict Flow - NO SUMMARIES)
- FLOW: Identify Pain -> Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition -> Timeline.

- **PAIN STEP (EXCEPTION):** After Pain, you **MUST** briefly summarize it back to build trust ("Understood. That 600 thousand dollar penalty is serious...").

- **ALL OTHER STEPS (STRICT NO ECHO):**
  - Do NOT summarize user answers. Just say "Noted" or "Understood" and ask the next question.

- CHAMPION RULES:
  * **PROBE:** "Give me an example of a time they sold for us when you weren't there."
  * **SCORING:** 0=Unknown, 1=Coach, 2=Mobilizer, 3=Champion.

- AUDIT PROTOCOL:
  * PIPELINE DEALS: 1 Question per category. Move fast.
  * INTERRUPTION: If user stops mid-sentence, say "Go on."

### PHASE 2: THE VERDICT (The Executive Summary)
- **COMPLETION CHECK:** Have you scored ALL 9 categories?
- **IF MISSING DATA:** Ask the missing question.
- **IF COMPLETE:** 1. **STOP ASKING QUESTIONS.**
    2. **DELIVER THE VERDICT:** You **MUST** speak the following 4 items clearly:
       - **The Deal Summary:** (e.g., "This is a strong technical fit for...")
       - **The Total Score:** (e.g., "Score is 19 out of 27.")
       - **The Key Risk:** (e.g., "Your Key Risk is the Economic Buyer because...")
       - **The Next Steps:** (e.g., "Next steps are 1... and 2...")
    3. **SET FLAG:** "end_of_call": true.

### RETURN ONLY JSON
If the call is ongoing:
{
  "next_question": "Matthew's response",
  "end_of_call": false
}

If the call is complete (FINAL REPORT):
{
  "next_question": "Here is the verdict... [Speak Summary, Score, Risk, and Next Steps]",
  "end_of_call": true,
  "final_report": {
      "deal_summary": "GlobalTech Deal ($84k): Strong technical fit ($600k penalty avoidance).",
      "total_score": 19,
      "max_score": 27,
      "key_risk": "Economic Buyer - Score 0 (Unknown).",
      "next_steps": "1. Identify the Budget Holder. 2. Validate procurement timeline.",
      "category_breakdown": {
          "Pain": { "score": 3, "evidence": "Cost of inaction is 600 thousand dollars/year." },
          "Metrics": { "score": 3, "evidence": "15 min cutover vs 8 hours." },
          "Champion": { "score": 1, "evidence": "Bob is a Coach (Friendly but no influence)." },
          "Economic_Buyer": { "score": 0, "evidence": "User does not know who this is." },
          "Decision_Criteria": { "score": 2, "evidence": "Speed defined, financial vague." },
          "Decision_Process": { "score": 3, "evidence": "POC to PO defined." },
          "Paper_Process": { "score": 1, "evidence": "Timeline is a guess." },
          "Competition": { "score": 3, "evidence": "Sole source." },
          "Timeline": { "score": 3, "evidence": "Dec 31 deadline." }
      }
  }
}`;
}

// --- 4. AGENT ENDPOINT (CLAUDE + MATTHEW NEURAL FIXED) ---
app.post("/agent", async (req, res) => {
  try {
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";
    
    // IMPORTANT: Return XML for Redirect Widget
    res.type('text/xml');

    // Helper to format voice (Pitch removed to prevent crash)
    const speak = (text) => {
        // Sanitize text to prevent XML errors
        if (!text) return "";
        const safeText = text.replace(/&/g, "and").replace(/</g, "").replace(/>/g, "");
        return `
        <Say voice="Polly.Matthew-Neural">
            <prosody rate="105%">
                ${safeText}
            </prosody>
        </Say>
        `;
    };

    // A. INSTANT GREETING
    if (!sessions[callSid]) {
      console.log(`[SERVER] New Session: ${callSid}`);
      
      // AUDIO FIX: Write numbers as words ("84 thousand dollars")
      const introText = "Hey Erik. Let's review the GlobalTech deal, a 2000 server migration for 84 thousand dollars. To start, what problem are they trying to solve, and what happens if they do nothing?";

      // Initialize History
      sessions[callSid] = [
        { role: "assistant", content: introText }
      ];
      
      // Return XML Greeting
      return res.send(`
        <Response>
          <Gather input="speech" action="/agent" method="POST" speechTimeout="1.0" enhanced="false">
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
      // If user stayed silent, ask again
      return res.send(`
        <Response>
          <Gather input="speech" action="/agent" method="POST" speechTimeout="1.0" enhanced="false">
             ${speak("I didn't catch that. Could you say it again?")}
          </Gather>
        </Response>
      `);
    }

    // C. EMERGENCY SAFETY SWITCH (Turn 30)
    if (messages.length >= 30 && !messages.some(m => m.content.includes("Out of time"))) {
       messages.push({ role: "user", content: "Out of time. Give me the verbal summary and score, then say Goodbye." });
    }

    // D. CALL ANTHROPIC API (HAIKU)
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-haiku-20240307", 
        max_tokens: 1024, // GUARANTEES FULL REPORT (NO CUTOFF)
        temperature: 0,
        system: agentSystemPrompt(),       
        messages: messages
      },
      {
        headers: {
          "x-api-key": process.env.MODEL_API_KEY.trim(),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      }
    );

    // E. PARSE RESPONSE
    let rawText = response.data.content[0].text.trim();
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let agentResult = {};
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
        try {
            agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
        } catch (e) {
            console.error("JSON PARSE ERROR", rawText);
            agentResult = { next_question: rawText, end_of_call: false };
        }
    } else {
        agentResult = { next_question: rawText, end_of_call: false };
    }

    // F. SAVE HISTORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

    // --- X-RAY LOGGING (VIEW FULL CRM DATA IN RENDER LOGS) ---
    console.log(`\n--- TURN ${messages.length} [${callSid}] ---`);
    console.log("🗣️ USER SAID:", transcript);
    
    // If it's the final report, print a pretty table
    if (agentResult.final_report) {
        console.log("\n📋 FINAL AUDIT REPORT 📋");
        console.log("------------------------------------------------");
        console.log(`DEAL SUMMARY: ${agentResult.final_report.deal_summary}`);
        console.log(`KEY RISK:     ${agentResult.final_report.key_risk}`);
        console.log(`NEXT STEPS:   ${agentResult.final_report.next_steps}`);
        console.log(`TOTAL SCORE:  ${agentResult.final_report.total_score} / 27`);
        console.log("------------------------------------------------");
        
        // Format for console.table
        const tableData = {};
        if (agentResult.final_report.category_breakdown) {
            for (const [category, data] of Object.entries(agentResult.final_report.category_breakdown)) {
                tableData[category] = { 
                    Score: data.score, 
                    Evidence: data.evidence 
                };
            }
            console.table(tableData);
        }
    } else {
        // Normal turn logging
        console.log("🧠 MATTHEW THOUGHT:", JSON.stringify(agentResult, null, 2));
    }

    // G. GENERATE TWIML (XML) RESPONSE
    let twimlResponse = "";
    
    if (agentResult.end_of_call) {
        // --- FINAL REPORT HANDLING ---
        let finalSpeech = agentResult.next_question;
        
        // Safety: If the AI puts the summary in the data object instead of speech
        // FIX: Updated to check deal_summary instead of summary to match schema
        if ((!finalSpeech || finalSpeech.length < 10) && agentResult.final_report?.deal_summary) {
             finalSpeech = `Review complete. ${agentResult.final_report.deal_summary}`;
        }

        twimlResponse = `
          <Response>
            ${speak(finalSpeech)}
            <Hangup/>
          </Response>
        `;
    } else {
        // --- NORMAL TURN ---
        twimlResponse = `
          <Response>
            <Gather input="speech" action="/agent" method="POST" speechTimeout="1.0" enhanced="false">
               ${speak(agentResult.next_question)}
            </Gather>
          </Response>
        `;
    }
    
    // Send XML back to Twilio
    res.send(twimlResponse);

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    if (error.response) console.error("Anthropic Error:", error.response.data);
    res.type('text/xml').send(`
        <Response>
            <Say voice="Polly.Matthew-Neural">System error. Please try again.</Say>
            <Hangup/>
        </Response>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));
