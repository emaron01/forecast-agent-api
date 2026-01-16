require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

console.log("Server status: online and listening");

// 1. PIPELINE DATA
const dealPipeline = [
  { account: "GlobalTech Industries" },
  { account: "Acme Corp" },
  { account: "CyberDyne Systems" }
];

// 2. THE SALES LEADER SYSTEM PROMPT
function agentSystemPrompt(repName, accounts) {
  const accountList = accounts.map(a => a.account).join(", ");
  return `You are a Sales Leader conducting a review with ${repName}.
  Accounts to cover: ${accountList}
  Protocol: Ask targeted questions for the current account.
  When an account is clear, provide a 1-sentence recap and move to the next.
  Only set end_of_call to true once the entire list is finished.
  Style: Responses under 40 words. Use contractions like whos and its.
  Output Format: Strict JSON only.`;
}

// 3. MAIN ENDPOINT
app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    
    // --- FUTURE FIX: TWILIO MEMORY KEY ---
    let messages = Array.isArray(req.body.history) ? req.body.history : [];
    
    if (messages.length > 10) {
        messages = messages.slice(-10);
    }

    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    if (messages.length === 0) {
      messages.push({ 
        role: "user", 
        content: "START: Hi Erik, let's review: " + dealPipeline.map(a=>a.account).join(", ") 
      });
    }

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
          "Authorization": "Bearer " + process.env.MODEL_API_KEY.trim()
        },
        timeout: 8500 
      }
    );

    let rawText = response.data.choices[0].message.content.trim();
    let agentResult;

    // --- FUTURE FIX: JSON PARSER ---
    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      if (jsonStart === -1) throw new Error("No JSON found");
      agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      // If JSON fails, we send PLAIN TEXT only to avoid SSML crashes
      console.log("JSON Parse Failed, using fallback text.");
      return res.json({
        next_question: "I heard you, but my system is lagging. Please tell me more about the current deal.",
        end_of_call: false,
        new_history: messages
      });
    }

    let questionText = String(agentResult.next_question || "Tell me more.");
    
    if (agentResult.end_of_call === true) {
        questionText = "Thanks, that wraps up. Talk soon!";
    }

    messages.push({ role: "assistant", content: questionText });

    // --- FUTURE FIX: SSML COMPATIBILITY ---
    const safeText = questionText
      .replace(/['’]/g, "&apos;") 
      .replace(/[&]/g, "and")     
      .replace(/[^a-zA-Z0-9\s?.!,;]/g, ""); 

    // Final XML formatting
    const tunedVoice = `<speak><prosody rate="112%" pitch="-1%">${safeText}</prosody></speak>`;

    res.json({
      next_question: tunedVoice,
      end_of_call: agentResult.end_of_call || false,
      summary_data: agentResult.summary_data || { deal_health: "Pending", next_steps: "In progress" },
      new_history: messages 
    });

  } catch (err) {
    console.error("Internal Error: ", err.message);
    res.status(500).json({ 
        next_question: "Sorry, I hit a snag. Let's try that again.", 
        end_of_call: false,
        new_history: [] 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server listening on port " + PORT));