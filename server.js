require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("🚀 Multi-Account Sales Leader Engine: Online");

// ======================================================
// 1. PIPELINE DATA
// In a real app, you would fetch this from a CRM based on the caller's ID
// ======================================================
const dealPipeline = [
  { account: "GlobalTech Industries", status: "Active" },
  { account: "Acme Corp", status: "Active" },
  { account: "CyberDyne Systems", status: "Active" }
];

// ======================================================
// 2. THE SALES LEADER PROMPT
// ======================================================
function agentSystemPrompt(repName, accounts) {
  const accountList = accounts.map(a => a.account).join(", ");
  return `You are a world-class Sales Leader. You are conducting a 30-minute pipeline review with ${repName}.
  
  ACCOUNTS TO REVIEW: ${accountList}

  YOUR OBJECTIVE:
  1. COCHING LOOP: For the current account, ask MEDDPICC questions. Validate strong answers ("Nice job getting that metric") and coach on weak ones ("We need more than just a coach there, we need a Champion").
  2. ACCOUNT TRANSITION: When you have enough info on one account, provide a brief 1-sentence summary and a clear next step for THAT specific account. Then say, "Let's move to [Next Account]" and begin the next review.
  3. DATA CAPTURE: For every account summary, you MUST include it in the "summary_data" object in your JSON response.
  4. SESSION END: Set "end_of_call": true ONLY after the last account in the list has been summarized.

  STYLE:
  - Professional, punchy, and supportive. 
  - Use contractions (don't, it's, we've) for a natural voice.
  
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
    
    // Add user response to history
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // Initialize if first turn
    if (messages.length === 0) {
      messages.push({ 
        role: "user", 
        content: `START: Hi Erik, let's run through your pipeline. We have ${dealPipeline.length} accounts to cover, starting with ${dealPipeline[0].account}.` 
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
        }
      }
    );

    // Robust JSON Parsing
    let rawText = response.data.choices[0].message.content.trim();
    let agentResult;

    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      // Emergency fallback if JSON fails
      agentResult = {
        next_question: rawText.replace(/[{}]/g, ""), 
        end_of_call: false,
        summary_data: null
      };
    }

    // Save assistant response to history
    messages.push({ role: "assistant", content: agentResult.next_question });

    // --- SSML SAFETY SCRUBBING ---
    // This prevents the Amazon Polly "Application Error" by escaping special characters
    const safeText = agentResult.next_question
      .replace(/[&]/g, 'and')
      .replace(/[<]/g, '&lt;')
      .replace(/[>]/g, '&gt;')
      .replace(/["“]/g, '') 
      .replace(/['’]/g, "&apos;"); 

    const tunedVoice = `<speak><prosody rate="112%" pitch="-1%">${safeText}</prosody></speak>`;

    // --- SALES LEADER LOGGING ---
    // This prints to your Render logs so you can see the coaching summaries in real-time
    if (agentResult.summary_data && agentResult.summary_data.next_steps) {
      console.log(`\n✅ ACCOUNT REVIEW COMPLETED: ${agentResult.current_account || 'Current Deal'}`);
      console.log(`HEALTH: ${agentResult.summary_data.deal_health}`);
      console.log(`STEPS: ${agentResult.summary_data.next_steps}\n`);
    }

    // Return to Twilio Studio
    res.json({
      next_question: tunedVoice,
      end_of_call: agentResult.end_of_call,
      updated_history: messages 
    });

  } catch (err) {
    console.error("CRITICAL ERROR:", err.message);
    res.status(500).json({ 
      next_question: "Sorry, I lost my place in the pipeline. Can we restart this account?", 
      end_of_call: false 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Sales Leader Server listening on port ${PORT}`));