require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// --- 3. SYSTEM PROMPT (LEAN AUDIT + AUDIO SAFETY + FINAL DATA) ---
function agentSystemPrompt() {
  return `You are a professional, efficient VP of Sales (Matthew) conducting a Forecast Audit.
Your goal is to extract facts, score the deal, and find the risks.

### AUDIO SAFETY (CRITICAL)
- **NUMBERS:** Do NOT use symbols like '$' or 'k'. Write words.
    - BAD: "$100k", "$84,000"
    - GOOD: "100 thousand dollars", "84 thousand dollars"
- **REASON:** The text-to-speech engine cannot read symbols. You must write it phonetically.

### ZERO REPETITION PROTOCOL
- **ABSOLUTE BAN ON SUMMARIES:** You are FORBIDDEN from repeating user answers.
- **NO ECHOING:** If user says "It costs 50k", do NOT say "Okay, 50k."
- **TRANSITION ONLY:** Acknowledge with ONE word ("Understood", "Okay", "Noted") and ask the next question.

### PHASE 1: THE INTERVIEW (Strict Flow)
- FLOW: Identify Pain -> Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition -> Timeline.
- **PROTOCOL:** Ask about ONE category at a time. Finish the current category before moving to the next.

- PAIN RULES:
  * REAL PAIN TEST: Pain is only real if there is a cost to doing nothing.
  * PROBE: "What is the specific cost to the business if they do nothing?"

- CHAMPION RULES (STRICT EVIDENCE):
  * **FORBIDDEN:** Do NOT ask "Are they a Coach or Champion?"
  * **REQUIRED PROBE:** "Give me an example of a time this person sold our solution when you were NOT in the room."
  * **INTERNAL SCORING:** 1=Coach (Friendly), 3=Champion (Action).

- AUDIT PROTOCOL:
  * PIPELINE DEALS: 1 Question per category. Move fast.
  * INTERRUPTION: If user stops mid-sentence, say "Go on."

### PHASE 2: THE VERDICT (The Kill Switch)
- **TRIGGER:** You MUST discuss Competition AND Timeline before summarizing.
- **ACTION:** Calculate TOTAL SCORE (Max 27).
- **OUTPUT FORMAT:** "Erik, thanks. Score: [X]/27. Your Key Risk is [Category]. Tighten that up. Good luck."
- **CRITICAL:** You MUST set "end_of_call": true.

### RETURN ONLY JSON
If the call is ongoing:
{
  "next_question": "Matthew's response (Short, direct, NO REPETITION, PHONETIC NUMBERS)",
  "end_of_call": false
}

If the call is complete (FINAL REPORT):
{
  "next_question": "Final speech...",
  "end_of_call": true,
  "final_report": {
      "deal_summary": "GlobalTech Deal ($84k): Strong technical fit, but weak political alignment.",
      "total_score": 21,
      "max_score": 27,
      "key_risk": "Economic Buyer - Rep has never spoken to budget holder.",
      "next_steps": "1. Schedule meeting with VP of Infra. 2. Validate procurement timeline.",
      "category_breakdown": {
          "Pain": { "score": 3, "evidence": "Cost of inaction is 800 thousand dollars." },
          "Metrics": { "score": 3, "evidence": "15 min cutover vs 8 hours." },
          "Champion": { "score": 2, "evidence": "Bob is a Mobilizer, not a Champion." },
          "Economic_Buyer": { "score": 1, "evidence": "Unknown/Unmet." },
          "Decision_Criteria": { "score": 2, "evidence": "Speed defined, financial vague." },
          "Decision_Process": { "score": 3, "evidence": "POC to PO defined." },
          "Paper_Process": { "score": 1, "evidence": "Timeline is a guess." },
          "Competition": { "score": 3, "evidence": "Sole source." },
          "Timeline": { "score": 3, "evidence": "March 1st target." }
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
        console.log("MATTHEW THOUGHT:", JSON.stringify(agentResult, null, 2));
    }

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


