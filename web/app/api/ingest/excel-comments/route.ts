import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";
import { insertCommentIngestion } from "../../../../lib/db";
import { runCommentIngestionTurn, getPromptVersionHash } from "../../../../lib/commentIngestionTurn";
import { applyCommentIngestionToOpportunity } from "../../../../lib/applyCommentIngestionToOpportunity";

export const runtime = "nodejs";

const MAX_ROWS = 50;

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

    const idCol =
      findColumn(rawRows[0], ["crm_opp_id", "crm opp id", "opportunity id", "opportunity_id", "id"]) ??
      Object.keys(rawRows[0] || {})[0];
    const commentsCol =
      findColumn(rawRows[0], ["comments", "notes", "comment", "note", "raw_text"]) ??
      Object.keys(rawRows[0] || {})[1];

    if (!idCol || !commentsCol) {
      return NextResponse.json({
        ok: false,
        error: "Excel must have columns for opportunity id (crm_opp_id) and comments/notes",
      }, { status: 400 });
    }

    const results: Array<{ row: number; opportunityId: number | null; ok: boolean; error?: string }> = [];
    let okCount = 0;
    let errCount = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i] as any;
      const rowNum = i + 2;
      const crmOppId = String(row?.[idCol] ?? "").trim();
      const rawText = String(row?.[commentsCol] ?? "").trim();

      if (!crmOppId || !rawText) {
        results.push({ row: rowNum, opportunityId: null, ok: false, error: "Missing crm_opp_id or comments" });
        errCount++;
        continue;
      }

      const { rows: oppRows } = await pool.query(
        `SELECT id, public_id, account_name, opportunity_name, amount, close_date, forecast_stage
         FROM opportunities WHERE org_id = $1 AND NULLIF(btrim(crm_opp_id), '') = $2 LIMIT 1`,
        [orgId, crmOppId]
      );
      const opp = oppRows?.[0];
      if (!opp) {
        results.push({ row: rowNum, opportunityId: null, ok: false, error: "Opportunity not found" });
        errCount++;
        continue;
      }

      try {
        const deal = {
          id: opp.id,
          account_name: opp.account_name,
          opportunity_name: opp.opportunity_name,
          amount: opp.amount,
          close_date: opp.close_date,
          forecast_stage: opp.forecast_stage,
        };
        const { extracted } = await runCommentIngestionTurn({ deal, rawNotes: rawText, orgId });
        const { id: commentIngestionId } = await insertCommentIngestion({
          orgId,
          opportunityId: opp.id,
          sourceType: "excel",
          sourceRef: (file as File).name,
          rawText,
          extractedJson: extracted,
          modelMetadata: {
            model: process.env.MODEL_API_NAME || "unknown",
            promptVersionHash: getPromptVersionHash(),
            timestamp: new Date().toISOString(),
          },
        });
        const applyResult = await applyCommentIngestionToOpportunity({
          orgId,
          opportunityId: opp.id,
          extracted,
          commentIngestionId,
        });
        if (!applyResult.ok) {
          throw new Error(applyResult.error ?? "Failed to apply to opportunity");
        }
        results.push({ row: rowNum, opportunityId: opp.id, ok: true });
        okCount++;
      } catch (e: any) {
        results.push({ row: rowNum, opportunityId: opp.id, ok: false, error: e?.message || String(e) });
        errCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      counts: { total: rawRows.length, ok: okCount, error: errCount },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
