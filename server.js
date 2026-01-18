require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// --- 3. SYSTEM PROMPT (SMART MEDDPICC PROCESS) ---
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

// --- 4. AGENT ENDPOINT (CLAUDE + MATTHEW NEURAL TUNED) ---
app.post("/agent", async (req, res) => {
  try {
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";
    
    // IMPORTANT: We must return XML for your Redirect Widget
    res.type('text/xml');

    // Helper to wrap text in the specific voice tags
    const speak = (text) => `
        <Say voice="Polly.Matthew-Neural">
            <prosody rate="115%" pitch="+2%">
                ${text}
            </prosody>
        </Say>
    `;

    // A. INSTANT GREETING (WITH VOICE TUNING)
    if (!

