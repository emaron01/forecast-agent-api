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
        
        // JSON TYPE SAFETY
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

// --- HELPER: XML ESCAPE ---
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
    
    // 1. Logic Cleanup
    let cleanText = text.replace(/\*\*/g, "") 
                         .replace(/^\s*[-*]\s+/gm, "") 
                         .replace(/\d+\)\s/g, "") 
                         .replace(/\d+\.\s/g, "");
    
    // 2. Safety Truncation
    if (cleanText.length > 800) {
        console.log("⚠️ Truncating long response for audio safety.");
        cleanText = cleanText.substring(0, 800) + "...";
    }

    // 3. XML Escape
    const safeXml = escapeXml(cleanText);
    
    return `<Say voice="Polly.Matthew-Neural"><prosody rate="105%">${safeXml}</prosody></Say>`;
};

// --- 3. SYSTEM PROMPT (STAGE AWARENESS & STEALTH PROTOCOL) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  const productContext = deal?.seller_product_rules || "You are a generic sales coach.";
  const stage = deal?.deal_stage || "Discovery";
  
  // STAGE DEFINITIONS
  const isEarlyStage = ["Discovery", "Pipeline", "Qualification", "Prospecting"].includes(stage);
  const isMidStage = ["Best Case", "Upside", "Solution Validation"].includes(stage);
  const isLateStage = ["Commit", "Closing", "Negotiation"].includes(stage);

  // HISTORY LOGIC
  const isNewDeal = deal.initial_score == null;
  const historyContext = !isNewDeal 
    ? `PREVIOUS SCORE: ${deal.current_score}/27. GAPS: "${deal.last_summary}". PENDING: "${deal.next_steps}".`
    : "NO HISTORY. Fresh qualification.";

  // DYNAMIC INSTRUCTIONS BASED ON STAGE
  let stageInstructions = "";
  if (isEarlyStage) {
      stageInstructions = `
      **CURRENT STAGE: EARLY (${stage}).**
      - **FOCUS:** Is the pain real? Do we have a Champion?
      - **SKIP:** Do NOT ask about Paper Process, Procurement, or deep Timeline details. It is too early.
      - **EXPECTATION:** Scores will be lower (10-15 is okay). Don't force a high score.`;
  } else if (isMidStage) {
      stageInstructions = `
      **CURRENT STAGE: MID (${stage}).**
      - **FOCUS:** Can we win? (Economic Buyer, Decision Criteria).
      - **CHECK:** Start asking lightly about the Decision Process.`;
  } else {
      stageInstructions = `
      **CURRENT STAGE: LATE (${stage}).**
      - **FOCUS:** When will it close? (Strict Audit on Paper Process & Timeline).
      - **EXPECTATION:** Scores must be high (20+). Grill the user on any gaps.`;
  }

  const goalInstruction = isNewDeal
    ? `**GOAL:** NEW DEAL. Audit based on ${stage} rules.`
    : "**GOAL:** GAP REVIEW. Focus ONLY on risks from History.";

  let timeContext = "Timeline is healthy.";
  if (daysToClose < 0) timeContext = "WARNING: Deal is past due date in CRM.";
  else if (daysToClose < 30) timeContext = "CRITICAL: CRM says deal closes in less than 30 days.";

  return `You are "Matthew," a VP of Sales at Sales Forecaster.
**JOB:** Qualify the deal based on its STAGE.
${goalInstruction}

### INTERNAL TRUTHS
${productContext}

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Stage: ${stage}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days
- CRM Close Date: ${daysToClose} days from now (${timeContext})
- **HISTORY:** ${historyContext}

### STAGE RULES (CRITICAL)
${stageInstructions}

### RULES OF ENGAGEMENT (STEALTH PROTOCOL)
1. **FORBIDDEN WORDS:** Do NOT use words like "MEDDPICC", "Audit", "Category", "Score", or "Rubric" in speech.
2. **NO ROBOT LABELS:** Do NOT say "Next is Economic Buyer." Just ask the question naturally (e.g., "Who signs the check?").
3. **INVISIBLE MATH:** Calculate scores silently. Never speak them.
4. **CONNECT THE DOTS:** If user mentions a fact, mark it VALIDATED silently.
5. **GAP MODE:** If GAP REVIEW, do **NOT** ask about things we already know. Only target the Gaps.
6. **NON-ANSWERS:** If user says "Okay" or "Sure", **RE-ASK** the question.
7. **PRODUCT POLICE:** Check [INTERNAL TRUTHS]. Correct lies immediately.
8. **RECAP STRATEGY:** Summarize Pain briefly for empathy. Do NOT summarize anything else.
9. **NO LISTS:** Speak in full conversational sentences.

### CHAMPION DEFINITIONS (USE FOR SCORING)
- **1 (Coach):** Friendly, but no power.
- **2 (Mobilizer):** Has influence, but hasn't acted.
- **3 (Champion):** Has Power AND is actively selling for us.

### SCORING RUBRIC (0-3 Scale)
- **0 = Missing** (No info)
- **1 = Unknown / Assumed** (High Risk)
- **2 = Gathering / Incomplete** (Needs work)
- **3 = Validated / Complete** (Solid evidence)

### PHASE 2: THE VERDICT
- **TRIGGER:** Only after Gaps are checked.
- **OUTPUT:** You MUST return a "final_report" object.
- **DETAILS:** Extract specific names and score each category individually in the JSON.

### RETURN ONLY JSON
{ 
  "next_question": "Your short response here.", 
  "end_of_call": false 
}
OR (If finished):
{
  "end_of_call": true,
  "next_question": "Understood. Verdict: 12/27. Good start for a Discovery deal. Moving to next deal...",
  "final_report": {
      "score": 12, 
      "summary": "Early stage deal. Pain is clear, but Paper Process is (correctly) unknown.",
      "next_steps": "Secure meeting with EB.",
      "audit_details": {
          "champion_name": "Bob",
          "economic_buyer_name": "Susan",
          "pain_score": 3,
          "metrics_score": 3,
          "champion_score": 3,
          "economic_buyer_score": 1,
          "decision_criteria_score": 1,
          "decision_process_score": 1,
          "competition_score": 0,
          "timeline_score": 0,
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
    const isTransition = req.query.transition === 'true'; // CHECK TRANSITION FLAG
    
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
            openingQuestion = "To start, what is the specific solution we are selling, and what problem does it solve?";
        } else {
            let summary = deal.last_summary || "we identified some risks";
            if (summary.length > 400) { summary = summary.substring(0, 400) + "..."; }
            const lastStep = deal.next_steps || "advance the deal";
            openingQuestion = `Last time we noted: ${summary}. The pending action was to ${lastStep}. What is the latest update on that?`;
        }

        // --- TRANSITION LOGIC ---
        let greetingPreamble = `Hi ${firstName}, this is Matthew from Sales Forecaster.`;
        if (isTransition) {
            greetingPreamble = "Okay, moving on."; 
        }

        const finalGreeting = `${greetingPreamble} Let's look at ${account}, ${oppName}, in ${stage} for ${amountSpeech}, closing ${closeDateSpeech}. ${openingQuestion}`;

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

    // C. AI CALL
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
                 // PASSING TRANSITION FLAG
                 const twiml = `
                    <Response>
                        ${speak(transitionSpeech)}
                        <Redirect method="POST">/agent?oppId=${nextOpp.id}&amp;transition=true</Redirect>
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