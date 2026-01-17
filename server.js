require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

console.log("Final Verified Server - MEDDPICC Coaching Engine Live");

// 1. MOCK CRM DATA
const deals = [
  { id: "D-001", repName: "Erik Thompson", account: "GlobalTech Industries", opportunityName: "Workflow Automation Expansion", product: "SalesForecast.io Enterprise", forecastCategory: "Commit", closeDate: "2026-02-15" },
  { id: "D-002", repName: "Erik Thompson", account: "CyberShield Solutions", opportunityName: "Security Infrastructure Upgrade", product: "SalesForecast.io Security Suite", forecastCategory: "Best Case", closeDate: "2026-03-01" },
  { id: "D-003", repName: "Erik Thompson", account: "DataStream Corp", opportunityName: "Analytics Platform Migration", product: "SalesForecast.io Analytics", forecastCategory: "Pipeline", closeDate: "2026-03-20" }
];

// 2. SYSTEM PROMPT
function agentSystemPrompt() {
  return `You are the SalesForecast.io Virtual VP of Sales. 
Your mission:
- TURN 1 RULE: Start by presenting the deal details (Account, Name, Category) and then ask the first MEDDPICC question. 
- MISSION: Conduct a high-stakes MEDDPICC deal review. 
- Ask ONLY ONE probing question at a time.
- After the rep answers, provide brief coaching.
- Produce JSON only. No prose, no markdown backticks.

REQUIRED JSON FORMAT:
{
 "account_name": "The account currently being discussed",
 "next_question": "Your next MEDDPICC question",
 "coaching_tip": "Short coaching feedback",
 "score": 0,
 "risk_flags": ["flag1"],
 "end_of_call": false
}`;
}

// --- 3. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    let rawHistory = req.body.history || "[]";
    let messages = [];

    // --- 1. BULLETPROOF HISTORY PARSING ---
    try {
      if (typeof rawHistory === 'string' && rawHistory !== "[]") {
        // Sanitize Twilio's backslashes
        const sanitized = rawHistory.replace(/\\"/g, '"').replace(/^"/, '').replace(/"$/, '');
        messages = JSON.parse(sanitized);
      } else {
        messages = Array.isArray(rawHistory) ? rawHistory : [];
      }
    } catch (e) {
      console.log("[SERVER] History parse failed, starting fresh.");
      messages = [];
    }

    // Keep history manageable
    if (messages.length > 11) {
      messages = [messages[0], ...messages.slice(-10)];
    }

    // --- 2. CONTEXT INJECTION & USER INPUT ---
    if (messages.length === 0) {
      // Hardcoded Opportunity Data
      const initialContext = `CONVERSATION START: Reviewing 3 deals with Erik Thompson.\nDEALS:\n- GlobalTech Industries: Workflow Automation Expansion (Commit)\n- CyberShield Solutions: Security Infrastructure Upgrade (Best Case)\n- DataStream Corp: Analytics Platform Migration (Pipeline)\nStart with GlobalTech Industries.`;
      messages.push({ role: "user", content: initialContext });
    } else if (transcript && transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    console.log(`[SERVER] Processing turn. History Count: ${messages.length}`);

    // --- 3. CALL OPENAI ---
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        messages: [{ role: "system", content: agentSystemPrompt() }, ...messages],
        max_tokens: 500,
        temperature: 0.2
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        }
      }
    );

    // --- 4. PARSE & CLEANUP ---
    let rawText = response.data.choices[0].message.content.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const agentResult = JSON.parse(rawText);
    const cleanQuestion = agentResult.next_question;

    // --- 5. THE LOOP BREAKER (Update History) ---
    // Add the AI's current response to the array so it's remembered next turn
    messages.push({ role: "assistant", content: rawText });

    // --- 6. FINAL RESPONSE TO TWILIO ---
    console.log(`[SERVER] Success. History Turn Count: ${messages.length}`);
    
    return res.json({
      next_question: cleanQuestion,
      coaching_tip: agentResult.coaching_tip || "",
      score: agentResult.score || 0,
      risk_flags: agentResult.risk_flags || [],
      end_of_call: agentResult.end_of_call || false,
      new_history: JSON.stringify(messages) // History is now "packed" for Twilio
    });

  } catch (err) {
    console.error("AGENT ERROR:", err.response?.data || err.message);
    if (!res.headersSent) {
      return res.status(500).json({ 
        next_question: "I'm having trouble connecting. Let's try again in a moment.", 
        end_of_call: true 
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));