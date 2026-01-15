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
// ===============================
// AGENT ENDPOINT
// ===============================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";

    // Scrubbing inputs to prevent hidden space errors
    const cleanUrl = process.env.MODEL_API_URL.trim();
    const cleanModel = process.env.MODEL_NAME.trim();
    const cleanKey = process.env.MODEL_API_KEY.trim();

    console.log(`Calling Anthropic... Model: [${cleanModel}]`);

    const response = await axios.post(
      cleanUrl,
      {
        model: cleanModel,
        system: agentSystemPrompt(),
        messages: [
          {
            role: "user",
            content: transcript
          }
        ],
        max_tokens: 1024
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cleanKey,
          "anthropic-version": "2023-06-01"
        }
      }
    );

    // 1. Get the raw text from Claude
    let rawText = response.data.content[0].text.trim();

    // 2. THE CLEANER: This strips away ```json or ``` backticks if Claude adds them
    if (rawText.startsWith("```")) {
      rawText = rawText
        .replace(/^```json/, "") // Removes the starting ```json
        .replace(/^```/, "")     // Removes starting ``` if no 'json' word
        .replace(/```$/, "")     // Removes the ending ```
        .trim();                 // Cleans up any leftover spaces
    }

    try {
      // 3. Turn the cleaned text into a real Javascript object
      const agentResult = JSON.parse(rawText);
      res.json(agentResult);
    } catch (parseError) {
      console.error("JSON Parse Error. Claude sent:", rawText);
      res.status(500).json({ error: "Claude sent back text instead of clean data." });
    }

  } catch (err) {
    console.error("Agent error detail:", err.response?.data || err.message);
    res.status(500).json({
      next_question: "System error — let's try again in a moment.",
      end_of_call: false,
      risk_flags: ["connection_error"]
    });
  }
});// ===============================
// PORT BINDING
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent live on port ${PORT}`);
});