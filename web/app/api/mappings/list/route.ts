import { NextResponse } from "next/server";
import { z } from "zod";
import { listFieldMappingSets, listFieldMappings } from "../../../../lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const organizationId = z.coerce.number().int().positive().parse(url.searchParams.get("organizationId"));
    const mappingSetIdRaw = url.searchParams.get("mappingSetId");
    const mappingSetId = mappingSetIdRaw ? String(mappingSetIdRaw).trim() : "";

    const mappingSets = await listFieldMappingSets({ organizationId });

    if (!mappingSetId) {
      return NextResponse.json({ ok: true, mappingSets });
    }

    const fieldMappings = await listFieldMappings({ mappingSetId });
    return NextResponse.json({ ok: true, mappingSets, mappingSetId, fieldMappings });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

