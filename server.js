require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("🚀 Sales Leader Multi-Account Engine: Online");

// ======================================================
// 1. PIPELINE DATA
// ======================================================
const dealPipeline = [
  { account: "GlobalTech Industries" },
  { account: "Acme Corp" },
  { account: "CyberDyne Systems" }
];

// ======================================================
// 2. SYSTEM PROMPT: THE SALES LEADER
// ======================================================
function agentSystemPrompt(repName, accounts) {
  const accountList = accounts.map(a => a.account).join(", ");
  return `You are a world-class Sales Leader conducting a deep-dive pipeline review with ${repName}.
  
  ACCOUNTS TO COVER: ${accountList}

  YOUR PROTOCOL:
  1. DEEP DIVE: For the current account, ask targeted MEDDPICC questions.
  2. REINFORCE & COACH: Give immediate feedback (e.g., "I like that approach" or "We need more detail on the EB").
  3. PIVOT: Once an account is clear, provide a 1-sentence "Leadership Summary" (Health + Next Step) and say "Moving on to [Next Account]...".
  4. DATA: Include account summaries in the "summary_data" field of your JSON.
  5. TERMINATE: Only set "end_of_call": true once the ENTIRE list is finished.

  STYLE:
  - Concise, professional, and supportive.
  - Use contractions (don't, who's, it's) to sound like a human leader.
  
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
    let messages = Array.isArray(req.body.history) ? req.body.history : [];
    
    // Manage Memory: Keep last 20 turns to prevent lag/errors in 30-min calls
    if (messages.length > 20) {
        messages = messages.slice(-20);
    }

    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    if (messages.length === 0) {
      messages.push({ 
        role: "user", 
        content: `START: Hi Erik, let's review your deals: ${dealPipeline.map(a=>a.account).join(", ")}.` 
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.MODEL_API_KEY.trim()}` }
      }
    );

    let rawText = response.data.choices[0].message.content.trim();
    let agentResult;

    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      agentResult = { 
        next_question: rawText.replace(/[{}]/g, ""), 
        end_of_call: false,
        summary_data: null 
      };
    }

    messages.push({ role: "assistant", content: agentResult.next_question });

    // --- ULTRA-SAFE SSML SCRUBBING ---
    // 1. Convert dashes and ampersands
    // 2. Remove all double quotes (they often break the prosody attribute)
    // 3. Escape apostrophes properly for XML
    // 4. STRIP NON-ASCII: This removes em-dashes and symbols that crash Twilio
    const safeText = agentResult.next_question
      .replace(/[—–]/g, '-')
      .replace(/[&]/g, 'and')
      .replace(/[<]/g, '')
      .replace(/[>]/g, '')
      .replace(/["“”]/g, '') 
      .replace(/['’]/g, "&apos;")
      .replace(/[^\x20-\x7E]/g, ""); 

    const tunedVoice = `<speak><prosody rate="112%" pitch="-1%">${safeText}</prosody></speak>`;

    // --- LOGGING LEADERSHIP INSIGHTS ---
    if (agentResult.summary_data && agentResult.summary_data.next_steps) {
      console.log(`\n[✅ ACCOUNT REVIEW: ${agentResult.current_account || 'Update'}]`);
      console.log(`HEALTH: ${agentResult.summary_data.deal_health}`);
      console.log(`NEXT: ${agentResult.summary_data.next_steps}\n`);
    }

    // Return to Twilio Studio
    res.json({
      next_question: tunedVoice,
      end_of_call: agentResult.end_of_call,
      updated_history: messages 
    });

  } catch (err) {
    console.error("SESSION ERROR:", err.message);
    res.status(500).json({ 
        next_question: "Sorry, I hit a snag in the pipeline. Let's keep going.", 
        end_of_call: false 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Executive Session Server on port ${PORT}`));