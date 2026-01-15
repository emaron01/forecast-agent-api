require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server file loaded");

// ======================================================
// TEMPORARY: PLACEHOLDER DEAL DATA (REMOVE AFTER CRM INTEGRATION)
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

    // 🔍 DEBUG: Confirm what Thunder is sending
    console.log("DEBUG INPUT:", { transcript, history });

    // Build message array from history
    let messages = [...history];

    // ======================================================
    // TEMPORARY: SELECT FIRST DEAL (REMOVE AFTER CRM INTEGRATION)
    // ======================================================
    const currentDeal = deals[0];

    // ======================================================
    // TEMPORARY: FIRST-TURN DEAL INJECTION (REMOVE AFTER CRM INTEGRATION)
    // ======================================================
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

Start the call with a natural greeting and your first MEDDPICC question.
Do NOT assume MEDDPICC details — you must uncover them during the conversation.
`
      });
    }

    // Add transcript if present
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // OpenAI API call
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

    let rawText = response.data.choices[0].message.content.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText
        .replace(/^```json/, "")
        .replace(/^```/, "")
        .replace(/```$/, "")
        .trim();
    }

    const agentResult = JSON.parse(rawText);

    res.json(agentResult);

 } catch (err) {
    console.error("AGENT ERROR:", err.response?.data || err.message);

    res.status(500).json({
      next_question: "I'm having a technical glitch. Let's touch base later.",
      end_of_call: true
    });
  }
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