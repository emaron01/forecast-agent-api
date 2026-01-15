require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server file loaded");

// ======================================================
// TEMPORARY DEAL DATA (REMOVE AFTER CRM INTEGRATION)
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
  },
  {
    id: "D-002",
    repName: "Erik Thompson",
    account: "Northwind Logistics",
    opportunityName: "Routing Optimization Suite",
    product: "SalesForecast.io Core",
    forecastCategory: "Upside",
    closeDate: "2026-03-01"
  },
  {
    id: "D-003",
    repName: "Erik Thompson",
    account: "Brightline Health",
    opportunityName: "Care Coordination Platform",
    product: "SalesForecast.io Enterprise",
    forecastCategory: "Commit",
    closeDate: "2026-02-28"
  }
];

// ======================================================
// SYSTEM PROMPT
// ======================================================
function agentSystemPrompt() {
  return `You are the SalesForecast.io Forecast Confidence Agent.

Your mission:
- Ask one MEDDPICC-aligned question at a time.
- Score each answer (0–3).
- Maintain and update conversation state.
- Identify risks and uncertainties.
- Coach like a real sales leader: conversational, probing, clarifying.
- Never repeat the same question more than once.
- Produce JSON only.

====================================================
CONVERSATIONAL COACHING RULES
====================================================
- You are a forecast coach, not a survey bot.
- Use natural, conversational language.
- If the rep gives a vague or incomplete answer:
  1. Ask ONE clarifying question.
  2. If still unclear, move on.
- Never ask the same question twice.

====================================================
SILENCE HANDLING RULES
====================================================
- First silence: ask a brief check-in.
- Second silence: set "end_of_call": true.

====================================================
JSON RESPONSE CONTRACT
====================================================
Return ONLY valid JSON:

{
  "next_question": "string",
  "score_update": { "metric": "string", "score": 0-3 },
  "state": { "updated_state": true },
  "risk_flags": [],
  "make_webhook_payload": { "log": true },
  "end_of_call": false
}`;
}

// ======================================================
// AGENT ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    const history = req.body.history || [];

    // DEBUG INPUT
    console.log("DEBUG INPUT:", { transcript, history });

    // Build messages array
    let messages = [...history];

    // TEMPORARY DEAL INJECTION (first turn only)
    const currentDeal = deals[0];

    if (history.length === 0 && !transcript.trim()) {
      messages.push({
        role: "user",
        content: `
CONVERSATION START:
You are the Virtual VP calling ${currentDeal.repName} about their ${currentDeal.account} opportunity.

Deal context:
- Opportunity: ${currentDeal.opportunityName}
- Product: ${currentDeal.product}
- Forecast Category: ${currentDeal.forecastCategory}
- Close Date: ${currentDeal.closeDate}

Start with a natural greeting and your first MEDDPICC question.
Do NOT assume MEDDPICC details — uncover them.`
      });
    }

    // Add transcript if present
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // ======================================================
    // OPENAI CALL
    // ======================================================
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        messages: [
          { role: "system", content: agentSystemPrompt() },
          ...messages
        ],
        max_tokens: 1024
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        }
      }
    );

    // DEBUG RAW RESPONSE
    console.log("RAW OPENAI RESPONSE:", response.data);

    let rawText = response.data.choices[0].message.content.trim();

    // Strip code fences if present
    if (rawText.startsWith("```")) {
      rawText = rawText
        .replace(/^```json/, "")
        .replace(/^```/, "")
        .replace(/```$/, "")
        .trim();
    }

    const agentResult = JSON.parse(rawText);

    return res.json(agentResult);

  } catch (err) {
    console.error("AGENT ERROR:", err.response?.data || err.message);

    return res.status(500).json({
      next_question: "I'm having a technical glitch. Let's touch base later.",
      end_of_call: true
    });
  }
});

// ======================================================
// PORT BINDING
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent live on port ${PORT}`);
});