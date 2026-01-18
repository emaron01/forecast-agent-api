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
    if (!sessions[callSid]) {
      console.log(`[SERVER] New Session: ${callSid}`);
      
      // Initialize History (Empty for Claude, prompt is sent separately)
      sessions[callSid] = [
        { role: "assistant", content: "Hey Erik. Let's review the GlobalTech deal. To start, what metrics are they measuring and do we have a baseline?" }
      ];
      
      // Return XML Greeting
      return res.send(`
        <Response>
          <Gather input="speech" action="/agent" method="POST" speechTimeout="1.0" enhanced="false">
             ${speak("Hey Erik. Let's review the GlobalTech deal. To start, what metrics are they measuring and do we have a baseline?")}
          </Gather>
        </Response>
      `);
    }

    // B. HANDLE USER INPUT
    let messages = sessions[callSid];
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    } else {
      // If user stayed silent, ask again
      return res.send(`
        <Response>
          <Gather input="speech" action="/agent" method="POST" speechTimeout="1.0" enhanced="false">
             ${speak("I didn't catch that. Could you say it again?")}
          </Gather>
        </Response>
      `);
    }

    // C. EMERGENCY SAFETY SWITCH (Turn 30)
    if (messages.length >= 30 && !messages.some(m => m.content.includes("Out of time"))) {
       messages.push({ role: "user", content: "Out of time. Give me the verbal summary and score, then say Goodbye." });
    }

    // D. CALL ANTHROPIC API (HAIKU)
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-haiku-20240307", 
        max_tokens: 150,                   
        temperature: 0,
        system: agentSystemPrompt(),       
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

    // E. PARSE RESPONSE
    let rawText = response.data.content[0].text.trim();
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let agentResult = {};
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
        try {
            agentResult = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
        } catch (e) {
            console.error("JSON PARSE ERROR", rawText);
            agentResult = { next_question: rawText, end_of_call: false };
        }
    } else {
        // Fallback if Haiku replies with just text
        agentResult = { next_question: rawText, end_of_call: false };
    }

    // F. SAVE HISTORY
    messages.push({ role: "assistant", content: rawText });
    sessions[callSid] = messages;

    // G. GENERATE TWIML (XML) RESPONSE
    let twimlResponse = "";
    
    if (agentResult.end_of_call) {
        // End Call Logic
        let finalSpeech = agentResult.next_question;
        if (finalSpeech.length < 50 && agentResult.coaching_tip) {
             finalSpeech = `${finalSpeech}. Summary: ${agentResult.coaching_tip}`;
        }
        twimlResponse = `
          <Response>
            ${speak(finalSpeech)}
            <Hangup/>
          </Response>
        `;
    } else {
        // Continue Logic
        twimlResponse = `
          <Response>
            <Gather input="speech" action="/agent" method="POST" speechTimeout="1.0" enhanced="false">
               ${speak(agentResult.next_question)}
            </Gather>
          </Response>
        `;
    }
    
    console.log(`[${callSid}] Turn: ${messages.length} | Ending: ${agentResult.end_of_call}`);
    
    // Send XML back to Twilio
    res.send(twimlResponse);

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    if (error.response) console.error("Anthropic Error:", error.response.data);
    res.type('text/xml').send(`
        <Response>
            <Say voice="Polly.Matthew-Neural">System error. Please try again.</Say>
            <Hangup/>
        </Response>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));