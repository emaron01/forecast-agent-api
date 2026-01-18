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

// --- 4. AGENT ENDPOINT (CLAUDE 3 HAIKU VERSION) ---
app.post("/agent", async (req, res) => {
  try {
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    // A. INSTANT GREETING (0 Latency Fix)
    if (!sessions[callSid]) {
      console.log(`[SERVER] New Session: ${callSid}`);
      
      // ANTHROPIC SPECIFIC: We do NOT put the System Prompt in the messages array.
      // We only start with the Assistant's first greeting in history.
      sessions[callSid] = [
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

    // D. CALL ANTHROPIC API (HAIKU)
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-haiku-20240307", // The Fast Model
        max_tokens: 150,                   // Keep it snappy
        temperature: 0,
        system: agentSystemPrompt(),       // System prompt goes here for Claude
        messages: messages
      },
      {
        headers: {
          "x-api-key": process.env.MODEL_API_KEY.trim(), // Ensure this is your sk-ant key
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      }
    );

    // E. PARSE ANTHROPIC RESPONSE
    // Anthropic returns the text in: data.content[0].text
    let rawText = response.data.content[0].text.trim();
    
    // Clean up if Haiku adds markdown code blocks
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    // Extract JSON safely
    let agentResult = {};
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
        try {
            agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
        } catch (e) {
            console.error("JSON PARSE ERROR", rawText);
            agentResult = { next_question: rawText, end_of_call: false, score: 0 };
        }
    } else {
        // Fallback if no JSON brackets found
        agentResult = { next_question: rawText, end_of_call: false, score: 0 };
    }

    // F. SAVE TO MEMORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

    // G. SUMMARY SAFETY CHECK
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
    if (error.response) {
        console.error("Anthropic Data:", error.response.data);
    }
    res.json({ next_question: "System error. Try again.", end_of_call: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));

