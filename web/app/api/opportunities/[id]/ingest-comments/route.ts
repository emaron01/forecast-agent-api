import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";
import { resolvePublicId } from "../../../../../lib/publicId";
import { getIngestQueue } from "../../../../../lib/ingest-queue";

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

    const queue = getIngestQueue();
    if (!queue) {
      return NextResponse.json({ ok: false, error: "Ingestion requires REDIS_URL" }, { status: 503 });
    }

    const job = await queue.add("single-ingest", {
      orgId,
      opportunityId,
      rawText: rawTextTrimmed,
      sourceType,
      sourceRef: sourceRef ?? null,
    });

    return NextResponse.json({ ok: true, mode: "async", jobId: job.id });
  } catch (e: any) {
    const msg = e?.message || String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
