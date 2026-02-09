"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { processIngestionBatch, stageIngestionRows } from "../../lib/db";

const StageSchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  mappingSetId: z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
  rawJson: z.string().min(1),
});

export async function stageRowsAction(formData: FormData) {
  const parsed = StageSchema.safeParse({
    organizationId: formData.get("organizationId"),
    mappingSetId: formData.get("mappingSetId"),
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
    organizationId: parsed.data.organizationId,
    mappingSetId: String(parsed.data.mappingSetId),
    rawRows: raw,
  });

  revalidatePath("/");
  void r;
}

const ProcessSchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  mappingSetId: z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
});

export async function processBatchAction(formData: FormData) {
  const parsed = ProcessSchema.safeParse({
    organizationId: formData.get("organizationId"),
    mappingSetId: formData.get("mappingSetId"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  await processIngestionBatch({
    organizationId: parsed.data.organizationId,
    mappingSetId: String(parsed.data.mappingSetId),
  });
  revalidatePath("/");
}

