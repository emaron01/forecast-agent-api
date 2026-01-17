require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 2. MIDDLEWARE ---
// Handles Twilio's form-encoded data (Required for the 400 error fix)
app.use(express.urlencoded({ extended: true })); 
// Handles standard JSON payloads
app.use(express.json());

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

require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 2. MIDDLEWARE ---
// Handles Twilio's form-encoded data (Required for the 400 error fix)
app.use(express.urlencoded({ extended: true })); 
// Handles standard JSON payloads
app.use(express.json());

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
    const transcript = req.body.transcript || req.body.SpeechResult || "";
    let rawHistory = req.body.history || "[]";
    let messages = [];

// 1. DEEP CLEAN HISTORY
    try {
      if (typeof rawHistory === 'string' && rawHistory.length > 5) {
        let cleaned = rawHistory.trim();
        // Remove outer quotes added by Twilio
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
          cleaned = cleaned.substring(1, cleaned.length - 1);
        }
        // Use regex to fix double and triple escaped quotes and newlines
        cleaned = cleaned.replace(/\\"/g, '"')
                         .replace(/\\\\"/g, '"')
                         .replace(/\\n/g, " ")
                         .replace(/\\\\/g, '\\');

        messages = JSON.parse(cleaned);
      } else {
        messages = Array.isArray(rawHistory) ? rawHistory : [];
      }
    } catch (e) {
      console.log(`[SERVER] History parse failed. Attempting recovery...`);
      // Emergency recovery: keep the conversation moving even if history breaks
      messages = [{ role: "user", content: "Continue review. Last rep response: " + transcript }];
    }

    // 2. INITIALIZE CONTEXT OR ADD REP RESPONSE
    if (messages.length === 0) {
      const initialContext = `CONVERSATION START: Reviewing 3 deals with Erik Thompson.\nDEALS:\n- GlobalTech Industries: Workflow Automation Expansion (Commit)\n- CyberShield Solutions: Security Infrastructure Upgrade (Best Case)\n- DataStream Corp: Analytics Platform Migration (Pipeline)\nStart with GlobalTech Industries.`;
      messages.push({ role: "user", content: initialContext });
    } else if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    console.log(`[SERVER] Processing. History Count: ${messages.length}`);

    // 3. CALL OPENAI
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

// 4. PARSE & CLEANUP
    let rawText = response.data.choices[0].message.content.trim();
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const agentResult = JSON.parse(rawText);
    
    // Stringify the agentResult specifically to ensure quotes are escaped 
    // correctly before adding to the messages array
    messages.push({ role: "assistant", content: JSON.stringify(agentResult) });

    // 5. RESPOND TO TWILIO
    console.log(`[SERVER] Success. History Turn Count: ${messages.length}`);
    res.json({
      next_question: agentResult.next_question,
      coaching_tip: agentResult.coaching_tip || "",
      score: agentResult.score || 0,
      risk_flags: agentResult.risk_flags || [],
      end_of_call: agentResult.end_of_call || false,
      new_history: JSON.stringify(messages)
    });

  } catch (error) {
    console.error("AGENT ERROR:", error.response?.data || error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        next_question: "I'm having a connection issue. One moment.", 
        end_of_call: false 
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));




