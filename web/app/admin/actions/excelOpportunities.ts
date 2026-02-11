"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { requireOrgContext } from "../../../lib/auth";
import {
  createFieldMappingSet,
  deleteFieldMappingSet,
  getFieldMappingSet,
  listIngestionStagingByFilter,
  listFieldMappings,
  listFieldMappingSets,
  processIngestionBatch,
  replaceFieldMappings,
  stageIngestionRows,
  updateFieldMappingSet,
} from "../../../lib/db";
import { resolvePublicTextId } from "../../../lib/publicId";

const TargetField = z.enum([
  "account_name",
  "opportunity_name",
  "amount",
  "rep_name",
  "product",
  // Back-compat: older formats may have "stage" stored; canonical is "sales_stage".
  "stage",
  "sales_stage",
  "forecast_stage",
  "crm_opp_id",
  "create_date_raw",
  "close_date",
]);

const Schema = z.object({
  mapping_set_public_id: z.string().uuid().optional(),
  mappingSetName: z.string().optional(),
  mappingJson: z.string().optional(),
  processNow: z.enum(["true", "false"]).optional(),
  intent: z.enum(["save_format", "upload_ingest", "delete_format"]).optional(),
});

function isEmptyRow(r: any) {
  if (!r || typeof r !== "object") return true;
  const vals = Object.values(r);
  return vals.every((v) => v == null || String(v).trim() === "");
}

function parseExcelToRawRows(buf: Buffer, maxRows: number) {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) throw new Error("No sheets found in workbook");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as any[];
  const cleaned = (rows || []).filter((r) => !isEmptyRow(r));
  if (!cleaned.length) throw new Error("No data rows found in the first sheet");
  if (cleaned.length > maxRows) throw new Error(`Too many rows (${cleaned.length}). Max is ${maxRows}.`);
  return cleaned;
}

function isBlankCell(v: unknown) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function tryParseAnyDate(v: unknown): Date | null {
  if (v == null) return null;

  // XLSX with cellDates=true frequently yields Date objects.
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? v : null;
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    // epoch ms
    if (v >= 100000000000) return new Date(v);
    // epoch seconds
    if (v >= 1000000000) return new Date(v * 1000);
    // Excel serial date (days since 1899-12-30)
    if (v >= 20000 && v <= 90000) {
      const base = Date.UTC(1899, 11, 30, 0, 0, 0);
      return new Date(base + v * 24 * 60 * 60 * 1000);
    }
    return null;
  }

  const s = String(v).trim();
  if (!s) return null;

  // Numeric strings: epoch/excel serial
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return tryParseAnyDate(n);
  }

  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return new Date(ms);
  return null;
}

function isoDateOnly(d: Date) {
  // "YYYY-MM-DD" (UTC) to match Postgres DATE expectations reliably.
  return d.toISOString().slice(0, 10);
}

function normalizeRevenueCell(v: unknown): { cleanValue: string; value: number | null } {
  const s = String(v ?? "").trim();
  const cleanValue = s.replaceAll("$", "").replaceAll(",", "").trim();
  if (!cleanValue) return { cleanValue, value: null };
  // Don't allow partial parses like "123abc".
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleanValue)) return { cleanValue, value: null };
  const n = parseFloat(cleanValue);
  return { cleanValue, value: Number.isFinite(n) ? n : null };
}

type ExcelUploadState =
  | { ok: true; kind: "success"; message: string; mappingSetPublicId?: string; mappingSetName?: string; inserted?: number; intent: string; ts: number }
  | { ok: false; kind: "error"; message: string; issues: string[]; intent: string; ts: number };

function err(intent: string, message: string, issues?: string[]) {
  return {
    ok: false as const,
    kind: "error" as const,
    intent,
    ts: Date.now(),
    message,
    issues: (issues || []).filter(Boolean),
  };
}

