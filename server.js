require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// Helper to fix currency/number pronunciation for Matthew
const makeFriendlyForMatthew = (text) => {
  if (!text) return "";
  return text
    .replace(/\$/g, " dollars ") 
    .replace(/%/g, " percent ")
    .replace(/(\d),(\d)/g, "$1$2") 
    .replace(/\b(\d+)k\b/gi, "$1 thousand");
};

console.log("MEDDPICC Agent: Session-Based Memory Active");

// --- 3. MOCK CRM DATA ---
const deals = [
  { id: "D-001", account: "GlobalTech Industries", opportunityName: "Server Migration Project", forecastCategory: "Commit" }
];

// --- 4. SYSTEM PROMPT (SMART MEDDPICC PROCESS) ---
function agentSystemPrompt() {
  return `You are a firm, expert VP of Sales (Matthew).

PHASE 1: SMART INTERVIEW (Efficiency Focus)
- COVER ALL 8 MEDDPICC CATEGORIES: Move through the letters but do not be redundant.
- COMPOUND QUESTIONS: Group related items to save time. 
  * Example: "Who is the Economic Buyer and have you met with them directly yet?"
  * Example: "What metrics are they measuring, and do we have a baseline?"
- NO OVER-PROBING: Do not ask more than 2 questions per category. If the rep is vague after one follow-up, mark it as a RISK and move to the next letter.
- SMART SKIPPING: If the rep mentions a Champion while talking about Pain, acknowledge it and do not ask about it again later.
- CONCISE: Keep your questions under 20 words.

PHASE 2: THE VERDICT (Only when all categories are addressed)
- Once you have covered the letters or the user asks to wrap up:
- STOP asking questions. Provide the verbal summary in the "next_question" field.
- Format: "Erik, here's my take. Score: [X]. Strength: [X]. Risk: [X]. Two Next Steps: [X]. Goodbye."
- You MUST set "end_of_call": true.

RETURN ONLY JSON:
{
 "next_question": "Matthew's Speech",
 "coaching_tip": "Short dashboard summary",
 "score": 8,
 "end_of_call": false
}`;
}

// --- 5. AGENT ENDPOINT (SMART MEDDPICC VERSION) ---
app.post("/agent", async (req, res) => {
  try {
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    // A. INSTANT GREETING (0 Latency Fix)
    if (!sessions[callSid]) {
      console.log(`[SERVER] New Session: ${callSid}`);
      sessions[callSid] = [
        { role: "system", content: agentSystemPrompt() },
        { role: "assistant", content: "Hey Erik. Let's review the GlobalTech deal. To start, what metrics are they measuring and do we have a baseline?" }
      ];
      return res.json({
        next_question: "Hey Erik. Let's review the GlobalTech deal. To start, what metrics are they measuring and do we have a baseline?",
        end_of_call: false
      });
    }

    // B. HANDLE USER INPUT
    let messages = sessions[callSid];
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    } else {
      return res.json({ next_question: "I missed that. Say again?", end_of_call: false });
    }

    // C. EMERGENCY SAFETY SWITCH (Turn 30)
    if (messages.length >= 30 && !messages.some(m => m.content.includes("Out of time"))) {
       messages.push({ role: "user", content: "Out of time. Give me the verbal summary and score, then say Goodbye." });
    }

    // D. CALL OPENAI (Pro Settings: Fast & Strict)
    const response = await axios.post(process.env.MODEL_API_URL.trim(), {
        model: "gpt-4o-mini",
        messages: messages,
        max_tokens: 150,
        temperature: 0,
        stream: false
    }, { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}` } });

    // E. PARSE & SAVE TO MEMORY
    let rawText = response.data.choices[0].message.content.trim().replace(/```json/g, "").replace(/```/g, "").trim();
    let agentResult = JSON.parse(rawText);
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

    // F. SUMMARY SAFETY CHECK
    let finalSpeech = agentResult.next_question;
    if (agentResult.end_of_call && finalSpeech.length < 50 && agentResult.coaching_tip) {
         finalSpeech = `${finalSpeech}. Here is the summary: ${agentResult.coaching_tip}`;
    }

    console.log(`[${callSid}] Turn: ${messages.length} | Score: ${agentResult.score} | Ending: ${agentResult.end_of_call}`);

    res.json({
      next_question: finalSpeech,
      score: agentResult.score || 0,
      end_of_call: agentResult.end_of_call || false
    });

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    res.json({ next_question: "System error. Try again.", end_of_call: true });
  }
});
