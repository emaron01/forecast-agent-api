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

// --- 4. SYSTEM PROMPT (Preserves Matthew Persona + Strict JSON) ---
function agentSystemPrompt() {
  return `You are a backend sales forecasting API. You process user speech and return a structured JSON response.

### IMPORTANT: OUTPUT FORMAT
You must return ONLY a valid JSON object. Do not include preamble, markdown, or conversational filler outside the JSON.

### JSON STRUCTURE
{
  "next_question": "Your response here (acting as Matthew).",
  "end_of_call": false
}

OR (if all steps complete):
{
  "next_question": "Review complete.",
  "total_score": 0-100,
  "end_of_call": true,
  "summary": { 
      "total_deal_score": 0,
      "number_one_risk": "Risk details",
      "one_clear_next_step": "Next step",
      "closing": "Closing details"
  }
}

### YOUR CORE LOGIC (MATTHEW'S BRAIN)
### ROLE
You are a supportive, high-level Sales Forecasting Agent (Matthew). You are skeptical in your analysis but professional. You want the rep to succeed.

### RULES
- EVIDENCE-BASED GRADING: Do not accept "feelings." Look for concrete actions. If evidence is missing, you MUST assume the category is a RISK.
- SKEPTICISM (Jan 17): Do not assume a category is "strong" unless specific evidence (names, dates, metrics) is provided. If the rep is vague, assume it is a RISK and probe deeper once.
- NEUTRALITY CHECK (CHAMPION TEST): Verify if a Champion is a true advocate for OUR solution specifically. If they help all partners equally, they are a RISK.
- PROBING: If an answer is vague or lacks evidence, probe deeper ONCE. After that—regardless of the answer—move on to maintain momentum.
- SMART SKIPPING: If the user has already answered a future category (e.g., they explained the Pain in their greeting), DO NOT ask about it again. Validate it and move to the next letter.
- FLOW: Start with IDENTIFY PAIN. Then move to Metrics -> Champion -> Economic Buyer -> Decision Criteria -> Decision Process -> Paper Process -> Competition.
- CONCISE: Keep questions under 20 words. No conversational filler.

### INSTRUCTION
Take the user's input, apply the RULES above, and generate "Matthew's" response. Then, place that response into the 'next_question' field of the JSON object.`;
}

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
      // Rate="110%" makes him faster/more energetic. // Pitch="-5%" tries to lower the voice (Neural might ignore this). twiml += `<Say voice="Polly.Matthew-Neural"> <prosody rate="110%" pitch="-5%"> ${makeFriendlyForMatthew(introText)} </prosody> </Say>`;
twiml += `<Gather input="speech" action="/agent" method="POST" speechTimeout="1" speechModel="phone_call" enhanced="true" />`;
      twiml += `</Response>`;

      res.type('text/xml');
      return res.send(twiml);
    }

// --- B. SUBSEQUENT TURNS ---
    
    // 1. Retrieve history (Safety check to prevent crash)
    let messages = sessions[callSid] || [];

    // 2. Add the user's new speech to history
    messages.push({ role: "user", content: userSpeech });

    // 3. Call the API
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-haiku-20240307",
        max_tokens: 1000,
        temperature: 0,              // <--- THIS IS THE NEW LINE
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
    // --- C. PARSE RESPONSE (Smart JSON Finder) ---
    // Anthropic returns data in response.data.content[0].text
    let rawText = response.data.content[0].text.trim();
    
    // 1. Find the start '{' and end '}' of the JSON object
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    
    let agentResult;
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
      // Extract ONLY the JSON part
      const jsonString = rawText.substring(jsonStart, jsonEnd + 1);
      try {
        agentResult = JSON.parse(jsonString);
      } catch (e) {
        console.error("JSON Parse Failed:", rawText);
        agentResult = { next_question: "I'm having trouble connecting. One moment.", end_of_call: false };
      }
    } else {
      // Fallback: If no JSON found, treat the raw text as the question
      // This saves the call even if the model messes up the format completely
      console.warn("No JSON found, using raw text");
      agentResult = { next_question: rawText, end_of_call: false };
    }
    // D. SAVE TO MEMORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

    // --- E. RESPOND TO TWILIO ---
    let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>`;

    // Voice Settings: Speed 110%, Pitch -5%
    const PROSODY = '<prosody rate="110%" pitch="-5%">';
    const PROSODY_END = '</prosody>';

    if (agentResult.end_of_call === true) {
      const s = agentResult.summary;
      let finalSpeech = "";

      if (s && s.total_deal_score) {
        finalSpeech = `Review complete. Your total score is ${s.total_deal_score}. The top risk is ${s.number_one_risk}. Your next step is ${s.one_clear_next_step}. ${s.closing}`;
      } else {
        const score = agentResult.total_score || "calculated";
        finalSpeech = `Review complete. Your total score is ${score}. I recommend reviewing your gaps. Good luck, Erik.`;
      }

      twiml += `<Say voice="Polly.Matthew-Neural">${PROSODY}${makeFriendlyForMatthew(finalSpeech)}${PROSODY_END}</Say>`;
      twiml += `<Hangup />`;
    } else {
      const speech = makeFriendlyForMatthew(agentResult.next_question);
      
      twiml += `<Say voice="Polly.Matthew-Neural">${PROSODY}${speech || "Moving on..."}${PROSODY_END}</Say>`;
      
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
