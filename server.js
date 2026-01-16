require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("🚀 Sales Leader AI: Production Mode Active");

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
// SALES LEADER SYSTEM PROMPT
// ======================================================
function agentSystemPrompt(repName, accountName) {
  return `You are a world-class Sales Leader conducting a MEDDPICC review with ${repName} on the ${accountName} deal.

  YOUR ROLE:
  1. VALIDATE: If the rep gives a strong answer, give brief positive reinforcement (e.g. "Great relationship there" or "Solid metrics").
  2. COACH: If a response is weak or missing detail, offer a one-sentence tactical suggestion or realistic observation.
  3. SUMMARIZE: When you have enough info, set "end_of_call": true. In "summary_data", provide a "deal_health" (a realistic assessment) and "next_steps" (immediate tactical actions) derived ONLY from this specific conversation.

  STYLE:
  - Professional, authoritative, yet supportive.
  - Use contractions (don't, you're, we've) for a natural flow.
  - No corporate jargon; sound like a real person.
  
  OUTPUT FORMAT (STRICT JSON ONLY):
  {
    "next_question": "string",
    "score_update": { "metric": "string", "score": 0-3 },
    "summary_data": { "deal_health": "string", "next_steps": "string" },
    "end_of_call": boolean
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
        temperature: 0.7 
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        }
      }
    );

    // 4. ROBUST PARSING (Prevents crashes from extra AI text)
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
      // Fallback if AI output is malformed
      agentResult = {
        next_question: rawText.replace(/[{}]/g, ""), 
        score_update: { metric: "General", score: 0 },
        summary_data: { deal_health: "In progress", next_steps: "Keep identifying gaps." },
        end_of_call: rawText.toLowerCase().includes("bye")
      };
    }

    // 5. UPDATE HISTORY WITH RAW TEXT
    messages.push({ role: "assistant", content: agentResult.next_question });

    // 6. SSML SAFETY SCRUBBING (Ensures Matthew-Neural doesn't crash on apostrophes)
    const safeText = agentResult.next_question
      .replace(/[&]/g, 'and')
      .replace(/[<]/g, '&lt;')
      .replace(/[>]/g, '&gt;')
      .replace(/["“]/g, '') 
      .replace(/['’]/g, "&apos;"); 

    const tunedVoiceQuestion = `<speak><prosody rate="112%" pitch="-1%">${safeText}</prosody></speak>`;

    // 7. LOG SALES LEADERSHIP INSIGHTS
    if (agentResult.end_of_call) {
      console.log(`\n--- 📊 FINAL SALES REVIEW: ${currentDeal.account} ---`);
      console.log(`REP: ${currentDeal.repName}`);
      console.log(`HEALTH: ${agentResult.summary_data?.deal_health}`);
      console.log(`ACTION: ${agentResult.summary_data?.next_steps}`);
      console.log(`-----------------------------------------------\n`);
    } else {
        console.log(`[Turn ${messages.length/2}] Metric: ${agentResult.score_update?.metric || 'Progressing'}`);
    }

    // 8. SYNC BACK TO TWILIO
    res.json({
      next_question: tunedVoiceQuestion,
      end_of_call: agentResult.end_of_call,
      score_update: agentResult.score_update,
      summary_data: agentResult.summary_data || {},
      updated_history: messages 
    });

  } catch (err) {
    console.error("CRITICAL ERROR:", err.message);
    res.status(500).json({ 
      next_question: "Sorry, I hit a snag in the forecast. Let's try again in a bit.", 
      end_of_call: true,
      updated_history: []
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));