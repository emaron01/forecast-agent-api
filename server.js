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

// 3. AGENT ENDPOINT
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    const history = req.body.history || "[]";

    let messages = [];
    try {
      messages = (typeof history === 'string' && history !== "[]") 
        ? JSON.parse(history) 
        : (Array.isArray(history) ? history : []);
    } catch (e) {
      messages = [];
    }

    if (messages.length > 11) {
      messages = [messages[0], ...messages.slice(-10)];
    }

    if (messages.length === 0) {
      const dealList = deals.map(d => `- ${d.account}: ${d.opportunityName} (${d.forecastCategory})`).join("\n");
      const initialContext = `CONVERSATION START: Reviewing 3 deals with ${deals[0].repName}.\nDEALS:\n${dealList}\nStart with GlobalTech Industries.`;
      messages.push({ role: "user", content: initialContext });
    } else if (transcript && transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

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

// --- 5. PARSE & SSML CLEANUP ---
    let rawText = response.data.choices[0].message.content.trim();
    
    // Clean markdown backticks if present (prevents JSON.parse errors)
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    // Parse the AI's JSON response
    const agentResult = JSON.parse(rawText);
    
    // Wrap ONLY the next_question in SSML for the voice engine
    const cleanQuestion = `<speak><prosody rate="115%" pitch="-2st">${agentResult.next_question}</prosody></speak>`;

    // --- 6. THE LOOP BREAKER (Update History) ---
    // This adds the AI's current response to the history array
    messages.push({ role: "assistant", content: rawText });

    // --- 7. FINAL RESPONSE ---
    // Log for debugging in Render
    console.log(`[SERVER] Success. History Turn Count: ${messages.length}`);
    
    return res.json({
      next_question: cleanQuestion,
      coaching_tip: agentResult.coaching_tip || "",
      score: agentResult.score || 0,
      risk_flags: agentResult.risk_flags || [],
      end_of_call: agentResult.end_of_call || false,
      new_history: JSON.stringify(messages) // The history is now "packed" for Twilio
    });
  } catch (err) {
    console.error("AGENT ERROR:", err.response?.data || err.message);
    if (!res.headersSent) {
      return res.status(500).json({ 
        next_question: "Connection issue.", 
        end_of_call: true 
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));
