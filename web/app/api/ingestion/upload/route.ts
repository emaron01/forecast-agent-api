import { NextResponse } from "next/server";
import { z } from "zod";
import { stageIngestionRows } from "../../../../lib/db";

export const runtime = "nodejs";

const JsonBodySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  mappingSetId: z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
  rawRows: z.array(z.unknown()).min(1),
});

function parseUploadedTextToRows(text: string) {
  const t = String(text || "").trim();
  if (!t) return [] as unknown[];

  // JSON array
  if (t.startsWith("[")) {
    const v = JSON.parse(t);
    if (!Array.isArray(v)) throw new Error("Uploaded JSON must be an array");
    return v as unknown[];
  }

  // NDJSON (one JSON object per line)
  const rows: unknown[] = [];
  for (const line of t.split(/\r?\n/g)) {
    const s = line.trim();
    if (!s) continue;
    rows.push(JSON.parse(s));
  }
  return rows;
}

export async function POST(req: Request) {
  try {
    const contentType = String(req.headers.get("content-type") || "");

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const organizationId = z.coerce.number().int().positive().parse(form.get("organizationId"));
      const mappingSetId = z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String).parse(
        form.get("mappingSetId")
      );

      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "Missing file field: file" }, { status: 400 });
      }

      const text = await file.text();
      const rawRows = parseUploadedTextToRows(text);
      if (!rawRows.length) return NextResponse.json({ ok: false, error: "No rows found in upload" }, { status: 400 });

      const r = await stageIngestionRows({ organizationId, mappingSetId: String(mappingSetId), rawRows });
      return NextResponse.json({ ok: true, inserted: r.inserted });
    }

    // Default: JSON body
    const body = JsonBodySchema.parse(await req.json().catch(() => ({})));
    const r = await stageIngestionRows({
      organizationId: body.organizationId,
      mappingSetId: String(body.mappingSetId),
      rawRows: body.rawRows,
    });
    return NextResponse.json({ ok: true, inserted: r.inserted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

