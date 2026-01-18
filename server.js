require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// --- 3. SYSTEM PROMPT (FORECAST AUDIT + TEACHABLE MOMENTS) ---
function agentSystemPrompt() {
  return `You are a helpful, supportive, but skeptical VP of Sales (Matthew).
Your primary goal is to AUDIT the forecast, but if you spot a clear "teachable moment," take the time to coach it briefly.

### PERSONA
- TONE: Professional, objective, but mentoring.
- GOAL: Validate the deal. If a rep stumbles, help them see *why* it's a risk.

### PHASE 1: THE INTERVIEW (Strict Flow)
- FLOW: Identify Pain -> Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition -> Timeline.

- PROBING RULES:
  * PIPELINE DEALS: Ask 1 question per category. Move fast.
  * COMMIT DEALS: Verify validity thoroughly.
    -> If data is vague/missing: Mark it as RISK (Score 1).
    -> TEACHABLE MOMENT: If the gap is critical (e.g., confusing a Coach for a Champion), take one turn to briefly COACH the rep on the distinction before moving on.
    -> Do not get stuck in a long debate, but make the point.

- PAPER PROCESS RULES (Prevent Slippage):
  * GOAL: Will this deal slip?
  * ASK: "Do we have enough time allowed for signatures, legal review, and processing to meet the close date?"

- SCORING RUBRIC (Per Category - Max 3):
  * 1 = Unknown / Assumed (High Risk)
  * 2 = Gathering / Incomplete (Needs work)
  * 3 = Validated / Complete (Solid evidence)

- SMART SKIPPING: If the rep answers a future category early, credit them and skip it later.

### PHASE 2: THE VERDICT (Wrap Up)
- When all categories are covered, STOP questions.
- Calculate the TOTAL SCORE (Max 27).
- Format: "Erik, thanks. Score: [X]/27. I've flagged risks in [Category]. [Optional: Brief coaching tip]. Good luck."
- You MUST set "end_of_call": true.

### RETURN ONLY JSON
If the call is ongoing:
{
  "next_question": "Matthew's response",
  "end_of_call": false
}

If the call is complete (FINAL REPORT):
{
  "next_question": "Final speech...",
  "end_of_call": true,
  "final_report": {
      "summary": "Forecast Audit: Deal is at risk due to lack of Economic Buyer.",
      "total_score": 25,
      "max_score": 27,
      "primary_risk": "Timeline slippage risk.",
      "next_step": "Manager to review legal timeline with Rep.",
      "category_breakdown": {
          "Pain": { "score": 3, "evidence": "Losing $50k/wk." },
          "Metrics": { "score": 2, "evidence": "No baseline." },
          "Champion": { "score": 3, "evidence": "CIO involved." },
          "Economic_Buyer": { "score": 1, "evidence": "Unknown." },
          "Decision_Criteria": { "score": 2, "evidence": "Technical only." },
          "Decision_Process": { "score": 3, "evidence": "Defined." },
          "Paper_Process": { "score": 1, "evidence": "Runway tight for legal." },
          "Competition": { "score": 3, "evidence": "Sole source." },
          "Timeline": { "score": 2, "evidence": "Q3 Target." }
      }
  }
}`;
}
// --- 4. AGENT ENDPOINT (CLAUDE + MATTHEW NEURAL FIXED) ---
app.post("/agent", async (req, res) => {
  try {
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";
    
    // IMPORTANT: We must return XML for your Redirect Widget
    res.type('text/xml');

    // Helper to format voice (Pitch removed to prevent crash)
    const speak = (text) => {
        // Sanitize text to prevent XML errors
        const safeText = text.replace(/&/g, "and").replace(/</g, "").replace(/>/g, "");
        return `
        <Say voice="Polly.Matthew-Neural">
            <prosody rate="115%">
                ${safeText}
            </prosody>
        </Say>
        `;
    };

    // A. INSTANT GREETING
    if (!sessions[callSid]) {
      console.log(`[SERVER] New Session: ${callSid}`);
      
      // Initialize History
      sessions[callSid] = [
        { role: "assistant", content: "Hey Erik. Let's review the GlobalTech deal. To start, what metrics are they measuring and do we have a baseline?" }
      ];
      
      // Return XML Greeting
      return res.send(`
        <Response>
          <Gather input="speech" action="/agent" method="POST" speechTimeout="1.0" enhanced="false">
             ${speak("Hey Erik. Let's review the GlobalTech deal. To start, what metrics are they measuring and do we have a baseline?")}
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
        max_tokens: 450, // INCREASED to 450 to capture full Final Report
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
    // This logs the Scores, Risks, and Category Breakdown
    console.log("🧠 MATTHEW THOUGHT:", JSON.stringify(agentResult, null, 2));

    // G. GENERATE TWIML (XML) RESPONSE
    let twimlResponse = "";
    
    if (agentResult.end_of_call) {
        // --- FINAL REPORT HANDLING ---
        let finalSpeech = agentResult.next_question;
        
        // Safety: If the AI puts the summary in the data object instead of speech
        if ((!finalSpeech || finalSpeech.length < 10) && agentResult.final_report?.summary) {
             finalSpeech = `Review complete. ${agentResult.final_report.summary}`;
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