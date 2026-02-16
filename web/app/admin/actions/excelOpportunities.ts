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
  "partner_name",
  "deal_registration",
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

function normalizeBooleanCell(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  const s = String(v)
    .replaceAll("\u00A0", " ") // normalize non-breaking spaces from Excel exports
    .trim()
    .toLowerCase();
  if (!s) return null;
  // Common truthy/falsey values from Excel exports.
  // - "checked"/"unchecked" often appear from checkbox exports
  // - "on"/"off" from HTML-like sources
  // - "x" / "✔" used by some templates
  if (
    s === "true" ||
    s === "t" ||
    s === "yes" ||
    s === "y" ||
    s === "1" ||
    s === "checked" ||
    s === "check" ||
    s === "x" ||
    s === "✔" ||
    s === "on"
  )
    return true;
  if (
    s === "false" ||
    s === "f" ||
    s === "no" ||
    s === "n" ||
    s === "0" ||
    s === "unchecked" ||
    s === "off" ||
    s === "null" ||
    // Common "not provided / not applicable" shorthands seen in uploads.
    s === "np" ||
    s === "n/p"
  )
    return false;
  return null;
}

type ExcelUploadState =
  | {
      ok: true;
      kind: "success";
      message: string;
      fileName?: string;
      mappingSetPublicId?: string;
      mappingSetName?: string;
      inserted?: number; // rows staged
      changed?: number; // opportunities changed (processed)
      processed?: number;
      error?: number;
      intent: string;
      ts: number;
    }
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

