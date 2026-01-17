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
    // 1. EXTRACT (Handles both 'transcript' and 'SpeechResult' names)
    const transcript = req.body.transcript || req.body.SpeechResult || "";
    let rawHistory = req.body.history || "[]";
    let messages = [];

    // 2. RAW PARSE & CLEAN (The "Magic" Step)
    try {
      if (typeof rawHistory === 'string' && rawHistory !== "[]") {
        let cleaned = rawHistory;
        
        // Remove surrounding quotes if Twilio wrapped the whole array
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
          cleaned = cleaned.substring(1, cleaned.length - 1);
        }
        
        // Fix the backslashes (e.g., \" becomes ")
        cleaned = cleaned.replace(/\\"/g, '"');
        
        messages = JSON.parse(cleaned);
      } else {
        messages = Array.isArray(rawHistory) ? rawHistory : [];
      }
    } catch (e) {
      console.log("[SERVER] History parse failed, starting fresh context.");
      messages = [];
    }

    // 3. ADD REP'S ANSWER
    if (transcript && transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    console.log(`[SERVER] Success. History Turn Count: ${messages.length}`);
    
    // ... Proceed to Section 5 (OpenAI Call)
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
