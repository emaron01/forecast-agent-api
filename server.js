require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server live - High-Speed Pro Mode");

// ======================================================
// MOCK CRM DATA (Your "Spreadsheet")
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
// SYSTEM PROMPT GENERATOR
// ======================================================
function agentSystemPrompt(repName, accountName) {
  return `You are the SalesForecast.io Forecast Confidence Agent.
Your mission:
- You are calling ${repName} to discuss the ${accountName} deal.
- Ask one MEDDPICC-aligned question at a time.
- Score each answer (0–3) for MEDDPICC confidence.
- Coach like a real sales leader: conversational, probing, clarifying.
- Produce JSON only.

REQUIRED JSON FORMAT:
{
  "next_question": "string",
  "score_update": { "metric": "string", "score": 0-3 },
  "end_of_call": false
}
Rules: No markdown, no backticks, no prose.`;
}

// ======================================================
// AGENT ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    let messages = Array.isArray(req.body.history) ? req.body.history : [];
    
    // Pick the deal context
    const currentDeal = deals[0]; 
    const repName = currentDeal.repName;
    const account = currentDeal.account;

    console.log(`--- CALL TURN RECEIVED ---`);
    console.log(`Rep: ${repName} | History: ${messages.length} turns`);

    // 1. ADD REP'S RESPONSE TO HISTORY
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // 2. INJECT INITIAL CONTEXT IF BRAND NEW CALL
    if (messages.length === 0) {
      const initialContext = `CONVERSATION START: You are the Virtual VP calling ${repName} about the ${account} deal. Start by saying 'Hi ${repName.split(' ')[0]}' and ask your first MEDDPICC question.`;
      messages.push({ role: "user", content: initialContext });
    }

    // 3. CALL OPENAI
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        messages: [
          { role: "system", content: agentSystemPrompt(repName, account) },
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

    // 4. CLEAN AND PARSE AI RESPONSE
    let rawText = response.data.choices[0].message.content.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const agentResult = JSON.parse(rawText);

    // 5. UPDATE HISTORY WITH AI'S QUESTION
    messages.push({ role: "assistant", content: agentResult.next_question });

    // 6. RETURN SYNCED DATA TO TWILIO FUNCTION
    console.log("Sending response to Twilio...");
    res.json({
      next_question: agentResult.next_question,
      end_of_call: agentResult.end_of_call,
      score_update: agentResult.score_update,
      updated_history: messages 
    });

  } catch (err) {
    console.error("AGENT ERROR:", err.message);
    res.status(500).json({ 
      next_question: "I'm having a technical glitch. Let's talk later.", 
      end_of_call: true,
      updated_history: []
    });
  }
});

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));