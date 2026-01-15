require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server file loaded");

// ===============================
// SYSTEM PROMPT
// ===============================
function agentSystemPrompt() {
  return `You are the SalesForecast.io Forecast Confidence Agent.

Your mission:
- Ask one MEDDPICC‑aligned question at a time.
- Score each answer (0–3).
- Maintain and update conversation state.
- Identify risks and uncertainties.
- Coach like a real sales leader: conversational, probing, clarifying.
- Never repeat the same question more than once. If unclear, ask a clarifying question, then move forward.
- Produce JSON only.

====================================================
CONVERSATIONAL COACHING RULES
====================================================
- You are a forecast coach, not a survey bot.
- Use natural, conversational language.
- If the rep gives a vague or incomplete answer:
  1. Ask ONE clarifying question.
  2. If still unclear, move on to the next MEDDPICC area.
- Never ask the same question more than once.
- Avoid robotic phrasing. Keep it human and professional.

====================================================
SILENCE HANDLING RULES
====================================================
- On the FIRST silence event: Ask a brief, professional check‑in. Do not advance the question.
- On the SECOND consecutive silence event: Set "end_of_call": true and provide a closing message.

====================================================
JSON RESPONSE CONTRACT
====================================================
You MUST return ONLY valid JSON in this exact structure:

{
  "next_question": "string",
  "score_update": { "metric": "string", "score": 0-3 },
  "state": { "updated_state": true },
  "risk_flags": [],
  "make_webhook_payload": { "log": true },
  "end_of_call": false
}

Rules:
- Never include commentary outside the JSON.
- Never include markdown or explanations outside the JSON.
`;
}

// ===============================
// AGENT ENDPOINT
// ===============================

app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    const history = req.body.history || []; 

    // CRM CONTEXT
    const deal = { repName: "Sarah", account: "Global Tech", amount: "$120k" };

    let messages = [...history];

    // LOGIC: If history is empty and no transcript, it's the very first second of the call
    if (messages.length === 0 && !transcript.trim()) {
      messages.push({
        role: "user",
        content: `CONVERSATION START: You are the Virtual VP calling ${deal.repName} about the ${deal.account} deal (${deal.amount}). Start the review now with a greeting and your first MEDDPICC question.`
      });
    } else if (transcript.trim()) {
      // Add the rep's latest response to the history
      messages.push({ role: "user", content: transcript });
    }

    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        system: agentSystemPrompt(),
        messages: messages,
        max_tokens: 1024
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.MODEL_API_KEY.trim(),
          "anthropic-version": "2023-06-01"
        }
      }
    );

    let rawText = response.data.content[0].text.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
    }
    
    const agentResult = JSON.parse(rawText);

    // IMPORTANT: In your Twilio script, after receiving this 'agentResult', 
    // you should add { "role": "assistant", "content": agentResult.next_question } 
    // to your history array before the next turn.

    res.json(agentResult);

  } catch (err) {
    console.error("Agent error:", err.message);
    res.status(500).json({ 
      next_question: "I'm having a technical glitch. Let's touch base later.", 
      end_of_call: true 
    });
  }
});

// ===============================
// PORT BINDING
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent live on port ${PORT}`);
});
