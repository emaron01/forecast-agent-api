require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

// Initialize the SDK with your API Key
const anthropic = new Anthropic({
  apiKey: process.env.MODEL_API_KEY.trim(),
});

console.log("Server file loaded with Anthropic SDK");

// ======================================================
// [MOCK CRM DATA]
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
- Ask one MEDDPICC-aligned question at a time.
- Score each answer (0-3).
- Identify risks and uncertainties.
- Coach like a real sales leader: conversational, probing, clarifying.
- Produce JSON only.

JSON STRUCTURE REQUIRED:
{
  "next_question": "string",
  "score_update": { "metric": "string", "score": 0-3 },
  "state": { "updated_state": true },
  "risk_flags": [],
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

    // --- 1. HANDLE START VS ONGOING (Role Fix) ---
    if (messages.length === 0) {
      // First turn: Merge instructions and rep words into ONE user message
      const initialPrompt = `CONVERSATION START: You are the Virtual VP calling ${currentDeal.repName} about the ${currentDeal.account} deal. Start with a greeting and your first MEDDPICC question.`;
      const combinedContent = transcript.trim() 
        ? `${initialPrompt}\n\nRep says: "${transcript}"` 
        : initialPrompt;

      messages.push({ role: "user", content: combinedContent });
    } else if (transcript.trim()) {
      // Turn 2+: Standard user message
      messages.push({ role: "user", content: transcript });
    }

    // --- 2. CALL CLAUDE VIA SDK ---
    // Note: If claude-5-flash-20251210 fails, try "claude-3-5-sonnet-latest"
    const msg = await anthropic.messages.create({
      model: "claude-5-flash-20251210", 
      max_tokens: 500,
      temperature: 0,
      system: agentSystemPrompt(),
      messages: messages,
    });

    // --- 3. CLEAN & PARSE JSON ---
    let rawText = msg.content[0].text.trim();
    
    // Safety check for markdown backticks
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const agentResult = JSON.parse(rawText);
    res.json(agentResult);

  } catch (err) {
    // The SDK provides detailed error objects
    console.error("SDK ERROR:", err);
    
    res.status(500).json({ 
      next_question: "I'm having a connection issue. Let's try again later.", 
      error_detail: err.message,
      end_of_call: true 
    });
  }
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VP Agent Live on port ${PORT}`));