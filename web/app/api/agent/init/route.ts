import { NextResponse } from "next/server";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { buildPrompt } from "../../../../lib/prompt";
import { buildTools } from "../../../../lib/tools";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

import { sessions } from "../sessions";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orgId = Number(body.orgId || 1);
    const repName = String(body.repName || "Rep");

    const result = await pool.query(
      `
      SELECT o.*
      FROM opportunities o
      WHERE o.org_id = $1
        AND o.rep_name = $2
        AND o.review_now = TRUE
        AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
      ORDER BY o.id ASC
      `,
      [orgId, repName]
    );
    const defsRes = await pool.query(
      `
      SELECT category, score, label, criteria
      FROM score_definitions
      WHERE org_id = $1
      ORDER BY category ASC, score ASC
      `,
      [orgId]
    );

    const deals = result.rows || [];
    const scoreDefs = defsRes.rows || [];
    const sessionId = randomUUID();
    const touched = new Set<string>();
    sessions.set(sessionId, { orgId, repName, deals, index: 0, scoreDefs, touched, items: [], wrapSaved: false });

    const deal = deals[0];
    const instructions = deal
      ? buildPrompt(deal, repName.split(" ")[0] || repName, deals.length, true, touched, scoreDefs)
      : [
          "SYSTEM PROMPT — SALES FORECAST AGENT",
          "You are Matthew from Sales Forecaster. Speak only English.",
          "We are doing a structured forecast review.",
          "No deals were found for this rep. Do NOT chat generally.",
          "Ask the rep to provide a deal to review with:",
          "- account name",
          "- opportunity name (optional)",
          "- forecast stage",
          "- amount",
          "- close date",
          "Then ask the first MEDDPICC gap question for the provided stage.",
        ].join("\n");

    return NextResponse.json({
      sessionId,
      instructions,
      tools: buildTools(),
    });
  } catch (e: any) {
    const fallbackInstructions = [
      "SYSTEM PROMPT — SALES FORECAST AGENT",
      "You are Matthew from Sales Forecaster. Speak only English.",
      "We are doing a structured forecast review.",
      "I couldn't load deals from the system.",
      "Ask the rep to provide a deal to review with:",
      "- account name",
      "- opportunity name (optional)",
      "- forecast stage",
      "- amount",
      "- close date",
      "Then ask the first MEDDPICC gap question for the provided stage.",
    ].join("\n");
    const sessionId = randomUUID();
    sessions.set(sessionId, { orgId: 1, repName: "Rep", deals: [], index: 0, scoreDefs: [], touched: new Set<string>(), items: [], wrapSaved: false });
    return NextResponse.json({
      sessionId,
      instructions: fallbackInstructions,
      tools: buildTools(),
      error: "Init failed",
      detail: e?.message || String(e),
    });
  }
}
