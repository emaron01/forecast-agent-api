"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { processIngestionBatch, stageIngestionRows } from "../../lib/db";
import { resolvePublicId, resolvePublicTextId } from "../../lib/publicId";

const StageSchema = z.object({
  org_public_id: z.string().uuid(),
  mapping_set_public_id: z.string().uuid(),
  rawJson: z.string().min(1),
});

export async function stageRowsAction(formData: FormData) {
  const parsed = StageSchema.safeParse({
    org_public_id: formData.get("org_public_id"),
    mapping_set_public_id: formData.get("mapping_set_public_id"),
    rawJson: formData.get("rawJson"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.rawJson);
  } catch {
    throw new Error("rawJson must be valid JSON");
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("rawJson must be a non-empty JSON array");
  }

  const r = await stageIngestionRows({
    organizationId: await resolvePublicId("organizations", parsed.data.org_public_id),
    mappingSetId: await resolvePublicTextId("field_mapping_sets", parsed.data.mapping_set_public_id),
    rawRows: raw,
  });

  revalidatePath("/");
  void r;
}

const ProcessSchema = z.object({
  org_public_id: z.string().uuid(),
  mapping_set_public_id: z.string().uuid(),
});

export async function processBatchAction(formData: FormData) {
  const parsed = ProcessSchema.safeParse({
    org_public_id: formData.get("org_public_id"),
    mapping_set_public_id: formData.get("mapping_set_public_id"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  await processIngestionBatch({
    organizationId: await resolvePublicId("organizations", parsed.data.org_public_id),
    mappingSetId: await resolvePublicTextId("field_mapping_sets", parsed.data.mapping_set_public_id),
  });
  revalidatePath("/");
}

