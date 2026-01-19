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

// --- 3. SYSTEM PROMPT (PERSONALITY & LOGIC UPGRADE) ---
function agentSystemPrompt(deal, ageInDays, daysToClose) {
  const avgSize = deal?.seller_avg_deal_size || 10000;
  // Product Logic: Use DB value or fallback
  const productContext = deal?.seller_product_rules || "PRODUCT: Unknown. Ask the user what they are selling.";
  // We use 'deal_stage' column as Forecast Category
  const category = deal?.deal_stage || "Pipeline";
  
  const isPipeline = ["Pipeline", "Discovery", "Qualification", "Prospecting"].includes(category);
  const isBestCase = ["Best Case", "Upside", "Solution Validation"].includes(category);
  const isCommit = ["Commit", "Closing", "Negotiation"].includes(category);
  
  const isNewDeal = deal.initial_score == null;
  const historyContext = !isNewDeal 
    ? `PREVIOUS SCORE: ${deal.current_score}/27. HISTORY SUMMARY: "${deal.last_summary}".`
    : "NO HISTORY. Fresh qualification.";

  let instructions = "";
  
  if (isPipeline) {
      instructions = `
      **FORECAST: PIPELINE (The Enthusiastic Hunter).** - **TONE:** Polite, enthusiastic, encouraging.
      - **FOCUS:** Broad questions ("What problem are we solving?", "Who is the Champion?").
      - **FORBIDDEN:** Do NOT ask about Paper Process, Legal, or Redlines. It is too early.
      - **GOAL:** Validate that the deal is *real*, not that it is closing.`;
      
  } else if (isBestCase) {
      instructions = `
      **FORECAST: BEST CASE (The Gap Hunter).**
      - **TONE:** Professional, focused, efficient.
      - **FOCUS:** Look at the [HISTORY]. If a category was previously a "3", IGNORE IT. Only attack the "1s" and "2s".
      - **GOAL:** Find the missing link that prevents this from being a Commit.`;
      
  } else {
      // COMMIT LOGIC - Check for Score Mismatch
      const scoreConcern = (deal.current_score && deal.current_score < 22) 
        ? "WARNING: This deal is in COMMIT but the score is low (<22). Challenge the rep on why they are so confident." 
        : "";

      instructions = `
      **FORECAST: COMMIT (The Closer).**
      - **TONE:** Strict, direct, no-nonsense.
      - **FOCUS:** Paper Process, Timeline, Signatures.
      - **SPECIAL RULE:** ${scoreConcern}
      - **GOAL:** Verify the close date is real. If they are vague, mark it down.`;
  }

  const goalInstruction = isNewDeal
    ? `**GOAL:** NEW DEAL. Audit based on ${category} rules.`
    : "**GOAL:** GAP REVIEW. Focus ONLY on risks from History.";

  let timeContext = "Timeline is healthy.";
  if (daysToClose < 0) timeContext = "WARNING: Deal is past due date in CRM.";
  else if (daysToClose < 30) timeContext = "CRITICAL: CRM says deal closes in less than 30 days.";

  return `You are "Matthew," a VP of Sales at Sales Forecaster.
**JOB:** Qualify the deal based on its FORECAST CATEGORY.
${goalInstruction}

### PRODUCT CONTEXT (WHAT WE SELL)
${productContext}

### LIVE DEAL CONTEXT
- Prospect: ${deal?.account_name}
- Forecast Category: ${category}
- Value: $${deal?.amount} (Avg: $${avgSize})
- Age: ${ageInDays} days
- CRM Close Date: ${daysToClose} days from now (${timeContext})
- **HISTORY:** ${historyContext}

### FORECAST RULES (CRITICAL)
${instructions}

### RULES OF ENGAGEMENT (STEALTH PROTOCOL)
1. **NO PRE-SUMMARY:** Do NOT summarize the deal verbally. When finished, output the JSON immediately.
2. **CLEAN ENDING:** In your final 'next_question', give the verdict ONLY. Do NOT say "Moving to next deal."
3. **INVISIBLE MATH:** Calculate scores silently. Never speak them.
4. **NO ROBOT LABELS:** Just ask the question naturally.
5. **PRODUCT POLICE:** Check [PRODUCT CONTEXT]. Correct lies immediately.
6. **NON-ANSWERS:** If user says "Okay", **RE-ASK** the question.
7. **RECAP STRATEGY:** Summarize Pain briefly for empathy. Do NOT summarize anything else.

### CHAMPION DEFINITIONS (USE FOR SCORING)
- **1 (Coach):** Friendly, but no power to sign or spend.
- **2 (Mobilizer):** Has influence, but hasn't acted.
- **3 (Champion):** Has Power AND is actively selling for us.

### SCORING RUBRIC (0-3 Scale)
- **0 = Missing** (No info)
- **1 = Unknown / Assumed** (High Risk)
- **2 = Gathering / Incomplete** (Needs work)
- **3 = Validated / Complete** (Solid evidence)

### PHASE 2: THE VERDICT
- **TRIGGER:** When you have checked the key areas for this Category.
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
  "next_question": "Understood. Verdict: 24/27. Solid Commit deal.",
  "final_report": {
      "score": 24, 
      "summary": "Commit deal. Only risk is Paper Process.",
      "next_steps": "Close.",
      "audit_details": {
          "champion_name": "Bob",
          "economic_buyer_name": "Susan",
          "pain_score": 3,
          "metrics_score": 3,
          "champion_score": 3,
          "economic_buyer_score": 3,
          "decision_criteria_score": 3,
          "decision_process_score": 3,
          "competition_score": 3,
          "timeline_score": 3,
          "paper_process_score": 1
      }
  }
}

**FORMATTING:** Output ONLY valid JSON. No conversational filler.`;
}

