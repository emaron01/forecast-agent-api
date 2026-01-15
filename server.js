require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server file loaded - OpenAI Mode");

// ======================================================
// MOCK CRM DATA
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

// ======================================================
// SYSTEM PROMPT
// ======================================================
function agentSystemPrompt() {
  return `You are the SalesForecast.io Forecast Confidence Agent.
Your mission:
- Ask one MEDDPICC-aligned question at a time.
- Score each answer (0–3).
- Identify risks and uncertainties.
- Coach like a real sales leader: conversational, probing, clarifying.
- Produce JSON only.

REQUIRED JSON FORMAT:
{
  "next_question": "string",
  "score_update": { "metric": "string", "score": 0-3 },
  "state": { "updated_state": true },
  "risk_flags": [],
  "end_of_call": false
}
Rules: No markdown, no backticks, no prose outside the JSON.`;
}

// ======================================================
// AGENT ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    const history = req.body.history || [];
    let messages = [...history];
    const currentDeal = deals[0];

    // --- TURN 1 LOGIC: Inject Context ---
    if (messages.length === 0) {
      const initialContext = `CONVERSATION START: You are the Virtual VP calling ${currentDeal.repName} about the ${currentDeal.account} deal (${currentDeal.opportunityName}). Start with a greeting and a MEDDPICC question.`;
      
      const combinedContent = transcript.trim() 
        ? `${initialContext}\n\nRep says: "${transcript}"` 
        : initialContext;

      messages.push({ role: "user", content: combinedContent });
    } else if (transcript.trim()) {
      // --- TURN 2+ LOGIC: standard follow-up ---
      messages.push({ role: "user", content: transcript });
    }

    // --- CALL OPENAI ---
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        messages: [
          { role: "system", content: agentSystemPrompt() },
          ...messages
        ],
        max_tokens: 800,
        temperature: 0
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        }
      }
    );

    // --- PARSE RESPONSE ---
    let rawText = response.data.choices[0].message.content.trim();
    
    // Clean code fences if the AI ignores the "JSON ONLY" rule
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const agentResult = JSON.parse(rawText);
    res.json(agentResult);

  } catch (err) {
    console.error("OPENAI ERROR:", err.response?.data || err.message);
    
    res.status(500).json({ 
      next_question: "Connection issue with the AI brain.", 
      error_detail: err.message,
      end_of_call: true 
    });
  }
});

// ======================================================
// SERVER START
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));