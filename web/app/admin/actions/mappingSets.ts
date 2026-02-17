"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createFieldMappingSet, deleteFieldMappingSet, updateFieldMappingSet } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";
import { resolvePublicTextId } from "../../../lib/publicId";

const Schema = z.object({
  public_id: z.string().uuid().optional(),
  name: z.string().min(1),
  source_system: z.string().optional(),
});

function emptyToNull(s: string | undefined) {
  const t = String(s ?? "").trim();
  return t ? t : null;
}

export async function createMappingSetAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = Schema.omit({ public_id: true }).parse({
    name: formData.get("name"),
    source_system: formData.get("source_system"),
  });

  await createFieldMappingSet({
    organizationId: orgId,
    name: parsed.name,
    source_system: emptyToNull(parsed.source_system),
  });

  revalidatePath("/admin/mapping-sets");
  redirect(`/admin/mapping-sets`);
}

export async function updateMappingSetAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = Schema.extend({ public_id: z.string().uuid() }).parse({
    public_id: formData.get("public_id"),
    name: formData.get("name"),
    source_system: formData.get("source_system"),
  });

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.public_id);
  await updateFieldMappingSet({
    organizationId: orgId,
    mappingSetId,
    name: parsed.name,
    source_system: emptyToNull(parsed.source_system),
  });

  revalidatePath("/admin/mapping-sets");
  redirect(`/admin/mapping-sets`);
}

export async function deleteMappingSetAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = z
    .object({
      public_id: z.string().uuid(),
    })
    .parse({
      public_id: formData.get("public_id"),
    });

  const mappingSetId = await resolvePublicTextId("field_mapping_sets", parsed.public_id);
  await deleteFieldMappingSet({ organizationId: orgId, mappingSetId });
  revalidatePath("/admin/mapping-sets");
  redirect(`/admin/mapping-sets`);
}

