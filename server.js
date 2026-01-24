// --- [BLOCK 5: WEBSOCKET CORE & SAVE ENGINE] ---
wss.on("connection", async (ws, req) => {
  console.log("🔥 Twilio WebSocket connected:", req.url);

  // 1. SAFE HANDSHAKE (Fixes "Phone number not recognized")
  let orgId = 1;
  let repName = "System_Fail";

  try {
    // We use 'http://localhost' as a dummy base. 
    // We only care about the search parameters, not the domain.
    const urlObj = new URL(req.url, "http://localhost");
    
    orgId = parseInt(urlObj.searchParams.get("org_id")) || 1;
    
    const queryName = urlObj.searchParams.get("rep_name");
    if (queryName) repName = decodeURIComponent(queryName);

    console.log("🔎 Handshake Success:", { orgId, repName });
  } catch (err) {
    console.error("⚠️ Handshake Warning:", err.message);
  }

  const repIsValid = repName !== "System_Fail";
  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;

  // 2. CONNECT TO OPENAI
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // 3. HELPER: MOVE TO NEXT DEAL
  const advanceToNextDeal = () => {
    currentDealIndex++;
    if (currentDealIndex >= dealQueue.length) {
      openAiWs.send(JSON.stringify({
        type: "response.create",
        response: { instructions: `Say exactly: "Review complete. Goodbye ${repName.split(" ")[0]}."` }
      }));
      return;
    }

    const nextDeal = dealQueue[currentDealIndex];
    const remaining = dealQueue.length - currentDealIndex - 1;
    const nextInstructions = getSystemPrompt(nextDeal, repName.split(" ")[0], remaining);

    openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions: nextInstructions } }));
    openAiWs.send(JSON.stringify({
      type: "response.create",
      response: { instructions: `Say exactly: "Pulling up ${nextDeal.account_name}."` }
    }));
  };

  // 4. OPENAI SESSION SETUP (Fixes Static Race Condition)
  openAiWs.on("open", async () => {
    console.log(`📡 OpenAI Stream Active for rep: ${repName}`);

    // A. FAST CONFIG: Kill static by setting format IMMEDIATELY
    const configUpdate = {
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 }
      }
    };
    openAiWs.send(JSON.stringify(configUpdate));

    // B. LOAD DATABASE
    try {
      const result = await pool.query(
        `SELECT o.*, org.product_truths AS org_product_data
         FROM opportunities o
         JOIN organizations org ON o.org_id = org.id
         WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
         ORDER BY o.id ASC`,
        [orgId]
      );
      dealQueue = result.rows;
      console.log(`📊 Loaded ${dealQueue.length} deals`);
    } catch (err) {
      console.error("❌ DB Load Error:", err.message);
      dealQueue = [];
    }

    // C. VALIDATE & START
    if (!repIsValid) {
       openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: "Say: 'I could not verify your identity. Please call from a registered number.'" } }));
       return;
    }

    if (dealQueue.length === 0) {
      openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: "Say: 'No active deals found for your org.'" } }));
      return;
    }

    // D. START INTERVIEW
    const firstDeal = dealQueue[0];
    const instructions = getSystemPrompt(firstDeal, repName.split(" ")[0], dealQueue.length - 1);

    const logicUpdate = {
      type: "session.update",
      session: {
        instructions: instructions,
        tools: [{
            type: "function",
            name: "save_deal_data",
            description: "Saves scores, tips, and next steps to the database.",
            parameters: {
              type: "object",
              properties: {
                pain_score: { type: "number" }, pain_tip: { type: "string" },
                metrics_score: { type: "number" }, metrics_tip: { type: "string" },
                champion_score: { type: "number" }, champion_tip: { type: "string" },
                eb_score: { type: "number" }, eb_tip: { type: "string" },
                criteria_score: { type: "number" }, criteria_tip: { type: "string" },
                process_score: { type: "number" }, process_tip: { type: "string" },
                competition_score: { type: "number" }, competition_tip: { type: "string" },
                paper_score: { type: "number" }, paper_tip: { type: "string" },
                timing_score: { type: "number" }, timing_tip: { type: "string" },
                risk_summary: { type: "string" }, next_steps: { type: "string" },
              },
              required: ["pain_score", "pain_tip", "metrics_score", "metrics_tip", "champion_score", "champion_tip", "eb_score", "eb_tip", "criteria_score", "criteria_tip", "process_score", "process_tip", "competition_score", "competition_tip", "paper_score", "paper_tip", "timing_score", "timing_tip", "risk_summary", "next_steps"],
            },
        }],
        tool_choice: "auto",
      },
    };

    openAiWs.send(JSON.stringify(logicUpdate));
    setTimeout(() => { openAiWs.send(JSON.stringify({ type: "response.create" })); }, 500);
  });

  // 5. INCOMING MESSAGE HANDLER (Tool Calls & Audio)
  openAiWs.on("message", (data) => {
    const response = JSON.parse(data);

    // Audio Output
    if (response.type === "response.audio.delta" && response.delta) {
      ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
    }

    // Tool Execution
    if (response.type === "response.done" && response.response?.output) {
      response.response.output.forEach((output) => {
        if (output.type === "function_call" && output.name === "save_deal_data") {
          const args = JSON.parse(output.arguments);
          const deal = dealQueue[currentDealIndex];
          console.log(`💾 Saving deal: ${deal.account_name}`);

          const scores = [args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score];
          const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
          const newStage = totalScore >= 25 ? "Closed Won" : totalScore >= 20 ? "Commit" : totalScore >= 12 ? "Best Case" : "Pipeline";

          pool.query(
            `UPDATE opportunities SET 
             previous_total_score = (COALESCE(pain_score,0) + COALESCE(metrics_score,0) + COALESCE(champion_score,0) + COALESCE(eb_score,0) + COALESCE(criteria_score,0) + COALESCE(process_score,0) + COALESCE(competition_score,0) + COALESCE(paper_score,0) + COALESCE(timing_score,0)),
             previous_updated_at = updated_at, last_summary = $1, audit_details = $2, forecast_stage = $3, updated_at = NOW(), run_count = COALESCE(run_count, 0) + 1,
             pain_score = $5, metrics_score = $6, champion_score = $7, eb_score = $8, criteria_score = $9, process_score = $10, competition_score = $11, paper_score = $12, timing_score = $13,
             pain_tip = $14, metrics_tip = $15, champion_tip = $16, eb_tip = $17, criteria_tip = $18, process_tip = $19, competition_tip = $20, paper_tip = $21, timing_tip = $22, next_steps = $23
             WHERE id = $4 AND org_id = $24`,
            [args.risk_summary, JSON.stringify(args), newStage, deal.id, args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score, args.pain_tip, args.metrics_tip, args.champion_tip, args.eb_tip, args.criteria_tip, args.process_tip, args.competition_tip, args.paper_tip, args.timing_tip, args.next_steps, orgId]
          ).then(() => {
            console.log(`✅ Saved: ${deal.account_name}`);
            openAiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: output.call_id, output: JSON.stringify({ success: true }) } }));
            advanceToNextDeal();
          }).catch((err) => console.error("❌ DB ERROR:", err.message));
        }
      });
    }
  });

  // 6. TWILIO AUDIO BRIDGE (TRUE PASSTHROUGH)
  ws.on("message", (message) => {
    const msg = JSON.parse(message);
    if (msg.event === "start") { streamSid = msg.start.streamSid; return; }
    if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
      openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
    }
  });

  // 7. CLEANUP
  ws.on("close", () => {
    console.log("🔌 Call Closed.");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });
});