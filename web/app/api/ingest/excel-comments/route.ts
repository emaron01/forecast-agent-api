import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAuth } from "../../../../lib/auth";
import { getIngestQueue } from "../../../../lib/ingest-queue";

export const runtime = "nodejs";

const MAX_ROWS = 5000;

function isEmptyRow(r: any) {
  if (!r || typeof r !== "object") return true;
  return Object.values(r).every((v) => v == null || String(v).trim() === "");
}

function parseExcelToRawRows(buf: Buffer, maxRows: number): any[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) throw new Error("No sheets found");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as any[];
  const cleaned = (rows || []).filter((r) => !isEmptyRow(r));
  if (!cleaned.length) throw new Error("No data rows found");
  if (cleaned.length > maxRows) throw new Error(`Too many rows (max ${maxRows})`);
  return cleaned;
}

function findColumn(row: any, candidates: string[]): string | null {
  const keys = Object.keys(row || {});
  const lower = (s: string) => String(s || "").toLowerCase().trim();
  for (const c of candidates) {
    const k = keys.find((x) => lower(x) === lower(c) || lower(x).includes(lower(c)));
    if (k) return k;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth || auth.kind !== "user") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const orgId = auth.user.org_id;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const rawRows = parseExcelToRawRows(buf, MAX_ROWS);

    const headers = Object.keys(rawRows[0] || {});
    const idColRaw = formData.get("idColumn");
    const commentsColRaw = formData.get("commentsColumn");
    const idCol =
      typeof idColRaw === "string" && idColRaw.trim() && headers.includes(idColRaw.trim())
        ? idColRaw.trim()
        : findColumn(rawRows[0], ["crm_opp_id", "crm opp id", "opportunity id", "opportunity_id", "id"]) ?? headers[0];
    const commentsCol =
      typeof commentsColRaw === "string" && commentsColRaw.trim() && headers.includes(commentsColRaw.trim())
        ? commentsColRaw.trim()
        : findColumn(rawRows[0], ["comments", "notes", "comment", "note", "raw_text"]) ?? headers[1];

    if (!idCol || !commentsCol) {
      return NextResponse.json({
        ok: false,
        error: "Excel must have columns for opportunity id (crm_opp_id) and comments/notes. Use the column mapping to select the correct columns.",
      }, { status: 400 });
    }

    const queue = getIngestQueue();
    if (!queue) {
      return NextResponse.json({
        ok: false,
        error: "Ingestion requires REDIS_URL. Configure Redis and redeploy.",
      }, { status: 503 });
    }

    const jobRows = rawRows.map((row: any, i: number) => ({
      rowNum: i + 2,
      crmOppId: String(row?.[idCol] ?? "").trim(),
      rawText: String(row?.[commentsCol] ?? "").trim(),
    })).filter((r: { crmOppId: string; rawText: string }) => r.crmOppId && r.rawText);

    const commentsDetected = jobRows.filter((r) => r.rawText.length > 0).length;

    const job = await queue.add("excel-comments", {
      orgId,
      fileName: (file as File).name,
      rows: jobRows,
    });
    console.log(`[ingest] Enqueued job ${job.id} | rows=${jobRows.length} | comments=${commentsDetected}`);

    return NextResponse.json({
      ok: true,
      mode: "async",
      jobId: job.id,
      rowCount: jobRows.length,
      commentsDetected,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
