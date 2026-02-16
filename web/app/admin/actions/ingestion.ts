"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { processIngestionBatch, retryFailedStagingRows, stageIngestionRows } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";
import { resolvePublicTextId } from "../../../lib/publicId";

const ProcessSchema = z.object({
  mapping_set_public_id: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function triggerProcessAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = ProcessSchema.parse({
    mapping_set_public_id: formData.get("mapping_set_public_id"),
    returnTo: formData.get("returnTo"),
  });

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.mapping_set_public_id);
  await processIngestionBatch({ organizationId: orgId, mappingSetId });
  revalidatePath("/admin/ingestion");
  redirect(parsed.returnTo);
}

const RetrySchema = z.object({
  mapping_set_public_id: z.string().uuid(),
  staging_public_ids: z.string().optional(),
  returnTo: z.string().min(1),
});

export async function retryFailedAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = RetrySchema.parse({
    mapping_set_public_id: formData.get("mapping_set_public_id"),
    staging_public_ids: formData.get("staging_public_ids") ?? undefined,
    returnTo: formData.get("returnTo"),
  });

  const publicIds = parsed.staging_public_ids
    ? String(parsed.staging_public_ids)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.mapping_set_public_id);
  const ids = publicIds ? await Promise.all(publicIds.map((pid) => resolvePublicTextId("ingestion_staging", pid))) : undefined;
  await retryFailedStagingRows({ organizationId: orgId, mappingSetId, stagingIds: ids });
  revalidatePath("/admin/ingestion");
  redirect(parsed.returnTo);
}

const StageSchema = z.object({
  mapping_set_public_id: z.string().uuid(),
  rawJson: z.string().min(1),
  returnTo: z.string().min(1),
});

export async function stageJsonRowsAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = StageSchema.parse({
    mapping_set_public_id: formData.get("mapping_set_public_id"),
    rawJson: formData.get("rawJson"),
    returnTo: formData.get("returnTo"),
  });

  let raw: unknown;
  try {
    raw = JSON.parse(parsed.rawJson);
  } catch {
    throw new Error("rawJson must be valid JSON");
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("rawJson must be a non-empty JSON array");

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.mapping_set_public_id);
  await stageIngestionRows({ organizationId: orgId, mappingSetId, rawRows: raw });
  revalidatePath("/admin/ingestion");
  redirect(parsed.returnTo);
}

