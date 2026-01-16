require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server live - Pro Mode Active");

// ======================================================
// MOCK CRM DATA
// ======================================================
const deals = [
  {
    repName: "Erik Thompson",
    account: "GlobalTech Industries"
  }
];

// ======================================================
// SYSTEM PROMPT
// ======================================================
function agentSystemPrompt(repName, accountName) {
  return `You are a Sales Forecast AI. Calling ${repName} about the ${accountName} deal.
Mission: Ask one MEDDPICC question at a time. 
Output ONLY valid JSON in this format:
{
  "next_question": "string",
  "score_update": { "metric": "string", "score": 0-3 },
  "end_of_call": false
}
If the conversation is finishing, set end_of_call to true.`;
}

// ======================================================
// MAIN ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    let messages = Array.isArray(req.body.history) ? req.body.history : [];
    
    const currentDeal = deals[0]; 

    // 1. ADD USER RESPONSE TO HISTORY
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // 2. INITIALIZE IF NEW CALL
    if (messages.length === 0) {
      messages.push({ role: "user", content: `CONVERSATION START: Hi ${currentDeal.repName.split(' ')[0]}, let's talk about ${currentDeal.account}.` });
    }

    // 3. CALL OPENAI
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        messages: [
          { role: "system", content: agentSystemPrompt(currentDeal.repName, currentDeal.account) },
          ...messages
        ],
        temperature: 0
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        }
      }
    );

    // 4. ROBUST PARSING (Prevents the 500 Error)
    let rawText = response.data.choices[0].message.content.trim();
    let agentResult;

    try {
      // Find JSON boundaries in case AI adds extra text
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      // Fallback if AI goes off-script
      agentResult = {
        next_question: rawText.replace(/[{}]/g, ""), 
        score_update: { metric: "General", score: 0 },
        end_of_call: rawText.toLowerCase().includes("bye")
      };
    }

    // 5. UPDATE HISTORY WITH AI RESPONSE
    messages.push({ role: "assistant", content: agentResult.next_question });

    // 6. SYNC BACK TO TWILIO
    res.json({
      next_question: agentResult.next_question,
      end_of_call: agentResult.end_of_call,
      score_update: agentResult.score_update,
      updated_history: messages 
    });

  } catch (err) {
    console.error("CRITICAL ERROR:", err.message);
    res.status(500).json({ 
      next_question: "Sorry, I hit a snag. Let's try again in a minute.", 
      end_of_call: true,
      updated_history: []
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));