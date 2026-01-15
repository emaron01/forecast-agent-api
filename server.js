require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const deals = [{
  repName: "Erik Thompson",
  account: "GlobalTech Industries",
  opportunityName: "Workflow Automation Expansion"
}];

function agentSystemPrompt() {
  return "You are a Sales VP. Ask one MEDDPICC question. Respond in JSON only: { \"next_question\": \"string\", \"end_of_call\": false }";
}

app.post("/agent", async (req, res) => {
  try {
    const transcript = req.body.transcript || "";
    const history = req.body.history || [];
    let messages = [...history];
    const currentDeal = deals[0];

    if (messages.length === 0) {
      const prompt = `Start call with ${currentDeal.repName} about ${currentDeal.account}. Rep says: ${transcript}`;
      messages.push({ role: "user", content: prompt });
    } else if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    }

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-5-flash-20251210",
        system: agentSystemPrompt(),
        messages: messages,
        max_tokens: 300,
        temperature: 0
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.MODEL_API_KEY.trim(),
          "anthropic-version": "2023-06-01"
        }
      }
    );

    res.json(JSON.parse(response.data.content[0].text));
  } catch (err) {
    console.error("DETAILED ERROR:", err.response?.data || err.message);
    res.status(500).json({ next_question: "Connection issue.", error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Server Live"));