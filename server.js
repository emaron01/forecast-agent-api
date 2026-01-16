require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server live - Conversational Voice Mode Active");

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
// SYSTEM PROMPT (Tuned for conversational flow)
// ======================================================
function agentSystemPrompt(repName, accountName) {
  return `You are a professional Sales VP conducting a forecast review with ${repName} regarding the ${accountName} deal.
  
  STYLE GUIDELINES:
  - Be concise, direct, and conversational.
  - Use contractions (e.g., "I've", "you're", "don't") to sound natural.
  - Use brief acknowledgments like "Got it," "Makes sense," or "Thanks for that" before asking the next question.
  - Ask ONLY one MEDDPICC question at a time.
  
  OUTPUT FORMAT:
  You must output ONLY valid JSON:
  {
    "next_question": "string",
    "score_update": { "metric": "string", "score": 0-3 },
    "end_of_call": false
  }`;
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
        temperature: 0.7 // Increased slightly for more natural variety
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        }
      }
    );

    // 4. ROBUST PARSING
    let rawText = response.data.choices[0].message.content.trim();
    let agentResult;

    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      agentResult = {
        next_question: rawText.replace(/[{}]/g, ""), 
        score_update: { metric: "General", score: 0 },
        end_of_call: rawText.toLowerCase().includes("bye")
      };
    }

    // 5. UPDATE HISTORY WITH RAW TEXT (for AI context)
    messages.push({ role: "assistant", content: agentResult.next_question });

   // 6. APPLY VOICE TUNING (SSML) WITH SAFETY SCRUBBING
    // Remove characters that often crash Twilio's SSML parser
    const safeText = agentResult.next_question
      .replace(/[&]/g, 'and')
      .replace(/[<]/g, '&lt;')
      .replace(/[>]/g, '&gt;')
      .replace(/["“]/g, '') // Remove double quotes
      .replace(/['’]/g, "&apos;"); // Properly escape apostrophes

    const tunedVoiceQuestion = `<speak><prosody rate="112%" pitch="-1%">${safeText}</prosody></speak>`;

    // 7. SYNC BACK TO TWILIO
    res.json({
      next_question: tunedVoiceQuestion, 
      end_of_call: agentResult.end_of_call,
      score_update: agentResult.score_update,
      updated_history: messages 
    });

    // LOGGING FOR YOUR VISIBILITY
    if (agentResult.score_update && agentResult.score_update.score > 0) {
      console.log(`[SCORE] ${agentResult.score_update.metric}: ${agentResult.score_update.score}`);
    }

  } catch (err) {
    console.error("CRITICAL ERROR:", err.message);
    res.status(500).json({ 
      next_question: "Sorry, I hit a snag. Let's try again.", 
      end_of_call: true,
      updated_history: []
    });
  }
});

const PORT = process.env.PORT || 10000; // Render uses 10000 by default
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));