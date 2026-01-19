require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();

// --- DATABASE CONNECTION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com") 
       ? { rejectUnauthorized: false } 
       : false
});

// --- 1. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

// --- 2. SESSION STORAGE ---
const sessions = {}; 

// --- DATABASE UTILITIES ---
async function incrementRunCount(oppId) {
    try {
        await pool.query(`UPDATE opportunities SET run_count = run_count + 1, last_agent_run = CURRENT_TIMESTAMP WHERE id = $1`, [oppId]);
        console.log(`✅ Run count incremented for Opp ID: ${oppId}`);
    } catch (err) {
        console.error("❌ Database Update Error:", err);
    }
}

// --- ANALYTICS ENGINE (CRASH PROOF) ---
async function saveCallResults(oppId, report) {
    try {
        const score = report.score !== undefined ? report.score : null;
        const summary = report.summary || "No summary provided.";
        const next_steps = report.next_steps || "Review deal manually.";
        
        // JSON TYPE SAFETY: Ensure details is an object or null
        let audit_details = report.audit_details || null;
        if (typeof audit_details === 'string') {
             try { audit_details = JSON.parse(audit_details); } catch(e) { audit_details = null; }
        }
        
        const query = `
            UPDATE opportunities 
            SET 
                current_score = $1,
                initial_score = COALESCE(initial_score, $1), 
                last_summary = $2,
                next_steps = $3,
                audit_details = $4
            WHERE id = $5
        `;
        await pool.query(query, [score, summary, next_steps, audit_details, oppId]);
        console.log(`💾 Analytics Saved for Deal ${oppId}: Score ${score}/27`);
    } catch (err) {
        console.error("❌ Failed to save analytics:", err);
    }
}

