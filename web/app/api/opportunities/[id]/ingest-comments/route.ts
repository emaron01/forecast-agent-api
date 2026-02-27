import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";
import { resolvePublicId } from "../../../../../lib/publicId";
import { insertCommentIngestion } from "../../../../../lib/db";
import { runCommentIngestionTurn, getPromptVersionHash } from "../../../../../lib/commentIngestionTurn";
import { applyCommentIngestionToOpportunity } from "../../../../../lib/applyCommentIngestionToOpportunity";

export const runtime = "nodejs";

const BodySchema = z.object({
  orgId: z.coerce.number().int().positive().optional(),
  sourceType: z.enum(["manual", "crm", "excel"]),
  rawText: z.string(),
  sourceRef: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth();
    if (!auth || auth.kind !== "user") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const opportunityPublicId = String(id || "").trim();
    if (!opportunityPublicId) {
      return NextResponse.json({ ok: false, error: "Missing opportunity id" }, { status: 400 });
    }

    const opportunityId = await resolvePublicId("opportunities", opportunityPublicId);

    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const { sourceType, rawText, sourceRef } = parsed.data;
    const orgId = parsed.data.orgId ?? auth.user.org_id;
    if (orgId !== auth.user.org_id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const rawTextTrimmed = String(rawText || "").trim();
    if (!rawTextTrimmed) {
      return NextResponse.json({ ok: false, error: "rawText is required" }, { status: 400 });
    }

    console.log(
      JSON.stringify({ event: "ingest_comments_start", opportunityId, sourceType })
    );

    const { rows } = await pool.query(
      `SELECT id, public_id, account_name, opportunity_name, amount, close_date, forecast_stage, sales_stage, baseline_health_score_ts
       FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, opportunityId]
    );
    const opp = rows?.[0];
    if (!opp) {
      return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });
    }
    // Manual paste: allow running even when baseline exists (apply extraction + entity fields).
    if (opp.baseline_health_score_ts != null && sourceType !== "manual") {
      return NextResponse.json({ ok: true, extracted: null, applied: false, skipped: "baseline_exists" });
    }

    const deal = {
      id: opp.id,
      account_name: opp.account_name,
      opportunity_name: opp.opportunity_name,
      amount: opp.amount,
      close_date: opp.close_date,
      forecast_stage: opp.forecast_stage,
    };

    const { extracted } = await runCommentIngestionTurn({
      deal,
      rawNotes: rawTextTrimmed,
      orgId,
    });

    const modelMetadata = {
      model: process.env.MODEL_API_NAME || "unknown",
      promptVersionHash: getPromptVersionHash(),
      timestamp: new Date().toISOString(),
    };

    const { id: commentIngestionId } = await insertCommentIngestion({
      orgId,
      opportunityId,
      sourceType,
      sourceRef: sourceRef ?? null,
      rawText: rawTextTrimmed,
      extractedJson: extracted,
      modelMetadata,
    });

    const applyResult = await applyCommentIngestionToOpportunity({
      orgId,
      opportunityId,
      extracted,
      commentIngestionId,
      scoreEventSource: "agent",
      salesStage: opp.sales_stage ?? opp.forecast_stage ?? null,
      allowWhenBaselineExists: sourceType === "manual",
      rawNotes: rawTextTrimmed,
    });
    if (!applyResult.ok) {
      console.log(
        JSON.stringify({ event: "ingest_comments_apply_error", opportunityId, error: applyResult.error })
      );
      return NextResponse.json(
        { ok: false, error: applyResult.error ?? "Failed to apply to opportunity" },
        { status: 500 }
      );
    }

    console.log(
      JSON.stringify({ event: "ingest_comments_end", opportunityId, sourceType, applied: true })
    );
    return NextResponse.json({ ok: true, extracted, applied: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.log(
      JSON.stringify({ event: "ingest_comments_error", error: msg })
    );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