function ok(intent: string, message: string, extra?: Partial<ExcelUploadState & { ok: true }>) {
  return {
    ok: true as const,
    kind: "success" as const,
    intent,
    ts: Date.now(),
    message,
    ...(extra || {}),
  } as any;
}

function parseMappingPairs(rawMappingJson: string) {
  const t = String(rawMappingJson || "").trim();
  if (!t) return [] as Array<{ source_field: string; target_field: string }>;
  let obj: any = null;
  try {
    obj = JSON.parse(t);
  } catch {
    return null;
  }
  const pairs: Array<{ source_field: string; target_field: string }> = [];
  for (const [target, source] of Object.entries(obj || {})) {
    const parsedTarget = TargetField.safeParse(target);
    if (!parsedTarget.success) continue;
    // IMPORTANT: Do NOT trim source_field.
    // Excel headers can contain leading/trailing/hidden whitespace and must match the raw row keys exactly.
    const rawSource = String(source ?? "");
    if (!rawSource.trim()) continue;
    const canonicalTarget = parsedTarget.data === "stage" ? "sales_stage" : parsedTarget.data;
    pairs.push({ source_field: rawSource, target_field: canonicalTarget });
  }
  return pairs;
}

const REQUIRED_TARGETS = ["account_name", "opportunity_name", "amount", "rep_name", "crm_opp_id", "create_date_raw", "close_date"] as const;

