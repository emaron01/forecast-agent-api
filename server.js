require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// Helper to fix currency/number pronunciation for Matthew
const makeFriendlyForMatthew = (text) => {
  if (!text) return "";
  return text
    .replace(/\$/g, " dollars ") 
    .replace(/%/g, " percent ")
    .replace(/(\d),(\d)/g, "$1$2") 
    .replace(/\b(\d+)k\b/gi, "$1 thousand");
};

console.log("MEDDPICC Agent: Session-Based Memory Active");

// --- 3. MOCK CRM DATA ---
const deals = [
  { id: "D-001", account: "GlobalTech Industries", opportunityName: "Server Migration Project", forecastCategory: "Commit" }
];

// --- 4. SYSTEM PROMPT (Optimized for Speed & Flow) ---
function agentSystemPrompt() { return `### ROLE You are a supportive, high-level Sales Forecasting Agent (Matthew). You are skeptical in your analysis but professional. You want the rep to succeed. ### RULES - EVIDENCE-BASED GRADING: Do not accept "feelings." Look for concrete actions. If evidence is missing, you MUST assume the category is a RISK. - SKEPTICISM (Jan 17): Do not assume a category is "strong" unless specific evidence (names, dates, metrics) is provided. If the rep is vague, assume it is a RISK and probe deeper once. - NEUTRALITY CHECK (CHAMPION TEST): Verify if a Champion is a true advocate for OUR solution specifically. If they help all partners equally, they are a RISK. - PROBING: If an answer is vague or lacks evidence, probe deeper ONCE. After that—regardless of the answer—move on to maintain momentum. - SMART SKIPPING: If the user has already answered a future category (e.g., they explained the Pain in their greeting), DO NOT ask about it again. Validate it and move to the next letter. - FLOW: Start with IDENTIFY PAIN. Then move to Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition. - CONCISE: Keep questions under 20 words. No conversational filler. ### RESPONSE FORMAT Return ONLY JSON. If 'end_of_call' is false: { "next_question": "Your question here", "end_of_call": false } If 'end_of_call' is true: { "next_question": "Review complete.", "total_score": 19, "end_of_call": true, "summary": { "total_deal_score": 19, "number_one_risk": "Identify the biggest gap.", "one_clear_next_step": "One specific action.", "closing": "Good luck, Erik. Goodbye." } }`; }

// --- 5. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  const callSid = req.body.CallSid || "test_session";
  const userSpeech = req.body.SpeechResult || "";

  try {
    // A. INITIAL GREETING
    if (!sessions[callSid]) {
      const introText = "Hi Erik, let's review the Global Tech deal in commit for $84,000. To start, what specific pain or business challenge is driving this migration?";
      sessions[callSid] = [{ role: "assistant", content: introText }];

      let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>`;
      twiml += `<Say voice="Polly.Matthew-Neural">${makeFriendlyForMatthew(introText)}</Say>`;
      twiml += `<Gather input="speech" action="/agent" method="POST" speechTimeout="1" speechModel="phone_call" enhanced="true" />`;
      twiml += `</Response>`;

      res.type('text/xml');
      return res.send(twiml);
    }

// --- B. SUBSEQUENT TURNS (Corrected) ---
    
    // 1. Retrieve history (With crash prevention)
    let messages = sessions[callSid] || [];

    // 2. Add the user's new speech to history
    messages.push({ role: "user", content: userSpeech });

    // 3. Call the API using your Environment Variables
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-haiku-20240307",
        max_tokens: 1000,
        system: agentSystemPrompt(),
        messages: messages,
      },
      {
        headers: {
          "x-api-key": process.env.MODEL_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      }
    );
    // --- C. PARSE RESPONSE ---
    // (The rest of your code remains the same)
    // --- C. PARSE RESPONSE ---
    // C. PARSE RESPONSE (Anthropic Style)
    let rawText = response.data.content[0].text.trim();
    
    // Safety check: Claude sometimes wraps JSON in markdown blocks
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

    let agentResult;
    try {
      agentResult = JSON.parse(rawText);
    } catch (e) {
      console.error("Haiku JSON Parse Error", rawText);
      agentResult = { next_question: "I missed that, Erik. Can you say it again?", end_of_call: false };
    }

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
    } else {
      const speech = makeFriendlyForMatthew(agentResult.next_question);
      twiml += `<Say voice="Polly.Matthew-Neural">${speech || "Moving on..."}</Say>`;
      twiml += `<Gather input="speech" action="/agent" method="POST" speechTimeout="1" speechModel="phone_call" enhanced="true" />`;
    }

    twiml += `</Response>`;
    res.type('text/xml');
    res.send(twiml);

  } catch (error) {
    console.error("AGENT ERROR:", error.message);
    res.type('text/xml');
    res.send("<Response><Say voice='Polly.Matthew-Neural'>Snag detected. Please try again later.</Say></Response>");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));

