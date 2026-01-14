require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// Load environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "openai";

// -----------------------------
// Core Agent Logic (Your Brain)
// -----------------------------
async function runAgent(userInput, state) {
  if (MODEL === "openai") {
    return callOpenAI(userInput, state);
  } else {
    return callAnthropic(userInput, state);
  }
}

// -----------------------------
// OpenAI Agent
// -----------------------------
async function callOpenAI(userInput, state) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4.1",
      messages: [
        { role: "system", content: agentSystemPrompt() },
        { role: "user", content: JSON.stringify({ userInput, state }) }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return JSON.parse(response.data.choices[0].message.content);
}

// -----------------------------
// Anthropic Agent
// -----------------------------
async function callAnthropic(userInput, state) {
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 500,
      messages: [
        { role: "system", content: agentSystemPrompt() },
        { role: "user", content: JSON.stringify({ userInput, state }) }
      ]
    },
    {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01"
      }
    }
  );

  const usage = response.data.usage;
  console.log("Anthropic usage:", usage);

  axios.post("https://hook.us2.make.com/n8ejcz5msg3apa18il8khc423dps7iy9", {
    timestamp: new Date().toISOString(),
    usage,
    userInput,
    stateBefore: state,
    agentResponseRaw: response.data.content[0].text
  }).catch(err => {
    console.error("Make.com logging error:", err.message);
  });

  return JSON.parse(response.data.content[0].text);
}

// -----------------------------
// System Prompt (Your Agent Brain)
// -----------------------------
function agentSystemPrompt() {
  return `
You are the SalesForecast.io Forecast Confidence Agent.

Your responsibilities:
- Ask one MEDDPICC-aligned question at a time
- Score each answer (0–3)
- Maintain conversation state
- Identify risks
- Produce JSON only

Your JSON response MUST be:
{
  "next_question": "...",
  "score_update": { "metric": "MEDDPICC field", "score": 0-3 },
  "state": { ...updated state... },
  "risk_flags": ["..."],
  "make_webhook_payload": { ... }
}
`;
}

// -----------------------------
// HTTP Endpoint for Twilio Studio
// -----------------------------
app.post("/forecast", async (req, res) => {
  try {
    const { rep_name, rep_response = "", deals = [], state = {} } = req.body;

    const userInput = rep_response || `Let's begin. Here are the deals: ${JSON.stringify(deals)}`;
    const agentResult = await runAgent(userInput, state);

    res.json({
      message: agentResult.next_question || "Let's begin.",
      state: agentResult.state || {},
      score_update: agentResult.score_update || {},
      risk_flags: agentResult.risk_flags || [],
      make_webhook_payload: agentResult.make_webhook_payload || {}
    });

  } catch (err) {
    console.error("Forecast endpoint error:", err.message);
    res.status(500).json({ message: "Agent unavailable. Please try again." });
  }
});

// -----------------------------
// Legacy /agent Endpoint (Optional)
// -----------------------------
app.post("/agent", async (req, res) => {
  try {
    const userSpeech = req.body.speech_result || "";
    const state = req.body.state || {};

    const agentResult = await runAgent(userSpeech, state);

    res.json({
      next_action: "continue",
      say_text: agentResult.next_question,
      state: agentResult.state
    });

    if (agentResult.make_webhook_payload) {
      axios.post(
        "https://hook.make.com/YOUR_WEBHOOK",
        agentResult.make_webhook_payload
      );
    }

  } catch (err) {
    console.error("Agent error:", err.message);

    res.json({
      next_action: "continue",
      say_text: "I had trouble processing that. Can you repeat it?",
      state: req.body.state || {}
    });
  }
});

// -----------------------------
// Start Server
// -----------------------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Agent endpoint running on port ${port}`);
});