export async function uploadExcelOpportunitiesAction(_prevState: ExcelUploadState | undefined, formData: FormData): Promise<ExcelUploadState> {
  const intentRaw = String(formData.get("intent") || "").trim();
  const intent = intentRaw === "save_format" || intentRaw === "upload_ingest" || intentRaw === "delete_format" ? intentRaw : "upload_ingest";

  try {
    const { orgId } = await requireOrgContext();
    // Excel upload is allowed for all org users.

    const parsed = Schema.parse({
      mapping_set_public_id: formData.get("mapping_set_public_id") || undefined,
      mappingSetName: formData.get("mappingSetName") || undefined,
      mappingJson: formData.get("mappingJson") || undefined,
      processNow: formData.get("processNow") || undefined,
      intent: formData.get("intent") || undefined,
    });

    const mappingSetPublicIdInput = String(parsed.mapping_set_public_id || "").trim();
    const mappingSetNameInput = String(parsed.mappingSetName || "").trim();
    const rawMappingJson = String(parsed.mappingJson || "").trim();

    const mappingPairsFromJson = parseMappingPairs(rawMappingJson);
    if (mappingPairsFromJson == null) {
      return err(intent, "Fix this: invalid field mapping JSON.", ["Field mapping is invalid. Re-upload the file or reselect mappings and try again."]);
    }

    // Delete format (mapping set)
    if (intent === "delete_format") {
      if (!mappingSetPublicIdInput) return err(intent, "Fix this: select a saved format to delete.", ["Choose a saved format first."]);
      const mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicIdInput);
      const set = await getFieldMappingSet({ organizationId: orgId, mappingSetId }).catch(() => null);
      if (!set) return err(intent, "Fix this: selected format was not found.", ["Selected mapping set not found in this org."]);
      await deleteFieldMappingSet({ organizationId: orgId, mappingSetId });

      revalidatePath("/admin/excel-opportunities");
      revalidatePath("/dashboard/excel-upload");
      revalidatePath("/admin/mapping-sets");

      return ok(intent, `Format deleted successfully.`, { mappingSetPublicId: mappingSetPublicIdInput, mappingSetName: set.name });
    }

    // For saving a format, we require a name + mapping JSON with required targets.
    if (intent === "save_format") {
      if (!mappingPairsFromJson.length) return err(intent, "Fix this: map at least one field.", ['Choose columns for the field mapping first.']);

      const missingTargets = REQUIRED_TARGETS.filter((t) => !mappingPairsFromJson.some((m) => m.target_field === t));
      if (missingTargets.length) {
        return err(intent, "Fix this: required fields are not mapped.", missingTargets.map((t) => `Missing mapping for required field: ${t}`));
      }

      // If a mapping set is selected, overwrite it.
      if (mappingSetPublicIdInput) {
        const mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicIdInput);
        const existing = await getFieldMappingSet({ organizationId: orgId, mappingSetId }).catch(() => null);
        if (!existing) return err(intent, "Fix this: selected format was not found.", ["Selected mapping set not found in this org."]);
        const nextName = mappingSetNameInput || existing.name;
        await updateFieldMappingSet({ organizationId: orgId, mappingSetId, name: nextName, source_system: "excel-opportunities" });
        await replaceFieldMappings({ mappingSetId, mappings: mappingPairsFromJson });

        revalidatePath("/admin/excel-opportunities");
        revalidatePath("/dashboard/excel-upload");
        revalidatePath("/admin/mapping-sets");

        return ok(intent, "Format updated successfully.", { mappingSetPublicId: existing.public_id, mappingSetName: nextName });
      }

      // Otherwise, save a new mapping set. Prevent accidental duplicates by name.
      if (!mappingSetNameInput) return err(intent, "Fix this: enter a format name.", ["New format name is required."]);
      const existingByName = (await listFieldMappingSets({ organizationId: orgId }).catch(() => []))
        .filter((s) => String(s.source_system || "").toLowerCase().includes("excel"))
        .filter((s) => String(s.name || "").trim().toLowerCase() === mappingSetNameInput.trim().toLowerCase());
      if (existingByName.length) {
        return err(intent, "Fix this: a format with this name already exists.", [
          `A saved format named "${mappingSetNameInput}" already exists.`,
          `Select it from "Use saved" and click "Update format" to overwrite, or choose a new name.`,
        ]);
      }

      const created = await createFieldMappingSet({ organizationId: orgId, name: mappingSetNameInput, source_system: "excel-opportunities" });
      await replaceFieldMappings({ mappingSetId: created.id, mappings: mappingPairsFromJson });

      revalidatePath("/admin/excel-opportunities");
      revalidatePath("/dashboard/excel-upload");
      revalidatePath("/admin/mapping-sets");

      return ok(intent, "Format saved successfully.", { mappingSetPublicId: created.public_id, mappingSetName: mappingSetNameInput });
    }

    // Upload + ingest
    const file = formData.get("file");
    if (!(file instanceof File)) return err(intent, "Fix this: select an Excel file to upload.", ['Choose an Excel file (.xlsx) first.']);

    // Determine mapping set to use (existing or create-new).
    let mappingSetId = "";
    let mappingSetPublicId = mappingSetPublicIdInput;
    if (mappingSetPublicId) {
      mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicId);
      const set = await getFieldMappingSet({ organizationId: orgId, mappingSetId }).catch(() => null);
      if (!set) return err(intent, "Fix this: selected format was not found.", ["Selected mapping set not found in this org."]);
    } else {
      if (!mappingSetNameInput) return err(intent, "Fix this: select a saved format or enter a new format name.", ["Select a saved format or enter a new format name."]);
      const created = await createFieldMappingSet({ organizationId: orgId, name: mappingSetNameInput, source_system: "excel-opportunities" });
      mappingSetId = created.id;
      mappingSetPublicId = created.public_id;
    }

    // Determine mappings: mappingJson if present; else fall back to saved mappings.
    let mappingPairs: Array<{ source_field: string; target_field: string }> = [];
    if (mappingPairsFromJson.length) {
      mappingPairs = mappingPairsFromJson;
    } else {
      const existing = await listFieldMappings({ mappingSetId }).catch(() => []);
      mappingPairs = existing.map((m) => ({
        source_field: m.source_field,
        target_field: m.target_field === "stage" ? "sales_stage" : m.target_field,
      }));
    }

    const missingTargets = REQUIRED_TARGETS.filter((t) => !mappingPairs.some((m) => m.target_field === t));
    if (missingTargets.length) {
      return err(intent, "Fix this: required fields are not mapped.", missingTargets.map((t) => `Missing mapping for required field: ${t}`));
    }

    await replaceFieldMappings({ mappingSetId, mappings: mappingPairs });

    const buf = Buffer.from(await file.arrayBuffer());
    let rawRows: any[] = [];
    try {
      rawRows = parseExcelToRawRows(buf, 5000);
    } catch (e: any) {
      return err(intent, "Fix this: could not read your Excel file.", [String(e?.message || e)]);
    }

    // Pre-validate required fields and normalize close_date values into YYYY-MM-DD strings.
    const byTarget = new Map(mappingPairs.map((m) => [m.target_field, m.source_field]));
    const requiredSources = REQUIRED_TARGETS.map((t) => ({ target: t, source: byTarget.get(t) || "" }));

    const issues: string[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i] as any;
      const rowNum = i + 2; // header row is 1 in Excel

      for (const req of requiredSources) {
        const v = row?.[req.source];
        if (isBlankCell(v)) {
          issues.push(`Row ${rowNum}: missing required value for ${req.target} (column "${req.source}")`);
          if (issues.length >= 25) break;
        }
      }
      if (issues.length >= 25) break;

      // Create Date: must be parseable (stored raw, parsed in DB to create_date)
      {
        const src = byTarget.get("create_date_raw") || "";
        const v = row?.[src];
        if (!isBlankCell(v) && !tryParseAnyDate(v)) {
          issues.push(`Row ${rowNum}: create_date_raw is not a recognized date (column "${src}")`);
        }
      }

      // Revenue/Amount: normalize BEFORE validation and save parsed float back into the row.
      {
        const src = byTarget.get("amount") || "";
        const v = row?.[src];
        if (!isBlankCell(v)) {
          const normalized = normalizeRevenueCell(v);
          if (normalized.value == null) {
            issues.push(`Row ${rowNum}: Revenue must be a number.`);
          } else {
            row[src] = normalized.value;
          }
        }
      }

      // Close Date: must be parseable; normalize to YYYY-MM-DD in-place.
      {
        const src = byTarget.get("close_date") || "";
        const v = row?.[src];
        if (!isBlankCell(v)) {
          const d = tryParseAnyDate(v);
          if (!d) {
            issues.push(`Row ${rowNum}: close_date is not a recognized date (column "${src}")`);
          } else {
            row[src] = isoDateOnly(d);
          }
        }
      }

      if (issues.length >= 25) break;
    }

    if (issues.length) {
      return err(intent, "Fix this: your file has missing/invalid values.", issues);
    }

    const staged = await stageIngestionRows({ organizationId: orgId, mappingSetId, rawRows });
    const processNow = parsed.processNow !== "false";
    if (processNow) {
      await processIngestionBatch({ organizationId: orgId, mappingSetId }).catch((e: any) => {
        // Don't crash the UI; surface a helpful message.
        throw new Error(`Ingestion processing failed: ${e?.message || String(e)}`);
      });
    }

    // If processing ran, surface staging errors instead of claiming success.
    if (processNow) {
      const errorRows = await listIngestionStagingByFilter({
        organizationId: orgId,
        mappingSetId,
        filter: "error",
        limit: 25,
      }).catch(() => []);
      if (errorRows?.length) {
        return err(intent, "Fix this: ingestion failed for some rows.", errorRows.map((r: any) => String(r.error_message || "Unknown error")).filter(Boolean));
      }
    }

    revalidatePath("/admin/ingestion");
    revalidatePath("/admin/mapping-sets");
    revalidatePath("/dashboard");

    return ok(intent, `Upload succeeded. Staged ${staged.inserted} row(s).`, {
      mappingSetPublicId,
      mappingSetName: mappingSetNameInput || undefined,
      inserted: staged.inserted,
    });
  } catch (e: any) {
    return err(intent, "Fix this: upload failed.", [String(e?.message || e)]);
  }
}

