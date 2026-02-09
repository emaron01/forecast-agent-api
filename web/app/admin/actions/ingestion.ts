"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { processIngestionBatch, retryFailedStagingRows, stageIngestionRows } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";

const ProcessSchema = z.object({
  mappingSetId: z.string().regex(/^\d+$/),
  returnTo: z.string().min(1),
});

export async function triggerProcessAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = ProcessSchema.parse({
    mappingSetId: formData.get("mappingSetId"),
    returnTo: formData.get("returnTo"),
  });

  await processIngestionBatch({ organizationId: orgId, mappingSetId: parsed.mappingSetId });
  revalidatePath("/admin/ingestion");
  redirect(parsed.returnTo);
}

const RetrySchema = z.object({
  mappingSetId: z.string().regex(/^\d+$/),
  stagingIds: z.string().optional(),
  returnTo: z.string().min(1),
});

export async function retryFailedAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = RetrySchema.parse({
    mappingSetId: formData.get("mappingSetId"),
    stagingIds: formData.get("stagingIds") ?? undefined,
    returnTo: formData.get("returnTo"),
  });

  const ids = parsed.stagingIds
    ? String(parsed.stagingIds)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  await retryFailedStagingRows({ organizationId: orgId, mappingSetId: parsed.mappingSetId, stagingIds: ids });
  revalidatePath("/admin/ingestion");
  redirect(parsed.returnTo);
}

const StageSchema = z.object({
  mappingSetId: z.string().regex(/^\d+$/),
  rawJson: z.string().min(1),
  returnTo: z.string().min(1),
});

export async function stageJsonRowsAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = StageSchema.parse({
    mappingSetId: formData.get("mappingSetId"),
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

  await stageIngestionRows({ organizationId: orgId, mappingSetId: parsed.mappingSetId, rawRows: raw });
  revalidatePath("/admin/ingestion");
  redirect(parsed.returnTo);
}

