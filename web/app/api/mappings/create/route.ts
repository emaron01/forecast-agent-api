import { NextResponse } from "next/server";
import { z } from "zod";
import { createFieldMappingSet } from "../../../../lib/db";

export const runtime = "nodejs";

const BodySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  name: z.string().min(1),
  source_system: z.string().optional(),
});

function emptyToNull(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const set = await createFieldMappingSet({
      organizationId: body.organizationId,
      name: body.name,
      source_system: emptyToNull(body.source_system),
    });
    return NextResponse.json({ ok: true, mappingSet: set });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

