import { NextResponse } from "next/server";
import { z } from "zod";
import { listIngestionStagingByFilter } from "../../../../lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const organizationId = z.coerce.number().int().positive().parse(url.searchParams.get("organizationId"));
    const mappingSetIdRaw = url.searchParams.get("mappingSetId");
    const mappingSetId = mappingSetIdRaw ? String(mappingSetIdRaw).trim() : "";
    const limit = z.coerce.number().int().min(1).max(500).catch(100).parse(url.searchParams.get("limit"));

    if (!mappingSetId) {
      return NextResponse.json({ ok: false, error: "mappingSetId is required" }, { status: 400 });
    }

    const rows = await listIngestionStagingByFilter({
      organizationId,
      mappingSetId,
      filter: "error",
      limit,
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

