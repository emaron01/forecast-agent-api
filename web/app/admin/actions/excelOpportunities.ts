"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { requireOrgContext } from "../../../lib/auth";
import {
  createFieldMappingSet,
  getFieldMappingSet,
  listFieldMappings,
  processIngestionBatch,
  replaceFieldMappings,
  stageIngestionRows,
} from "../../../lib/db";
import { resolvePublicTextId } from "../../../lib/publicId";

const TargetField = z.enum(["account_name", "opportunity_name", "amount", "rep_name", "stage", "forecast_stage", "crm_opp_id"]);

const Schema = z.object({
  mapping_set_public_id: z.string().uuid().optional(),
  mappingSetName: z.string().optional(),
  mappingJson: z.string().optional(),
  processNow: z.enum(["true", "false"]).optional(),
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

export async function uploadExcelOpportunitiesAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = Schema.parse({
    mapping_set_public_id: formData.get("mapping_set_public_id") || undefined,
    mappingSetName: formData.get("mappingSetName") || undefined,
    mappingJson: formData.get("mappingJson") || undefined,
    processNow: formData.get("processNow") || undefined,
  });

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Missing file");

  let mappingSetId = "";
  let mappingSetPublicId = String(parsed.mapping_set_public_id || "").trim();
  const mappingSetName = String(parsed.mappingSetName || "").trim();
  if (mappingSetPublicId) {
    mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicId);
    const set = await getFieldMappingSet({ organizationId: orgId, mappingSetId }).catch(() => null);
    if (!set) throw new Error("Selected mapping set not found in this org");
  } else {
    if (!mappingSetName) throw new Error("Select a saved format or enter a new format name");
    const created = await createFieldMappingSet({ organizationId: orgId, name: mappingSetName, source_system: "excel-opportunities" });
    mappingSetId = created.id;
    mappingSetPublicId = created.public_id;
  }

  // Determine mappings.
  let mappingPairs: Array<{ source_field: string; target_field: string }> = [];
  const rawMappingJson = String(parsed.mappingJson || "").trim();
  if (rawMappingJson) {
    let obj: any = null;
    try {
      obj = JSON.parse(rawMappingJson);
    } catch {
      throw new Error("Invalid mappingJson");
    }
    const pairs: Array<{ source_field: string; target_field: string }> = [];
    for (const [target, source] of Object.entries(obj || {})) {
      const t = TargetField.safeParse(target);
      if (!t.success) continue;
      const s = String(source || "").trim();
      if (!s) continue;
      pairs.push({ source_field: s, target_field: t.data });
    }
    mappingPairs = pairs;
  } else {
    // Fall back to existing saved mappings for this mapping set.
    const existing = await listFieldMappings({ mappingSetId }).catch(() => []);
    mappingPairs = existing.map((m) => ({ source_field: m.source_field, target_field: m.target_field }));
  }

  // Require core fields.
  const requiredTargets = ["account_name", "opportunity_name", "amount", "rep_name"] as const;
  for (const t of requiredTargets) {
    if (!mappingPairs.some((m) => m.target_field === t)) {
      throw new Error(`Missing mapping for required field: ${t}`);
    }
  }

  await replaceFieldMappings({ mappingSetId, mappings: mappingPairs });

  const buf = Buffer.from(await file.arrayBuffer());
  const rawRows = parseExcelToRawRows(buf, 5000);

  const staged = await stageIngestionRows({ organizationId: orgId, mappingSetId, rawRows });

  const processNow = parsed.processNow !== "false";
  if (processNow) {
    await processIngestionBatch({ organizationId: orgId, mappingSetId });
  }

  revalidatePath("/admin/ingestion");
  revalidatePath("/admin/mapping-sets");
  redirect(
    `/admin/ingestion/${encodeURIComponent(mappingSetPublicId)}?filter=all&staged=${encodeURIComponent(String(staged.inserted))}`
  );
}

