require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE (Critical: Must be outside the endpoint) ---
const sessions = {}; 
// Helper to fix currency/number pronunciation for Matthew
const makeFriendlyForMatthew = (text) => {
  if (!text) return "";
  return text
    .replace(/\$/g, " dollars ") 
    .replace(/%/g, " percent ")
    // Removes the comma from numbers (e.g., 84,000 becomes 84000) so TTS doesn't say "comma"
    .replace(/(\d),(\d)/g, "$1$2") 
    .replace(/\b(\d+)k\b/gi, "$1 thousand");
};console.log("MEDDPICC Agent: Session-Based Memory Active");

// --- 3. MOCK CRM DATA ---
const deals = [
  { id: "D-001", account: "GlobalTech Industries", opportunityName: "Server Migration Project", forecastCategory: "Commit" }
];

// --- 4. SYSTEM PROMPT (Final Optimized - Pain First & Lean Turn) ---
function agentSystemPrompt() {
  return `### ROLE
You are a supportive, high-level Sales Forecasting Agent (Matthew). 
You are skeptical in your analysis but professional. You want the rep to succeed, not feel interrogated.

### CATEGORY SCORING RUBRIC (Internal Logic)
- 1 (RISK): Information is missing, vague, or based only on "feelings."
- 2 (DEVELOPING): Rep has some info, but lacks concrete evidence or access to power.
- 3 (STRONG): Rep has provided clear, action-based evidence.

### RULES
- EVIDENCE-BASED GRADING: Do not accept "feelings." If the rep only offers feelings, acknowledge kindly but score a "1" internally.
- NEUTRALITY CHECK (CHAMPION TEST): Verify if a Champion is a true advocate for OUR solution specifically. If they help all partners equally, they are a RISK.
- PROBING: If an answer is vague, probe deeper ONCE. After that one probe—regardless of the answer—move on to maintain momentum.
- SMART SKIPPING: If the user has already answered a category (e.g., they explained the Pain in their greeting), DO NOT ask about it again. Validate it and move to the next letter.
- FLOW: Start with IDENTIFY PAIN. Then move to Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition.
- CONCISE: Keep questions under 20 words. No conversational filler.

### RESPONSE FORMAT
Return ONLY JSON.
If 'end_of_call' is false:
{
  "next_question": "Your question here",
  "end_of_call": false
}

If 'end_of_call' is true:
{
  "next_question": "Review complete.",
  "total_score": 19,
  "end_of_call": true,
  "summary": {
    "total_deal_score": 19,
    "number_one_risk": "Identify the biggest gap from the talk.",
    "one_clear_next_step": "One specific action for the rep.",
    "closing": "Good luck, Erik. Goodbye."
  }
}`;
}

// A. INITIAL GREETING
if (!sessions[callSid]) {
  const introText = "Hi Erik, let's review the Global Tech deal in commit for $84,000. To start, what specific pain or business challenge is driving this migration?";
  sessions[callSid] = [{ role: "assistant", content: introText }];

  let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>`;
// A. INITIAL GREETING - Pronunciation Fix
twiml += `<Say voice="Polly.Matthew-Neural">${makeFriendlyForMatthew(introText)}</Say>`;  
  // High-performance Gather with 1s timeout to prevent interruption
  twiml += `<Gather input="speech" action="/agent" method="POST" speechTimeout="1" speechModel="phone_call" enhanced="true" />`;
  
  twiml += `</Response>`;
  res.type('text/xml');
  return res.send(twiml); }

// B. SUBSEQUENT TURNS (AI Processing)
    const messages = sessions[callSid];
    messages.push({ role: "user", content: userSpeech || "(no speech detected)" });

    // CRITICAL: We create apiMessages to inject the System Prompt (the instructions) 
    // at the start of every single API call.
    const apiMessages = [
      { role: "system", content: agentSystemPrompt() },
      ...messages
    ];

    console.log(`[DEBUG] Attempting call. Key: ${process.env.MODEL_API_KEY ? "FOUND" : "NULL"} | Model: ${process.env.MODEL_NAME || "gpt-4o-mini"}`);

    const response = await axios.post(
      process.env.MODEL_API_URL || "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.MODEL_NAME || "gpt-4o-mini", 
        messages: apiMessages, // <--- Use the one with the system prompt!
        response_format: { type: "json_object" }
      },
      { 
        headers: { 
          Authorization: `Bearer ${process.env.MODEL_API_KEY}` 
        } 
      }
    );
// C. PARSE RESPONSE
    let rawText = response.data.choices[0].message.content.trim();
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let agentResult;
    try {
        agentResult = JSON.parse(rawText);
    } catch (e) {
        console.error("JSON Parse Error", rawText);
        agentResult = { next_question: "Could you repeat that?", end_of_call: false };
    }

    // DEBUG: Log speed
    console.log(`[${callSid}] Turn complete. End of call: ${agentResult.end_of_call}`);

// D. SAVE TO MEMORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

// E. RESPOND TO TWILIO
    let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>`;

    if (agentResult.end_of_call === true) {
      const s = agentResult.summary;
      let finalSpeech = "";

      if (s && s.total_deal_score) {
        finalSpeech = `Review complete. Your total score is ${s.total_deal_score}. The top risk is ${s.number_one_risk}. Your next step is ${s.one_clear_next_step}. ${s.closing}`;
      } else {
        const score = agentResult.total_score || "calculated";
        finalSpeech = `Review complete. Your total score is ${score}. I recommend reviewing your gaps. Good luck, Erik.`;
      }

      twiml += `<Say voice="Polly.Matthew-Neural">${makeFriendlyForMatthew(finalSpeech)}</Say>`;
      twiml += `<Hangup />`;
      console.log(`[${callSid}] Summary spoken. Hanging up.`);
    } else {
      const speech = makeFriendlyForMatthew(agentResult.next_question);
      twiml += `<Say voice="Polly.Matthew-Neural">${speech || "Moving on..."}</Say>`;

      twiml += `<Gather 
          input="speech" 
          action="/agent" 
          method="POST" 
          speechTimeout="1" 
          speechModel="phone_call" 
          enhanced="true" 
      />`;
    }

    twiml += `</Response>`; 
    res.type('text/xml');
    res.send(twiml); 
  } catch (error) {
    console.error("AGENT ERROR:", error.message);
    res.type('text/xml');
    res.send("<Response><Say voice='Polly.Matthew-Neural'>I'm sorry, I hit a snag. Please try again later.</Say></Response>");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));