// --- 4. AGENT ENDPOINT ---
app.post("/agent", async (req, res) => {
  try {
    const currentOppId = parseInt(req.query.oppId || 4);
    const isTransition = req.query.transition === 'true'; 
    
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
        // 'deal_stage' is now 'Forecast Category'
        const category = deal.deal_stage || "Pipeline";
        const amountSpeech = deal.amount ? `${deal.amount} dollars` : "undisclosed revenue";
        const closeDateSpeech = closeDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        // COUNT DEALS FOR GREETING
        const countRes = await pool.query('SELECT COUNT(*) FROM opportunities WHERE id >= $1', [currentOppId]);
        const dealsLeft = countRes.rows[0].count;

        const isNewDeal = deal.initial_score == null;
        let openingQuestion = "";

        // Check if we have product context
        const productContext = deal.seller_product_rules ? "" : " (Note: I don't know what we sell yet)";

        if (isNewDeal) {
            openingQuestion = "To start, what is the specific solution we are selling, and what problem does it solve?";
        } else {
            let summary = deal.last_summary || "we identified some risks";
            if (summary.length > 400) { summary = summary.substring(0, 400) + "..."; }
            const lastStep = deal.next_steps || "advance the deal";
            openingQuestion = `Last time we noted: ${summary}. The pending action was to ${lastStep}. What is the latest update on that?`;
        }

        // --- GREETING LOGIC ---
        let finalGreeting = "";
        
        if (isTransition) {
            finalGreeting = `Okay, next up is ${account}, ${oppName}. This is in ${category} for ${amountSpeech}, closing ${closeDateSpeech}. ${openingQuestion}`;
        } else {
            finalGreeting = `Hi ${firstName}, this is Matthew from Sales Forecaster. We are going to review ${dealsLeft} deals today. Let's start with ${account}, ${oppName}. This is in ${category} for ${amountSpeech}, closing ${closeDateSpeech}. ${openingQuestion}`;
        }

        sessions[callSid] = [{ role: "assistant", content: finalGreeting }];
        
        // INTERRUPT FIX: speechTimeout="auto"
        const twiml = `
            <Response>
                <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto" enhanced="false" actionOnEmptyResult="true">
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
          <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto" enhanced="false" actionOnEmptyResult="true">
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
                 const transitionSpeech = `${finalSpeech} Let's move to the next opportunity. Let me pull it up.`;
                 delete sessions[callSid]; 
                 const twiml = `
                    <Response>
                        ${speak(transitionSpeech)}
                        <Redirect method="POST">/agent?oppId=${nextOpp.id}&amp;transition=true</Redirect>
                    </Response>
                 `;
                 return res.send(twiml);
            } else {
                 finalSpeech += " That was the last deal in your forecast. Good luck.";
                 return res.send(`<Response>${speak(finalSpeech)}<Hangup/></Response>`);
            }
        } else {
            const twiml = `
                <Response>
                    <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto" enhanced="false" actionOnEmptyResult="true">
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
                <Gather input="speech" action="/agent?oppId=${currentOppId}" method="POST" speechTimeout="auto" enhanced="false" actionOnEmptyResult="true">
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