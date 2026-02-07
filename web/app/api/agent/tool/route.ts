import { NextResponse } from "next/server";
import { Pool } from "pg";
import { handleFunctionCall } from "../../../../../muscle.js";
import { sessions } from "../sessions";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, name, args } = body || {};
    console.log(`🔍 Tool call: sessionId=${sessionId}, name=${name}, sessions.size=${sessions.size}`);
    console.log(`🔍 Available sessionIds:`, Array.from(sessions.keys()));
    
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }
    
    const session = sessions.get(sessionId);
    if (!session) {
      console.error(`❌ Session not found: ${sessionId}`);
      return NextResponse.json({ error: "Invalid session", receivedSessionId: sessionId, availableSessions: Array.from(sessions.keys()) }, { status: 400 });
    }

    if (name !== "save_deal_data") {
      return NextResponse.json({ ok: true });
    }

    const deal = session.deals[session.index];
    if (!deal) return NextResponse.json({ ok: false, error: "No active deal" }, { status: 400 });

    // Normalize common camelCase variants (models sometimes emit these).
    // DB columns and server prompt expect snake_case.
    if (args) {
      if (args.risk_summary == null && args.riskSummary != null) args.risk_summary = args.riskSummary;
      if (args.next_steps == null && args.nextSteps != null) args.next_steps = args.nextSteps;
    }

    // Track touched categories
    for (const key of Object.keys(args)) {
      if (key.endsWith("_score") || key.endsWith("_summary") || key.endsWith("_tip")) {
        const category = key.replace(/_score$/, "").replace(/_summary$/, "").replace(/_tip$/, "");
        session.touched.add(category);
      }
    }

    const category = Object.keys(args).find(k => k.endsWith('_score'))?.replace('_score', '') || 'unknown';
    console.log(`💾 Saving deal data: dealId=${deal.id}, category=${category}, touched:`, Array.from(session.touched));
    console.log(`💾 Save args:`, Object.keys(args).filter(k => args[k] != null).reduce((acc, k) => { acc[k] = args[k]; return acc; }, {} as any));

    const result = await handleFunctionCall({
      toolName: "save_deal_data",
      args: {
        ...args,
        org_id: session.orgId,
        opportunity_id: deal.id,
        rep_name: session.repName,
        call_id: `web_${Date.now()}`,
      },
      pool,
    });

    console.log(`✅ Save successful:`, result);
    console.log(`✅ Saved to DB - opportunity_id: ${result.opportunity_id}, audit_event_id: ${result.audit_event_id}`);

    // Check if deal is complete and enforce end-of-deal wrap
    const stage = String(deal?.forecast_stage || "Pipeline");
    const isPipeline = stage.includes("Pipeline");
    const requiredCats = isPipeline
      ? ["pain", "metrics", "champion", "competition", "budget"]
      : ["pain", "metrics", "champion", "criteria", "competition", "timing", "budget", "eb", "process", "paper"];
    
    const allTouched = requiredCats.every((cat) => session.touched.has(cat));
    
    if (allTouched && !args.risk_summary && !args.next_steps) {
      // Deal is complete but wrap hasn't been done - return instruction to do wrap
      console.log(`🎯 Deal complete! Enforcing end-of-deal wrap. Touched:`, Array.from(session.touched));
      return NextResponse.json({
        ok: true,
        saved: true,
        result,
        enforceWrap: true,
        message: "All required categories reviewed. You MUST now complete the end-of-deal wrap: 1) Speak 'Updated Risk Summary: <your synthesis>', 2) Say 'Your Deal Health Score is at X percent', 3) Speak 'Suggested Next Steps: <your recommendations>', 4) Call save_deal_data with risk_summary and next_steps, 5) Call advance_deal.",
      });
    }

    return NextResponse.json({ ok: true, saved: true, result });
  } catch (error: any) {
    console.error("❌ Save failed:", error?.message || error, error?.stack);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error), saved: false },
      { status: 500 }
    );
  }
}
