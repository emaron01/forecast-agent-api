require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

console.log("Final Verified Server - MEDDPICC Coaching Engine Live");

// ======================================================
// 1. MOCK CRM DATA
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
// 2. SYSTEM PROMPT (Coaching & JSON Logic)
// ======================================================
function agentSystemPrompt() {
  const dealList = deals.map(d => `- ${d.account}: ${d.opportunityName} (${d.forecastCategory})`).join("\n");
  
  return `You are the SalesForecast.io Virtual VP of Sales. 
Your mission:
- TURN 1 RULE: If this is the start of the call, your "next_question" MUST start by presenting the deal details (Account, Name, Category) and then ask the first MEDDPICC question. 
- MISSION: Conduct a high-stakes MEDDPICC deal review. 
- Ask ONLY ONE probing question at a time.- After the rep answers, provide brief coaching (e.g., "Good, but we need the EB sign-off").
- Score the response (0-3) on the specific MEDDPICC metric discussed.
- Identify risk_flags (e.g., "No Champion").
- Produce JSON only. No prose, no markdown backticks.

REQUIRED JSON FORMAT:
{
  "account_name": "The account currently being discussed",
  "next_question": "Your next MEDDPICC question",
  "coaching_tip": "Short coaching feedback",
  "score": 0,
  "risk_flags": ["flag1"],
  "end_of_call": false
}

You MUST include ALL fields every turn.
You MUST NOT end the call on turn 1.
You MUST NOT say the call is complete unless the rep explicitly indicates they are done.
// ======================================================
// 3. AGENT ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    const history = req.body.history || "[]";

    // --- 1. MEMORY GUARD & INITIALIZATION ---
    let messages = [];
    try {
      messages = (typeof history === 'string' && history !== "[]") 
        ? JSON.parse(history) 
        : (Array.isArray(history) ? history : []);
    } catch (e) {
      messages = [];
    }

    // --- 2. MEMORY CAP ---
    if (messages.length > 11) {
      messages = [messages[0], ...messages.slice(-10)];
    }

    // --- 3. CONTEXT & TRANSCRIPT LOGIC ---
    if (messages.length === 0) {
      const dealList = deals.map(d => `- ${d.account}: ${d.opportunityName} (${d.forecastCategory})`).join("\n");
      const initialContext = `CONVERSATION START: Virtual VP reviewing 3 deals with ${deals[0].repName}.\nDEALS:\n${dealList}\nStart by greeting the rep and asking the first MEDDPICC question for GlobalTech Industries.`;
      messages.push({ role: "user", content: initialContext });
    } else if (transcript && transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // --- 4. CALL OPENAI ---
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

// --- 5. PARSE & SSML CLEANUP ---
let rawText = response.data.choices[0].message.content.trim();

// Clean markdown backticks if present
if (rawText.startsWith("```")) {
  rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
}

// 🔍 DEBUG: See exactly what the model returned
console.log("RAW MODEL OUTPUT:", rawText);

const agentResult = JSON.parse(rawText);

// SSML wrapping for Matthew-Neural voice
const cleanQuestion = `<speak><prosody rate="115%" pitch="-2st">${agentResult.next_question}</prosody></speak>`;
 // --- 6. THE LOOP BREAKER --- // We add the AI's response to the messages array BEFORE stringifying messages.push({ role: "assistant", content: rawText }); // --- 7. FINAL RESPONSE --- console.log(`[SERVER] Sending new_history with ${messages.length} turns.`); 
return res.json({
  next_question: cleanQuestion,
  coaching_tip: agentResult.coaching_tip ?? "",
  score: agentResult.score ?? 0,
  risk_flags: agentResult.risk_flags ?? [],
  end_of_call: agentResult.end_of_call ?? false,
  new_history: JSON.stringify(messages)
});
  } catch (err) {
    console.error("AGENT ERROR:", err.response?.data || err.message);
    if (!res.headersSent) {
      return res.status(500).json({ 
        next_question: "Connection issue with the coaching engine.", 
        end_of_call: true 
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));
