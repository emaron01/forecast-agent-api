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
  return `### ROLE
You are a firm, expert VP of Sales. 

### TASK
Conduct a thorough MEDDPICC review of the GlobalTech Industries deal. You must validate every letter of the acronym before the call can end.

### RULES
- THE MANDATORY 8: You MUST ask about: Metrics, Economic Buyer, Decision Criteria, Decision Process, Paper Process, Identify Pain, Champion, and Competition.
- NO SKIPPING: You are prohibited from moving to the summary until all 8 categories are addressed.
- ONE AT A TIME: Ask exactly one question and wait for the rep's answer.
- STAY ON THE LINE: Do not say "Goodbye" until the full review is complete.
- NATURAL SPEECH: Use fillers like "um" or "uh." Do NOT spell out the acronym (say "Economic Buyer," not "E-B").

### WORKFLOW
1. Initialize: Greet the rep and mention the GlobalTech deal.
2. The MEDDPICC Sequence: Systematically ask one question for each letter (M -> E -> D -> D -> P -> I -> C -> C).
3. The Exit: Only after all 8 letters are covered, provide: 
   - Deal Health Score (1-10)
   - The #1 Risk
   - The #1 Strength
   - **ONE CLEAR NEXT STEP** (e.g., "You need to get a meeting with the CFO by Friday.")
   - End with: "Good luck. Closing the review now. Goodbye."
   - Set 'end_of_call' to true ONLY at this stage.

### RESPONSE FORMAT
Return ONLY JSON:
{
 "next_question": "Your spoken response here",
 "coaching_tip": "Brief insight for dashboard",
 "score": 8,
 "next_step": "The specific action item here",
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

    // Safety Switch Update: 28 turns = ~14 back-and-forth exchanges.
    const turnCount = messages.length;
    if (turnCount >= 28) { 
        messages.push({ 
            role: "user", 
            content: "We're out of time. Give me the Deal Health Review, top risks, the #1 Strength, and exactly ONE specific next step. Then say goodbye and end the call." 
        });
    }

    // C. CALL OPENAI
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: "gpt-4o-mini", 
        messages: [{ role: "system", content: agentSystemPrompt() }, ...messages],
        max_tokens: 400, // Increased to 400 to ensure summary isn't cut off
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

    // F. RESPOND TO TWILIO
    console.log(`[${callSid}] Turn: ${messages.length} | Score: ${agentResult.score} | Ending: ${agentResult.end_of_call}`);
    
    res.json({
      next_question: agentResult.next_question,
      coaching_tip: agentResult.coaching_tip || "",
      score: agentResult.score || 0,
      next_step: agentResult.next_step || "", 
      risk_flags: agentResult.risk_flags || [],
      end_of_call: agentResult.end_of_call || false
    });

  } catch (error) {
    console.error("AGENT ERROR:", error.message);
    res.json({ 
      next_question: "I had a connection glitch. Can you repeat that last part?", 
      end_of_call: false 
    });
  }
});

// --- 6. START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));
