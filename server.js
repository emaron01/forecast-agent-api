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
  // Define dealList inside so the function can see it
  const dealList = deals.map(d => `- ${d.account}: ${d.opportunityName} (${d.forecastCategory})`).join("\n");
  
  return `You are the SalesForecast.io Virtual VP of Sales. 
Your mission:
- Conduct a high-stakes MEDDPICC deal review for the following deals:
${dealList}
- Ask ONLY ONE probing question at a time to uncover risk.
- After the rep answers, provide brief coaching (e.g., "Good, but we need the Economic Buyer sign-off").
- Score the response (0-3) on the specific MEDDPICC metric discussed.
- Identify risk_flags (e.g., "No Champion", "Vague Metrics").
- Move through the deals methodically.

OUTPUT RULE: You must produce valid JSON ONLY. No prose, no markdown backticks.
REQUIRED JSON FORMAT:
{
  "next_question": "Your question here",
  "coaching_tip": "Your feedback here",
  "score": 0-3,
  "risk_flags": ["flag1", "flag2"]
}`;
}

const agentResult = JSON.parse(rawText);

// ======================================================
    // HOOK: DEAL_EVALUATION_START
    // ======================================================
    
    // We use a "DATA_MARKER" so you can search logs for this specific string later
    const DATA_MARKER = ">>> CRM_UPDATE_REQUIRED <<<";
    
    const dealHealth = agentResult.score >= 2 ? "HEALTHY" : "RISK";
    
    // This block is your "Pre-built" database entry
    const summaryPayload = {
        marker: DATA_MARKER,
        account: agentResult.account_name || "GlobalTech Industries",
        meddpicc_score: agentResult.score,
        health: dealHealth,
        risks: agentResult.risk_flags,
        coaching: agentResult.coaching_tip,
        timestamp: new Date().toISOString()
    };

    // LOGGING WITH MARKERS for easy grep/search in Render
    console.log(`\n${DATA_MARKER}`);
    console.log(`DEAL: ${summaryPayload.account}`);
    console.log(`SCORE: ${summaryPayload.meddpicc_score}`);
    console.log(`SUMMARY: ${summaryPayload.coaching}`);
    console.log(`>>> EVALUATION_END <<<\n`);
    
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

   // --- TURN 1: CONTEXT INJECTION ---
    if (messages.length === 0) {
      // Just push a clean starting point; the agentSystemPrompt handles the deals
      messages.push({ 
        role: "user", 
        content: "I'm ready for my forecast review. Let's start with GlobalTech Industries." 
      });
    } else if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

// ======================================================
    // 10-TURN MEMORY CAP (INSERT HERE)
    // ======================================================
    if (messages.length > 11) {
      console.log("[MEMORY] Trimming history to 10 turns for cost and speed.");
      // We keep messages[0] because it contains the System Prompt (the rules)
      messages = [messages[0], ...messages.slice(-10)];
    }
    // ======================================================

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
