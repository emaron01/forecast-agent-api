require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server file loaded");

// ======================================================
// [TODO: CRM_INTEGRATION] 
// This is your mock data. Delete this whole 'deals' array 
// once you connect your real database or spreadsheet.
// ======================================================
const deals = [
  {
    id: "D-001",
    repName: "Erik Thompson",
    account: "GlobalTech Industries",
    opportunityName: "Workflow Automation Expansion",
    product: "SalesForecast.io Enterprise",
    forecastCategory: "Commit",
    closeDate: "2026-02-15"
  }
];

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
- Never repeat the same question more than once.
- Produce JSON only.

====================================================
CONVERSATIONAL COACHING RULES
====================================================
- Use natural, conversational language.
- BE CONCISE: Keep questions under 15 words.
- If the rep is vague, ask ONE clarifying question, then move on.

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
Rules: No markdown, no backticks, no text outside the JSON.`;
}

// ===============================
// AGENT ENDPOINT
// ===============================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    const history = req.body.history || [];
    let messages = [...history];

    // ======================================================
    // [TODO: CRM_LOGIC] 
    // Currently hardcoded to the first deal. 
    // Later, you will use req.body.dealId to find the right deal.
    // ======================================================
    const currentDeal = deals[0];

    // Logic for starting the call vs continuing the call
    if (messages.length === 0) {
      messages.push({
        role: "user",
        content: `CONVERSATION START: You are the Virtual VP calling ${currentDeal.repName} about the ${currentDeal.account} deal (${currentDeal.opportunityName}). Start with a greeting and your first MEDDPICC question.`
      });
      if (transcript.trim()) {
        messages.push({ role: "user", content: transcript });
      }
    } else if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // Call Anthropic
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        system: agentSystemPrompt(),
        messages: messages,
        max_tokens: 200,
        temperature: 0
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.MODEL_API_KEY.trim(),
          "anthropic-version": "2023-06-01"
        }
      }
    );

    // Clean the response (Removes backticks if Claude adds them)
    let rawText = response.data.content[0].text.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
    }

    const agentResult = JSON.parse(rawText);

    // ======================================================
    //[TODO: WEBHOOK_SYNC]
    // This is where you will add code to save the score to your CRM.
    // ======================================================

    res.json(agentResult);

  } catch (err) {
    console.error("Agent error:", err.message);
    res.status(500).json({ 
      next_question: "I'm having a connection issue. Let's try again later.", 
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