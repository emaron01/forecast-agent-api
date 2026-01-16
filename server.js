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
    
    // We look for 'history' to match your Twilio Key configuration
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

    // Robust JSON Parsing with Error Catching
    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      if (jsonStart === -1) throw new Error("No JSON found");
      agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      // Fallback if AI output is not valid JSON
      agentResult = { 
        next_question: rawText || "Tell me more about that.", 
        end_of_call: false,
        summary_data: {}
      };
    }

    // THE SHIELD: Force the question into a string to prevent .replace() errors
    let questionText = String(agentResult.next_question || "Tell me more.");
    
    // WRAP UP TRIGGER: If the call is ending, use your specific 5-second goodbye
    if (agentResult.end_of_call === true) {
        questionText = "Thanks, that wraps up. Talk soon!";
    }

    messages.push({ role: "assistant", content: questionText });

    // --- SSML SANITIZER ---
    // This removes emojis, smart quotes, and non-standard symbols
    const safeText = questionText
      .replace(/['’]/g, "&apos;") 
      .replace(/[&]/g, "and")     
      .replace(/[^a-zA-Z0-9\s?.!,;]/g, ""); 

    const tunedVoice = "<speak><prosody rate='112%' pitch='-1%'>" + safeText + "</prosody></speak>";

    // Clean Console Logs for Render
    if (agentResult.summary_data && agentResult.summary_data.next_steps) {
        console.log("Account: " + (agentResult.current_account || "Summary"));
        console.log("Health: " + (agentResult.summary_data.deal_health || "In progress"));
    }

    // Return JSON with new_history key to match Twilio Studio flow
    res.json({
      next_question: tunedVoice,
      end_of_call: agentResult.end_of_call || false,
      summary_data: agentResult.summary_data || {},
      new_history: messages 
    });

  } catch (err) {
    console.error("Internal Error: ", err.message);
    res.status(500).json({ 
        next_question: "<speak>I had a slight connection issue. Could you repeat that?</speak>", 
        end_of_call: false,
        new_history: [] 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server listening on port " + PORT));