require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE (Critical: Must be outside the endpoint) ---
const sessions = {}; 

console.log("MEDDPICC Agent: Session-Based Memory Active");

// --- 3. MOCK CRM DATA ---
const deals = [
  { id: "D-001", account: "GlobalTech Industries", opportunityName: "Workflow Automation Expansion", forecastCategory: "Commit" }
];

// --- 4. SYSTEM PROMPT ---
function agentSystemPrompt() {
  return `You are the SalesForecast.io Virtual VP. 
- MISSION: Conduct a MEDDPICC deal review. 
- Ask ONLY ONE probing question at a time.
- Provide brief coaching after answers.
- Produce JSON only. No markdown.
{
 "next_question": "...",
 "coaching_tip": "...",
 "score": 0,
 "risk_flags": [],
 "end_of_call": false
}`;
}

// --- 5. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  try {
    // Unique ID from Twilio for this specific call
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    // A. RETRIEVE OR CREATE HISTORY
    if (!sessions[callSid]) {
      const initialContext = `CONVERSATION START: Reviewing GlobalTech Industries (Commit) with Erik Thompson. Start the call and ask the first MEDDPICC question.`;
      sessions[callSid] = [{ role: "user", content: initialContext }];
      console.log(`[SERVER] New Session: ${callSid}`);
    }

    let messages = sessions[callSid];

    // B. ADD USER INPUT
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }
// Safety Switch: Force a summary if the call is getting long
    const turnCount = messages.length;
    if (turnCount >= 10) { // Approx 5 exchanges
        messages.push({ 
            role: "user", 
            content: "We're out of time. Give me the Deal Health Review, top risks, and next steps, then say goodbye and end the call." 
        });
    }
    // C. CALL OPENAI (Using gpt-4o-mini for speed)
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: "gpt-4o-mini", 
        messages: [{ role: "system", content: agentSystemPrompt() }, ...messages],
        max_tokens: 300,
        temperature: 0.2
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        }
      }
    );

    // D. PARSE RESPONSE
    let rawText = response.data.choices[0].message.content.trim();
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const agentResult = JSON.parse(rawText);
    
    // E. SAVE TO MEMORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

    // 5. RESPOND TO TWILIO (The "Summary-Ready" Version)
    console.log(`[${callSid}] Turn: ${messages.length} | Score: ${agentResult.score} | Ending: ${agentResult.end_of_call}`);
    
    res.json({
      next_question: agentResult.next_question,
      coaching_tip: agentResult.coaching_tip || "",
      score: agentResult.score || 0,
      risk_flags: agentResult.risk_flags || [],
      end_of_call: agentResult.end_of_call || false
      // Reminder: history is no longer sent back to Twilio!
    });
  } catch (error) {
    console.error("AGENT ERROR:", error.message);
    res.json({ 
      next_question: "I had a connection glitch. Can you repeat that last part?", 
      end_of_call: false 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));



