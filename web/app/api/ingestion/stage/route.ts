import { NextResponse } from "next/server";
import { z } from "zod";
import { stageIngestionRows } from "../../../../lib/db";

export const runtime = "nodejs";

const BodySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  mappingSetId: z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
  rawRows: z.array(z.unknown()).min(1),
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const r = await stageIngestionRows({
      organizationId: body.organizationId,
      mappingSetId: String(body.mappingSetId),
      rawRows: body.rawRows,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

