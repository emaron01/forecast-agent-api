"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createFieldMappingSet, deleteFieldMappingSet, updateFieldMappingSet } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";

const Schema = z.object({
  mappingSetId: z.string().regex(/^\d+$/).optional(),
  name: z.string().min(1),
  source_system: z.string().optional(),
});

function emptyToNull(s: string | undefined) {
  const t = String(s ?? "").trim();
  return t ? t : null;
}

export async function createMappingSetAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = Schema.omit({ mappingSetId: true }).parse({
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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = Schema.extend({ mappingSetId: z.string().regex(/^\d+$/) }).parse({
    mappingSetId: formData.get("mappingSetId"),
    name: formData.get("name"),
    source_system: formData.get("source_system"),
  });

  await updateFieldMappingSet({
    organizationId: orgId,
    mappingSetId: parsed.mappingSetId,
    name: parsed.name,
    source_system: emptyToNull(parsed.source_system),
  });

  revalidatePath("/admin/mapping-sets");
  redirect(`/admin/mapping-sets`);
}

export async function deleteMappingSetAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = z
    .object({
      mappingSetId: z.string().regex(/^\d+$/),
    })
    .parse({
      mappingSetId: formData.get("mappingSetId"),
    });

  await deleteFieldMappingSet({ organizationId: orgId, mappingSetId: parsed.mappingSetId });
  revalidatePath("/admin/mapping-sets");
  redirect(`/admin/mapping-sets`);
}

