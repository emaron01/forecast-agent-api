require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server file loaded");

// ======================================================
// [TODO: CRM_INTEGRATION] 
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

function agentSystemPrompt() {
  return `You are the SalesForecast.io Forecast Confidence Agent.
Your mission:
- Ask one MEDDPICC‑aligned question at a time.
- Score each answer (0–3).
- Produce JSON only.

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

    const currentDeal = deals[0];

    // 1. HANDLE THE START OF THE CALL (Role Alternation Fix)
    if (messages.length === 0) {
      const initialPrompt = `CONVERSATION START: You are the Virtual VP calling ${currentDeal.repName} about the ${currentDeal.account} deal. Start with a greeting and a MEDDPICC question.`;
      const content = transcript.trim() ? `${initialPrompt}\n\nRep says: "${transcript}"` : initialPrompt;
      messages.push({ role: "user", content: content });
    } else if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // 2. CALL CLAUDE 5 FLASH
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: "claude-5-flash-20251210",
        system: agentSystemPrompt(),
        messages: messages,
        max_tokens: 300,
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

    // 3. CLEAN & PARSE JSON
    let rawText = response.data.content[0].text.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const agentResult = JSON.parse(rawText);

    // ======================================================
    // [TODO: WEBHOOK_SYNC] - Save to CRM here later
    // ======================================================

    res.json(agentResult);

  } catch (err) {
    console.error("DETAILED ERROR:", err.response?.data || err.message);
    res.status(500).json({ 
      next_question: "I'm having a connection issue. Let's try again later.", 
      end_of_call: true 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));