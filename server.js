require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("🚀 Sales Leader Engine: Clean & Stable Version");

// ======================================================
// 1. PIPELINE DATA
// ======================================================
const dealPipeline = [
  { account: "GlobalTech Industries" },
  { account: "Acme Corp" },
  { account: "CyberDyne Systems" }
];

// ======================================================
// 2. THE SALES LEADER SYSTEM PROMPT
// ======================================================
function agentSystemPrompt(repName, accounts) {
  const accountList = accounts.map(a => a.account).join(", ");
  return `You are a world-class Sales Leader conducting a pipeline review with ${repName}.
  
  ACCOUNTS TO COVER: ${accountList}

  YOUR PROTOCOL:
  1. Ask targeted MEDDPICC questions for the current account.
  2. Provide brief, supportive coaching (e.g., "Good catch there").
  3. When an account is clear, provide a 1-sentence "Leadership Summary" (Health + Next Step) and say "Moving on to [Next Account]...".
  4. Only set "end_of_call": true once the ENTIRE list is finished.

  STRICT STYLE RULES:
  - Keep responses under 40 words.
  - Use contractions (don't, who's, it's).
  
  OUTPUT FORMAT (STRICT JSON ONLY):
  {
    "next_question": "string",
    "current_account": "string",
    "summary_data": { "deal_health": "string", "next_steps": "string" },
    "end_of_call": boolean
  }`;
}

// ======================================================
// 3. MAIN ENDPOINT
// ======================================================
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    // Pull history - using 'updated_history' to match the return object
    let messages = Array.isArray(req.body.history) ? req.body.history : [];
    
    // Manage Memory: Keep it lean for speed
    if (messages.length > 10) {
        messages = messages.slice(-10);
    }

    // Add user response
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // Initialize if brand new call
    if (messages.length === 0) {
      messages.push({ 
        role: "user", 
        content: `START: Hi Erik, let's review: ${dealPipeline.map(a=>a.account).join(", ")}.` 
      });
    }

    // Call AI
    const response = await axios.post(
      process.env.MODEL_API_URL.trim(),
      {
        model: process.env.MODEL_NAME.trim(),
        messages: [
          { role: "system", content: agentSystemPrompt("Erik", dealPipeline) },
          ...messages
        ],
        temperature: 0.7
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}`
        },
        timeout: 8000 // 8 second timeout to prevent Twilio hanging
      }
    );

    let rawText = response.data.choices[0].message.content.trim();
    let agentResult;

    // Robust JSON Parsing
    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      agentResult = { 
        next_question: "I had a glitch. Let's keep going with the current account.", 
        end_of_call: false 
      };
    }

    // Update history for the next turn
    messages.push({ role: "assistant", content: agentResult.next_question });

    // --- NUCLEAR SSML SANITIZER ---
    // This strips EVERY character that isn't a standard letter, number, space, or basic punctuation.
    // This is the only way to 100% guarantee no "Application Errors".
    const safeText = agentResult.next_question
      .replace(/['’]/g, "&apos;") // Escape apostrophes for XML
      .replace(/[&]/g, "and")     // Replace ampersands
      .replace(/[^a-zA-Z0-9\s?.!,&;]/g, ""); // Remove EVERYTHING else (dashes, quotes, symbols)

    const tunedVoice = `<speak><prosody rate="112%" pitch="-1%">${safeText}</prosody></speak>`;

    // --- LOGGING ---
    console.log(`[Turn] Rep said: "${transcript}"`);
    console.log(`[Turn] AI Response: "${safeText}"`);

    // --- RESPONSE TO TWILIO ---
    res.json({
      next_question: tunedVoice,
      end_of_call: agentResult.end_of_call || false,
      summary_data: agentResult.summary_data || {},
      updated_history: messages // This variable name must match your Twilio 'history' parameter
    });

  } catch (err) {
    console.error("FATAL ERROR:", err.message);
    res.status(500).json({ 
        next_question: "Sorry, I hit a snag. Let's try that again.", 
        end_of_call: false 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Stable Sales Leader Server on port ${PORT}`));