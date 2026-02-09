"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createFieldMapping, deleteFieldMapping, updateFieldMapping } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";

const Schema = z.object({
  mappingSetId: z.string().regex(/^\d+$/),
  mappingId: z.string().regex(/^\d+$/).optional(),
  source_field: z.string().min(1),
  target_field: z.string().min(1),
});

export async function createFieldMappingAction(formData: FormData) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = Schema.omit({ mappingId: true }).parse({
    mappingSetId: formData.get("mappingSetId"),
    source_field: formData.get("source_field"),
    target_field: formData.get("target_field"),
  });

  await createFieldMapping({
    mappingSetId: parsed.mappingSetId,
    source_field: parsed.source_field,
    target_field: parsed.target_field,
  });

  revalidatePath(`/admin/mapping-sets/${parsed.mappingSetId}/mappings`);
  redirect(`/admin/mapping-sets/${parsed.mappingSetId}/mappings`);
}

export async function updateFieldMappingAction(formData: FormData) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = Schema.extend({ mappingId: z.string().regex(/^\d+$/) }).parse({
    mappingSetId: formData.get("mappingSetId"),
    mappingId: formData.get("mappingId"),
    source_field: formData.get("source_field"),
    target_field: formData.get("target_field"),
  });

  await updateFieldMapping({
    mappingId: parsed.mappingId,
    mappingSetId: parsed.mappingSetId,
    source_field: parsed.source_field,
    target_field: parsed.target_field,
  });

  revalidatePath(`/admin/mapping-sets/${parsed.mappingSetId}/mappings`);
  redirect(`/admin/mapping-sets/${parsed.mappingSetId}/mappings`);
}

export async function deleteFieldMappingAction(formData: FormData) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = z
    .object({
      mappingSetId: z.string().regex(/^\d+$/),
      mappingId: z.string().regex(/^\d+$/),
    })
    .parse({
      mappingSetId: formData.get("mappingSetId"),
      mappingId: formData.get("mappingId"),
    });

  await deleteFieldMapping({ mappingSetId: parsed.mappingSetId, mappingId: parsed.mappingId });
  revalidatePath(`/admin/mapping-sets/${parsed.mappingSetId}/mappings`);
  redirect(`/admin/mapping-sets/${parsed.mappingSetId}/mappings`);
}

