require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// Log server start without any special symbols
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
    
    // Using history key to match your Twilio configuration
    let messages = Array.isArray(req.body.history) ? req.body.history : [];
    
    // Manage Memory: Keep last 10 turns for speed and stability
    if (messages.length > 10) {
        messages = messages.slice(-10);
    }

    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    // Initial greeting if history is empty
    if (messages.length === 0) {
      messages.push({ 
        role: "user", 
        content: "START: Hi Erik, let's review: " + dealPipeline.map(a=>a.account).join(", ") 
      });
    }

    // Call AI Model
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

    // JSON Parsing
    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      agentResult = { 
        next_question: "Connection error. Please continue.", 
        end_of_call: false,
        summary_data: {}
      };
    }

    // Update history for next loop
    messages.push({ role: "assistant", content: agentResult.next_question });

    // --- SSML SANITIZER ---
    // This removes emojis, smart quotes, and non-standard symbols
    const safeText = agentResult.next_question
      .replace(/['’]/g, "&apos;") 
      .replace(/[&]/g, "and")     
      .replace(/[^a-zA-Z0-9\s?.!,;]/g, ""); 

    const tunedVoice = "<speak><prosody rate='112%' pitch='-1%'>" + safeText + "</prosody></speak>";

    // Clean Console Logs
    if (agentResult.summary_data && agentResult.summary_data.next_steps) {
        console.log("Account: " + agentResult.current_account);
        console.log("Health: " + agentResult.summary_data.deal_health);
        console.log("Next: " + agentResult.summary_data.next_steps);
    }

    // Return JSON with new_history key to match Twilio Studio
    res.json({
      next_question: tunedVoice,
      end_of_call: agentResult.end_of_call || false,
      summary_data: agentResult.summary_data || {},
      new_history: messages 
    });

  } catch (err) {
    console.error("Error message: ", err.message);
    res.status(500).json({ 
        next_question: "Sorry, I hit a snag. Let's try that again.", 
        end_of_call: false,
        new_history: [] 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server listening on port " + PORT));