import { NextResponse } from "next/server";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { buildNoDealsPrompt, buildPrompt } from "../../../../lib/prompt";
import { buildTools } from "../../../../lib/tools";
import { loadMasterDcoPrompt } from "../../../../lib/masterDcoPrompt";

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
    const mp = await loadMasterDcoPrompt();
    sessions.set(sessionId, {
      orgId,
      repName,
      masterPromptText: mp.text,
      masterPromptSha256: mp.sha256,
      masterPromptLoadedAt: mp.loadedAt,
      masterPromptSourcePath: mp.sourcePath,
      reviewed: new Set<string>(),
      deals,
      index: 0,
      scoreDefs,
      touched,
      items: [],
      wrapSaved: false,
    });

    const deal = deals[0];
    const contextBlock = deal
      ? buildPrompt(deal, repName.split(" ")[0] || repName, deals.length, true, touched, scoreDefs)
      : buildNoDealsPrompt(repName.split(" ")[0] || repName, "No deals were found for this rep.");
    const instructions = `${mp.text}\n\n${contextBlock}`;

    return NextResponse.json({
      sessionId,
      instructions,
      tools: buildTools(),
      masterPromptSha256: mp.sha256,
    });
  } catch (e: any) {
    const mp = await loadMasterDcoPrompt();
    const fallbackContext = buildNoDealsPrompt("Rep", "I couldn't load deals from the system.");
    const fallbackInstructions = `${mp.text}\n\n${fallbackContext}`;
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      orgId: 1,
      repName: "Rep",
      masterPromptText: mp.text,
      masterPromptSha256: mp.sha256,
      masterPromptLoadedAt: mp.loadedAt,
      masterPromptSourcePath: mp.sourcePath,
      reviewed: new Set<string>(),
      deals: [],
      index: 0,
      scoreDefs: [],
      touched: new Set<string>(),
      items: [],
      wrapSaved: false,
    });
    return NextResponse.json({
      sessionId,
      instructions: fallbackInstructions,
      tools: buildTools(),
      error: "Init failed",
      detail: e?.message || String(e),
      masterPromptSha256: mp.sha256,
    });
  }
}