function friendlyTargetName(t: string) {
  switch (t) {
    case "account_name":
      return "Account Name";
    case "opportunity_name":
      return "Opportunity Name";
    case "amount":
      return "Amount";
    case "rep_name":
      return "Rep Name";
    case "crm_opp_id":
      return "CRM Opportunity ID";
    case "create_date_raw":
      return "Create Date";
    case "close_date":
      return "Close Date";
    case "sales_stage":
      return "Sales Stage";
    case "forecast_stage":
      return "Forecast Stage";
    case "partner_name":
      return "Partner Name";
    case "deal_registration":
      return "Deal Registration";
    default:
      return t;
  }
}

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
      return err(intent, "We couldn’t read your field mapping.", [
        "Please reselect the column mappings and try again.",
        "If this keeps happening, refresh the page and re-upload the file.",
      ]);
    }

    // Delete format (mapping set)
    if (intent === "delete_format") {
      if (!mappingSetPublicIdInput) return err(intent, "Please select a saved format to delete.", ["Choose a saved format first."]);
      const mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicIdInput);
      const set = await getFieldMappingSet({ organizationId: orgId, mappingSetId }).catch(() => null);
      if (!set) return err(intent, "That saved format no longer exists.", ["Selected mapping set not found in this org."]);
      await deleteFieldMappingSet({ organizationId: orgId, mappingSetId });

      revalidatePath("/admin/excel-opportunities");
      revalidatePath("/dashboard/excel-upload");
      revalidatePath("/admin/mapping-sets");

      return ok(intent, `Format deleted successfully.`, { mappingSetPublicId: mappingSetPublicIdInput, mappingSetName: set.name });
    }

    // For saving a format, we require a name + mapping JSON with required targets.
    if (intent === "save_format") {
      if (!mappingPairsFromJson.length) return err(intent, "Please map at least one field.", ["Choose columns for the field mapping first."]);

      const missingTargets = REQUIRED_TARGETS.filter((t) => !mappingPairsFromJson.some((m) => m.target_field === t));
      if (missingTargets.length) {
        return err(
          intent,
          "Your format is missing required mappings.",
          missingTargets.map((t) => `Missing required field mapping: ${friendlyTargetName(t)}`)
        );
      }

      // If a mapping set is selected, overwrite it.
      if (mappingSetPublicIdInput) {
        const mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicIdInput);
        const existing = await getFieldMappingSet({ organizationId: orgId, mappingSetId }).catch(() => null);
        if (!existing) return err(intent, "That saved format no longer exists.", ["Selected mapping set not found in this org."]);
        const nextName = mappingSetNameInput || existing.name;
        await updateFieldMappingSet({ organizationId: orgId, mappingSetId, name: nextName, source_system: "excel-opportunities" });
        await replaceFieldMappings({ mappingSetId, mappings: mappingPairsFromJson });

        revalidatePath("/admin/excel-opportunities");
        revalidatePath("/dashboard/excel-upload");
        revalidatePath("/admin/mapping-sets");

        return ok(intent, "Format updated successfully.", { mappingSetPublicId: existing.public_id, mappingSetName: nextName });
      }

      // Otherwise, save a new mapping set. Prevent accidental duplicates by name.
      if (!mappingSetNameInput) return err(intent, "Please enter a format name.", ["New format name is required."]);
      const existingByName = (await listFieldMappingSets({ organizationId: orgId }).catch(() => []))
        .filter((s) => String(s.source_system || "").toLowerCase().includes("excel"))
        .filter((s) => String(s.name || "").trim().toLowerCase() === mappingSetNameInput.trim().toLowerCase());
      if (existingByName.length) {
        return err(intent, "A saved format with this name already exists.", [
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
    if (!(file instanceof File)) return err(intent, "Please choose an Excel file to upload.", ["Choose an Excel file (.xlsx) first."]);

    // Determine mapping set to use (existing or create-new).
    let mappingSetId = "";
    let mappingSetPublicId = mappingSetPublicIdInput;
    if (mappingSetPublicId) {
      mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicId);
      const set = await getFieldMappingSet({ organizationId: orgId, mappingSetId }).catch(() => null);
      if (!set) return err(intent, "That saved format no longer exists.", ["Selected mapping set not found in this org."]);
    } else {
      if (!mappingSetNameInput)
        return err(intent, "Please select a saved format or enter a new format name.", [
          "Select a saved format or enter a new format name.",
        ]);
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
      return err(
        intent,
        "Your upload is missing required column mappings.",
        missingTargets.map((t) => `Missing required field mapping: ${friendlyTargetName(t)}`)
      );
    }

    await replaceFieldMappings({ mappingSetId, mappings: mappingPairs });

    const buf = Buffer.from(await file.arrayBuffer());
    let rawRows: any[] = [];
    try {
      rawRows = parseExcelToRawRows(buf, 5000);
    } catch (e: any) {
      return err(intent, "We couldn’t read that Excel file.", [
        "Please confirm it’s a valid .xlsx file with a header row and at least one data row.",
        String(e?.message || e),
      ]);
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
          issues.push(`Row ${rowNum}: missing ${friendlyTargetName(req.target)} (column "${req.source}")`);
          if (issues.length >= 25) break;
        }
      }
      if (issues.length >= 25) break;

      // Create Date: must be parseable (stored raw, parsed in DB to create_date)
      {
        const src = byTarget.get("create_date_raw") || "";
        const v = row?.[src];
        if (!isBlankCell(v) && !tryParseAnyDate(v)) {
          issues.push(`Row ${rowNum}: Create Date is not a valid date (column "${src}")`);
        }
      }

      // Revenue/Amount: normalize BEFORE validation and save parsed float back into the row.
      {
        const src = byTarget.get("amount") || "";
        const v = row?.[src];
        if (!isBlankCell(v)) {
          const normalized = normalizeRevenueCell(v);
          if (normalized.value == null) {
            issues.push(`Row ${rowNum}: Amount must be a number.`);
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
            issues.push(`Row ${rowNum}: Close Date is not a valid date (column "${src}")`);
          } else {
            row[src] = isoDateOnly(d);
          }
        }
      }

      // Deal Registration: optional boolean.
      {
        const src = byTarget.get("deal_registration") || "";
        if (src) {
          const v = row?.[src];
          // Always coerce Deal Registration to a strict boolean for ingestion:
          // - blanks/null => false
          // - Yes/No/checked/etc => true/false
          if (isBlankCell(v)) {
            row[src] = false;
          } else {
            const raw = String(v ?? "")
              .replaceAll("\u00A0", " ")
              .trim();
            // Treat common "not applicable" markers as blank => false.
            const normalizedForBlank = raw.toLowerCase();
            if (
              normalizedForBlank === "n/a" ||
              normalizedForBlank === "na" ||
              normalizedForBlank === "np" ||
              normalizedForBlank === "n/p" ||
              normalizedForBlank === "-" ||
              normalizedForBlank === "not applicable" ||
              normalizedForBlank === "not provided"
            ) {
              row[src] = false;
              continue;
            }

            const b = normalizeBooleanCell(raw);
            if (b == null) {
              issues.push(
                `Row ${rowNum}: Deal Registration must be true/false (or yes/no) (column "${src}"). Found: "${raw || "(blank)"}"`
              );
            } else {
              row[src] = b;
            }
          }
        }
      }

      if (issues.length >= 25) break;
    }

    if (issues.length) {
      return err(intent, "We couldn’t upload your file because some rows are missing or invalid.", issues);
    }

    const staged = await stageIngestionRows({ organizationId: orgId, mappingSetId, rawRows });
    const processNow = parsed.processNow !== "false";
    const summary = processNow ? await processIngestionBatch({ organizationId: orgId, mappingSetId }).catch((e: any) => {
      // Don't crash the UI; surface a helpful message.
      throw new Error(`Ingestion processing failed: ${e?.message || String(e)}`);
    }) : null;
    if (processNow) {
      const errorRows = await listIngestionStagingByFilter({
        organizationId: orgId,
        mappingSetId,
        filter: "error",
        limit: 25,
      }).catch(() => []);
      if (errorRows?.length) {
        return err(
          intent,
          "Your file uploaded, but we couldn’t ingest some rows.",
          errorRows.map((r: any) => String(r.error_message || "Unknown error")).filter(Boolean)
        );
      }
    }

    revalidatePath("/admin/ingestion");
    revalidatePath("/admin/mapping-sets");
    revalidatePath("/dashboard");

    const changed = summary?.changed ?? summary?.processed ?? 0;
    const successMessage = processNow
      ? changed > 0
        ? `Upload succeeded. ${changed} record(s) were updated.`
        : `Upload succeeded. No records needed updating.`
      : `Upload succeeded. Staged ${staged.inserted} row(s).`;

    return ok(intent, successMessage, {
      fileName: file.name,
      mappingSetPublicId,
      mappingSetName: mappingSetNameInput || undefined,
      inserted: staged.inserted,
      changed,
      processed: summary?.processed ?? undefined,
      error: summary?.error ?? undefined,
    });
  } catch (e: any) {
    return err(intent, "We couldn’t upload your file.", [String(e?.message || e)]);
  }
}

