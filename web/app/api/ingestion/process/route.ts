import { NextResponse } from "next/server";
import { z } from "zod";
import { processIngestionBatch } from "../../../../lib/db";

export const runtime = "nodejs";

const BodySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  mappingSetId: z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const r = await processIngestionBatch({
      organizationId: body.organizationId,
      mappingSetId: String(body.mappingSetId),
    });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

