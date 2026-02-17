"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createFieldMapping, deleteFieldMapping, updateFieldMapping } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";
import { resolvePublicTextId } from "../../../lib/publicId";

const Schema = z.object({
  mapping_set_public_id: z.string().uuid(),
  public_id: z.string().uuid().optional(),
  source_field: z.string().min(1),
  target_field: z.string().min(1),
});

export async function createFieldMappingAction(formData: FormData) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = Schema.omit({ public_id: true }).parse({
    mapping_set_public_id: formData.get("mapping_set_public_id"),
    source_field: formData.get("source_field"),
    target_field: formData.get("target_field"),
  });

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.mapping_set_public_id);
  await createFieldMapping({
    mappingSetId,
    source_field: parsed.source_field,
    target_field: parsed.target_field,
  });

  revalidatePath(`/admin/mapping-sets/${parsed.mapping_set_public_id}/mappings`);
  redirect(`/admin/mapping-sets/${parsed.mapping_set_public_id}/mappings`);
}

export async function updateFieldMappingAction(formData: FormData) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = Schema.extend({ public_id: z.string().uuid() }).parse({
    mapping_set_public_id: formData.get("mapping_set_public_id"),
    public_id: formData.get("public_id"),
    source_field: formData.get("source_field"),
    target_field: formData.get("target_field"),
  });

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.mapping_set_public_id);
  const mappingId = await resolvePublicTextId("field_mappings", parsed.public_id);
  await updateFieldMapping({
    mappingId,
    mappingSetId,
    source_field: parsed.source_field,
    target_field: parsed.target_field,
  });

  revalidatePath(`/admin/mapping-sets/${parsed.mapping_set_public_id}/mappings`);
  redirect(`/admin/mapping-sets/${parsed.mapping_set_public_id}/mappings`);
}

export async function deleteFieldMappingAction(formData: FormData) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = z
    .object({
      mapping_set_public_id: z.string().uuid(),
      public_id: z.string().uuid(),
    })
    .parse({
      mapping_set_public_id: formData.get("mapping_set_public_id"),
      public_id: formData.get("public_id"),
    });

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.mapping_set_public_id);
  const mappingId = await resolvePublicTextId("field_mappings", parsed.public_id);
  await deleteFieldMapping({ mappingSetId, mappingId });
  revalidatePath(`/admin/mapping-sets/${parsed.mapping_set_public_id}/mappings`);
  redirect(`/admin/mapping-sets/${parsed.mapping_set_public_id}/mappings`);
}

