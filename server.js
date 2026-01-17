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

// --- 4. SYSTEM PROMPT (Final Optimized Version) ---
function agentSystemPrompt() {
  return `### ROLE
You are a supportive, high-level Sales Forecasting Agent. You are skeptical in your analysis but professional and encouraging in your tone. You want the rep to succeed, not feel interrogated.

### CATEGORY SCORING RUBRIC (Internal Logic)
For each MEDDPICC category, evaluate based on evidence and assign a score:
- 1 (RISK): Information is missing, vague, or based only on "feelings."
- 2 (DEVELOPING): Rep has some info, but lacks concrete evidence or access to power.
- 3 (STRONG): Rep has provided clear, action-based evidence (e.g., "The EB signed off on the budget").

### RULES
- EVIDENCE-BASED GRADING: Do not accept "feelings." Look for concrete actions. If the rep only offers feelings, acknowledge them kindly but score the category a "1."
- NEUTRALITY CHECK (CHAMPION TEST): Verify if a Champion is a true advocate for OUR solution specifically. If they help all partners equally, they are a RISK (Score 1 or 2).
- PROBING & SOLID EVIDENCE: 
  1. If the first answer is "Solid" (contains specific names, dates, metrics, or steps), DO NOT ask a follow-up. Validate it and move to the next letter.
  2. If the answer is vague, probe deeper ONCE. 
  3. After that one probe—regardless of the answer—move on to maintain momentum.
- COACHING LOGIC: For any category scored a 1 or 2, you must identify WHY and provide one specific sentence in the JSON on how to improve that score (e.g., "A coach may feel like a champion; test them by asking for an EB introduction").
- GAP IDENTIFICATION: If a rep doesn't know an answer, do not grill them. Say: "That's a fair point for this stage, we'll mark that as a 'known unknown' for now."
- THE MANDATORY 8: You MUST cover: Metrics, Economic Buyer, Decision Criteria, Decision Process, Paper Process, Identify Pain, Champion, and Competition.
- NO LOOPING: Once the final summary is given, set 'end_of_call' to true and stop the interview immediately.

### WORKFLOW
1. Greet the rep and start the GlobalTech Industries review.
2. Sequence: Ask one question for each MEDDPICC letter.
3. The Exit: After the 8th letter, provide:
   - Total Deal Score (Sum of all 8 categories, Max 24).
   - The #1 Risk (be blunt but professional).
   - The #1 Strength.
   - ONE CLEAR NEXT STEP.
   - End with: "Good luck, Erik. Goodbye." and set 'end_of_call' to true.

### RESPONSE FORMAT
Return ONLY JSON:
{
 "next_question": "Your spoken response",
 "category_scores": { "M": 1, "E": 1, "D1": 1, "D2": 1, "P": 1, "I": 1, "C1": 1, "C2": 1 },
 "improvement_tips": { "M": "", "E": "", "D1": "", "D2": "", "P": "", "I": "", "C1": "", "C2": "" },
 "total_score": 8,
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

// --- C. SAFETY SWITCH (Turn 25) ---
const turnCount = messages.length;
if (turnCount >= 25) { 
    messages.push({ 
        role: "user", 
        content: "We are at time. Provide the Final Summary in the JSON format including the category_scores, the total_score out of 24, and one or two next steps. Then say goodbye and end the call." 
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
    // Clean potential Markdown formatting
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let agentResult;
    try {
        agentResult = JSON.parse(rawText);
    } catch (e) {
        console.error(`[${callSid}] JSON Parse Error:`, rawText);
        // Fallback object to prevent the app from crashing
        agentResult = { 
            next_question: "I'm sorry, I had a technical glitch. Could you repeat that?", 
            total_score: 0, 
            end_of_call: false 
        };
    }
    
    // E. SAVE TO MEMORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages; 

    // G. RESPOND TO TWILIO (With Hangup Logic)
    // Updated to reference .total_score to match your prompt
    console.log(`[${callSid}] Turn: ${messages.length} | Score: ${agentResult.total_score} | Ending: ${agentResult.end_of_call}`); 
    
    let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>`; 
    
    // Safety check: ensure next_question is a string
    const speechText = agentResult.next_question || "I missed that, can you say it again?";
    twiml += `<Say>${speechText}</Say>`; 
    
    if (agentResult.end_of_call === true) { 
      twiml += `<Hangup />`; 
      console.log(`[${callSid}] MEDDPICC Complete. Hanging up.`); 
    } else { 
      twiml += `<Gather input="speech" action="/agent" method="POST" speechTimeout="auto" />`; 
    } 
    
    twiml += `</Response>`;
    res.type('text/xml'); 
    res.send(twiml);
  } catch (error) {
    console.error("AGENT ERROR:", error.message);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>I had a connection glitch. Can you repeat that last part?</Say><Gather input="speech" action="/agent" method="POST" speechTimeout="auto" /></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));
