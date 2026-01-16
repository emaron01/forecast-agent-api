require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

console.log("Final Verified Server - MEDDPICC Coaching Engine Live");

// ======================================================
// 1. MOCK CRM DATA (Restored & Expanded to 3 Deals)
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
    account: "CyberShield Solutions",
    opportunityName: "Security Infrastructure Upgrade",
    product: "SalesForecast.io Security Suite",
    forecastCategory: "Best Case",
    closeDate: "2026-03-01"
  },
  {
    id: "D-003",
    repName: "Erik Thompson",
    account: "DataStream Corp",
    opportunityName: "Analytics Platform Migration",
    product: "SalesForecast.io Analytics",
    forecastCategory: "Pipeline",
    closeDate: "2026-03-20"
  }
];

// ======================================================
// 2. SYSTEM PROMPT (Coaching, MEDDPICC, & JSON Logic)
// ======================================================
function agentSystemPrompt() {
  return `You are the SalesForecast.io Virtual VP of Sales. 
Your mission:
- Conduct a high-stakes MEDDPICC deal review for the provided deals.
- Ask ONLY ONE probing question at a time to uncover risk.
- After the rep answers, provide brief coaching (e.g., "Good, but we need the Economic Buyer sign-off").
- Score the response (0-3) on the specific MEDDPICC metric discussed.
- Identify risk_flags (e.g., "No Champion", "Vague Metrics").
- Move through the deals methodically.
- Produce JSON only. No prose, no markdown backticks.

REQUIRED JSON FORMAT:
{
 "next_question": "Your coaching + your next question",
 "score_update": { "metric": "string", "score": 0-3 },
 "risk_flags": [],
 "end_of_call": false
}`;
}

// ======================================================
// 3. AGENT ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";

    // --- MEMORY GUARD (Standardizes history from Twilio) ---
    let history = req.body.history;
    if (history === "[]" || !history) {
        history = []; 
    } else if (typeof history === 'string') {
        try {
            history = JSON.parse(history);
        } catch (e) {
            history = [];
        }
    }

    let messages = [...history];

    // --- TURN 1: CONTEXT INJECTION (3 Deals + Greeting) ---    if (messages.length === 0) {
      const dealList = deals.map(d => `- ${d.account}: ${d.opportunityName} (${d.forecastCategory})`).join("\n");
      const initialContext = `CONVERSATION START: Reviewing 3 deals for ${deals[0].repName}.
DEALS TO REVIEW:
${dealList}

Start by greeting the rep and starting the MEDDPICC review for GlobalTech Industries.`;
      
      messages.push({ role: "user", content: initialContext });
    } else if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // --- CALL OPENAI (Using your secure env variables) ---
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        messages: [{ role: "system", content: agentSystemPrompt() }, ...messages],
        max_tokens: 800,
        temperature: 0.2 
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
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const agentResult = JSON.parse(rawText);

    // --- MATTHEW-NEURAL SAFETY (Crash Protection) ---
    agentResult.next_question = agentResult.next_question.replace(/[&<>"']/g, "");

    // --- UPDATE HISTORY & RESPOND ---
    messages.push({ role: "assistant", content: rawText });
    
    res.json({
        ...agentResult,
        new_history: JSON.stringify(messages) // Essential for Twilio memory
    });

  } catch (err) {
    console.error("AGENT ERROR:", err.response?.data || err.message);
    res.status(500).json({ 
      next_question: "Connection issue with the coaching engine.", 
      end_of_call: true 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));