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
  "next_question": "Your question here",
  "coaching_tip": "Your feedback here",
  "score": 0-3,
  "risk_flags": ["flag1"]
}`;
}

// ======================================================
// 3. AGENT ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    let history = req.body.history;

    // --- MEMORY GUARD ---
    if (history === "[]" || !history) {
        history = []; 
    } else if (typeof history === 'string') {
        try { history = JSON.parse(history); } catch (e) { history = []; }
    }

    let messages = [...history];

    // --- TURN 1: INITIALIZATION ---
if (messages.length === 0) {
  // The VP (Agent) is "opening the CRM" here. 
  // We feed this as a hidden system instruction so the Agent knows it's time to lead.
  const dealList = deals.map(d => `- ${d.account}: ${d.opportunityName} (${d.forecastCategory})`).join("\n");
  
  messages.push({ 
    role: "system", 
    content: `CRM DATA LOADED: \n${dealList}\n\nLEAD THE CALL: Start by greeting Erik. Mention the first account (GlobalTech) and its category, then immediately ask your first MEDDPICC question. You are leading this meeting.` 
  });
}
else if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // --- 10-TURN MEMORY CAP ---
    if (messages.length > 11) {
      console.log("[MEMORY] Trimming history for performance.");
      messages = [messages[0], ...messages.slice(-10)];
    }

    // --- CALL OPENAI ---
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
    
    // This finds anything between the first { and the last } 
    // to prevent crashes if the AI adds prose or markdown backticks
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI returned malformed response: " + rawText);
    }
    
    const agentResult = JSON.parse(jsonMatch[0]);
    // ======================================================
    // HOOK: DEAL_EVALUATION (The Summary Logic)
    // ======================================================
    const DATA_MARKER = ">>> CRM_UPDATE_REQUIRED <<<";
    const dealHealth = agentResult.score >= 2 ? "HEALTHY" : "RISK";
    
    console.log(`\n${DATA_MARKER}`);
    console.log(`DEAL: ${agentResult.account_name || "GlobalTech"}`);
    console.log(`HEALTH: ${dealHealth} (Score: ${agentResult.score})`);
    console.log(`SUMMARY: ${agentResult.coaching_tip}`);
    console.log(`>>> EVALUATION_END <<<\n`);
    // ======================================================

// --- 4. VOICE PROCESSING (SCORB & SSML) ---
    // Extract the question from the AI result
    const rawQuestion = agentResult.next_question
        .replace(/[&<>"']/g, "")
        .replace(/<[^>]*>/g, ""); 

    // Define cleanQuestion clearly so the res.json can see it
    const cleanQuestion = `<speak><prosody rate="110%" pitch="-2st">${rawQuestion}</prosody></speak>`;

    // --- 5. UPDATE AND RETURN ---
    // Save the AI's response to the conversation history
    messages.push({ role: "assistant", content: rawText });

    // IMPORTANT: Make sure the key is 'next_question' and the value is 'cleanQuestion'
    res.json({
        ...agentResult,
        next_question: cleanQuestion, 
        new_history: JSON.stringify(messages)
    });
// 2. Memory Persistence: Store the AI's response in the history array messages.push({ role: "assistant", content: rawText });
    // 3. Final Payload: Send text and the stringified history back to Twilio
    res.json({
        ...agentResult,
        next_question: cleanQuestion,
        new_history: JSON.stringify(messages)
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
