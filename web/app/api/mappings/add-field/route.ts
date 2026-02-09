import { NextResponse } from "next/server";
import { z } from "zod";
import { createFieldMapping } from "../../../../lib/db";

export const runtime = "nodejs";

const BodySchema = z.object({
  mappingSetId: z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
  source_field: z.string().min(1),
  target_field: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const mapping = await createFieldMapping({
      mappingSetId: String(body.mappingSetId),
      source_field: body.source_field,
      target_field: body.target_field,
    });
    return NextResponse.json({ ok: true, fieldMapping: mapping });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