// --- HELPER: XML ESCAPE (The Armor) ---
function escapeXml(unsafe) {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

// --- HELPER: SPEAK ---
const speak = (text) => {
    if (!text) return "";
    
    // 1. Logic Cleanup (Remove Markdown/Lists)
    let cleanText = text.replace(/\*\*/g, "") 
                         .replace(/^\s*[-*]\s+/gm, "") 
                         .replace(/\d+\)\s/g, "") 
                         .replace(/\d+\.\s/g, "");
    
    // 2. Safety Truncation (800 chars / ~4 mins)
    if (cleanText.length > 800) {
        console.log("⚠️ Truncating long response for audio safety.");
        cleanText = cleanText.substring(0, 800) + "...";
    }

    // 3. XML Escape (Final Armor)
    const safeXml = escapeXml(cleanText);
    
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${safeXml}</prosody></Say>`;
};

// --- 3. SYSTEM PROMPT (FULL LOGIC RESTORED) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";
  
  const isNewDeal = deal.initial_score == null;
  const historyContext = !isNewDeal 
    ? `PREVIOUS SCORE: ${deal.current_score}/27. GAPS: "${deal.last_summary}". PENDING: "${deal.next_steps}".`
    : "NO HISTORY. Fresh qualification.";

  const goalInstruction = isNewDeal
    ? "**GOAL:** NEW DEAL. Audit all 9 points."
    : "**GOAL:** GAP REVIEW. Focus ONLY on risks from History. Assume other areas are valid.";

  let timeContext = "Timeline is healthy.";
  if (daysToClose < 0) timeContext = "WARNING: Deal is past due date in CRM.";
  else if (daysToClose < 30) timeContext = "CRITICAL: CRM says deal closes in less than 30 days.";

  return `You are "Matthew," a VP of Sales at Sales Forecaster.
**JOB:** Qualify the deal using MEDDPICC.
${goalInstruction}

### INTERNAL TRUTHS
${productContext}

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days
- CRM Close Date: ${daysToClose} days from now (${timeContext})
- **HISTORY:** ${historyContext}

### RULES OF ENGAGEMENT (STRICT)
1. **INVISIBLE SCORING:** Do NOT speak scores. Keep math internal.
2. **CONNECT THE DOTS:** If user mentions a fact, mark it VALIDATED silently.
3. **GAP MODE:** If GAP REVIEW, do **NOT** ask about verified categories (Pain/Metrics/Champion) unless they are listed as Gaps in HISTORY.
4. **NON-ANSWERS:** If user says "Okay" or "Sure", **RE-ASK** the question.
5. **PRODUCT POLICE:** Check [INTERNAL TRUTHS]. If they claim a feature we don't have, correct them immediately.
6. **RECAP STRATEGY:** Summarize Pain briefly for empathy. Do NOT summarize anything else.
7. **NO LISTS:** Speak in full conversational sentences.
8. **SKEPTICISM:** Challenge vague answers.

### CHAMPION DEFINITIONS (USE FOR SCORING)
- **1 (Coach):** Friendly, but no power to sign or spend.
- **2 (Mobilizer):** Has influence/power, but hasn't taken action for us yet.
- **3 (Champion):** Has Power AND is actively selling for us (e.g. got us access to EB).

### SCORING RUBRIC (0-3 Scale)
- **0 = Missing** (No info)
- **1 = Unknown / Assumed** (High Risk)
- **2 = Gathering / Incomplete** (Needs work)
- **3 = Validated / Complete** (Solid evidence)

### PHASE 2: THE VERDICT
- **TRIGGER:** Only after Gaps are checked.
- **OUTPUT:** You MUST return a "final_report" object.
- **DETAILS:** You MUST extract specific names (Champion, EB) and score each category individually in the JSON.

### RETURN ONLY JSON
{ 
  "next_question": "Your short response here.", 
  "end_of_call": false 
}
OR (If finished):
{
  "end_of_call": true,
  "next_question": "Understood. Verdict: 24/27. Risk is Paper Process. Moving to next deal...",
  "final_report": {
      "score": 24, 
      "summary": "Strong deal, unknown Paper Process.",
      "next_steps": "Send contract.",
      "audit_details": {
          "champion_name": "Bob",
          "economic_buyer_name": "Susan",
          "pain_score": 3,
          "metrics_score": 3,
          "champion_score": 3,
          "economic_buyer_score": 3,
          "decision_criteria_score": 2,
          "decision_process_score": 2,
          "competition_score": 3,
          "timeline_score": 3,
          "paper_process_score": 0
      }
  }
}

**FORMATTING:** Output ONLY valid JSON. No conversational filler.`;
}

// --- 4. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  try {
    const currentOppId = parseInt(req.query.oppId || 4); 
    const callSid = req.body.CallSid || "test_session";
    const transcript = req.body.transcript || req.body.SpeechResult || "";

    if (!transcript) {
        console.log(`--- New Audit Session: Opp ID ${currentOppId} ---`);
        await incrementRunCount(currentOppId);
    }

    const dbResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [currentOppId]);
    const deal = dbResult.rows[0];

    const now = new Date();
    const createdDate = new Date(deal.opp_created_date);
    const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30)); 
    const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
    const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));

    // A. INSTANT GREETING
    if (!sessions[callSid]) {
        console.log(`[SERVER] New Session: ${callSid}`);
        const fullName = deal.rep_name || "Sales Rep";
        const firstName = fullName.split(' ')[0];
        const account = deal.account_name || "Unknown Account";
        const oppName = deal.opportunity_name || "the deal";
        const stage = deal.deal_stage || "Open";
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed revenue";
        const closeDateSpeech = closeDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        const isNewDeal = deal.initial_score == null;
        let openingQuestion = "";

        if (isNewDeal) {
            openingQuestion = "This is our first review for this deal. To start, what is the specific solution we are selling, and what problem does it solve?";
        } else {
            let summary = deal.last_summary || "we identified some risks";
            // SMART TRUNCATION
            if (summary.length > 400) { summary = summary.substring(0, 400) + "..."; }
            const lastStep = deal.next_steps || "advance the deal";
            openingQuestion = `Last time we noted: ${summary}. The pending action was to ${lastStep}. What is the latest update on that?`;
        }

        const finalGreeting = `Hi ${firstName}, this is Matthew from Sales Forecaster. Let's look at ${account}, ${oppName}, in ${stage} for ${amountSpeech}, closing ${closeDateSpeech}. ${openingQuestion}`;

        sessions[callSid] = [{ role: "assistant", content: finalGreeting }];
        
        const twiml = `
            <Response>
                <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false" actionOnEmptyResult="true">
                    ${speak(finalGreeting)}
                </Gather>
            </Response>
        `;
        return res.send(twiml);
    }

    // B. HANDLE INPUT
    let messages = sessions[callSid];
    if (transcript.trim()) {
      messages.push({ role: "user", content: transcript });
    } else {
      const lastBotMessage = messages[messages.length - 1].content;
      return res.send(`
        <Response>
          <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false" actionOnEmptyResult="true">
             ${speak("I didn't hear you. " + lastBotMessage)}
          </Gather>
        </Response>
      `);
    }

    // C. AI CALL (800 Token Limit / 12s Timeout)
    try {
        const response = await axios.post(
          "https://api.anthropic.com/v1/messages",
          {
            model: "claude-3-haiku-20240307", 
            max_tokens: 800, 
            temperature: 0,
            system: agentSystemPrompt(deal, ageInDays, daysToClose), 
            messages: messages
          },
          { 
              headers: { "x-api-key": process.env.MODEL_API_KEY.trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
              timeout: 12000 
          }
        );

        // D. PARSE RESPONSE
        let rawText = response.data.content[0].text.trim();
        let agentResult = { next_question: "", end_of_call: false };
        
        rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        const jsonStart = rawText.indexOf('{');
        const jsonEnd = rawText.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
            const jsonString = rawText.substring(jsonStart, jsonEnd + 1);
            try {
                agentResult = JSON.parse(jsonString);
            } catch (e) {
                const questionMatch = rawText.match(/"next_question"\s*:\s*"([^"]*)"/);
                if (questionMatch) agentResult.next_question = questionMatch[1];
                else agentResult.next_question = "I didn't quite catch that. Could you clarify?";
            }
        } else {
            agentResult.next_question = rawText; 
        }

        messages.push({ role: "assistant", content: rawText });
        sessions[callSid] = messages;
        
        console.log(`\n--- TURN ${messages.length} ---`);
        console.log("🗣️ USER:", transcript);
        console.log("🧠 MATTHEW:", agentResult.next_question);

        // E. OUTPUT
        if (agentResult.end_of_call) {
            let finalSpeech = agentResult.next_question;
            if (agentResult.final_report) {
                console.log("📊 Saving Final Report...", agentResult.final_report);
                await saveCallResults(currentOppId, agentResult.final_report);
            }
            const nextDealResult = await pool.query('SELECT id, account_name FROM opportunities WHERE id > $1 ORDER BY id ASC LIMIT 1', [currentOppId]);
            
            if (nextDealResult.rows.length > 0) {
                 const nextOpp = nextDealResult.rows[0];
                 const transitionSpeech = `${finalSpeech} Moving on to the next deal: ${nextOpp.account_name}. Stand by.`;
                 delete sessions[callSid]; 
                 const twiml = `
                    <Response>
                        ${speak(transitionSpeech)}
                        <Redirect method="POST">/agent?oppId=${nextOpp.id}</Redirect>
                    </Response>
                 `;
                 return res.send(twiml);
            } else {
                 finalSpeech += " That was the last deal. Good luck.";
                 return res.send(`<Response>${speak(finalSpeech)}<Hangup/></Response>`);
            }
        } else {
            const twiml = `
                <Response>
                    <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false" actionOnEmptyResult="true">
                        ${speak(agentResult.next_question)}
                    </Gather>
                </Response>
            `;
            return res.send(twiml);
        }

    } catch (apiError) {
        console.error("⚠️ LLM TIMEOUT OR ERROR:", apiError.message);
        return res.send(`
            <Response>
                <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="2.5" enhanced="false" actionOnEmptyResult="true">
                    ${speak("I'm calculating the metrics. Let's move to the next step. What is your timeline?")}
                </Gather>
            </Response>
        `);
    }

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    res.type('text/xml').send(`<Response><Say>System error.</Say><Hangup/></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent live on port ${PORT}`));