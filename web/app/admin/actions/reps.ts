"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createRep, deleteRep, updateRep } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";

const RepUpsertSchema = z.object({
  repId: z.coerce.number().int().positive().optional(),
  rep_name: z.string().min(1),
  display_name: z.string().optional(),
  crm_owner_id: z.string().optional(),
  crm_owner_name: z.string().optional(),
  user_id: z.coerce.number().int().positive().optional(),
  manager_rep_id: z.coerce.number().int().positive().optional(),
  role: z.string().optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : true)),
});

function emptyToNull(s: string | undefined) {
  const t = String(s ?? "").trim();
  return t ? t : null;
}

export async function createRepAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = RepUpsertSchema.parse({
    rep_name: formData.get("rep_name"),
    display_name: formData.get("display_name"),
    crm_owner_id: formData.get("crm_owner_id"),
    crm_owner_name: formData.get("crm_owner_name"),
    user_id: formData.get("user_id") || undefined,
    manager_rep_id: formData.get("manager_rep_id") || undefined,
    role: formData.get("role"),
    active: formData.get("active") || undefined,
  });

  await createRep({
    organizationId: orgId,
    rep_name: parsed.rep_name,
    display_name: emptyToNull(parsed.display_name),
    crm_owner_id: emptyToNull(parsed.crm_owner_id),
    crm_owner_name: emptyToNull(parsed.crm_owner_name),
    user_id: parsed.user_id ?? null,
    manager_rep_id: parsed.manager_rep_id ?? null,
    role: emptyToNull(parsed.role),
    active: parsed.active ?? true,
  });

  revalidatePath("/admin/reps");
  redirect(`/admin/reps`);
}

export async function updateRepAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = RepUpsertSchema.extend({ repId: z.coerce.number().int().positive() }).parse({
    repId: formData.get("repId"),
    rep_name: formData.get("rep_name"),
    display_name: formData.get("display_name"),
    crm_owner_id: formData.get("crm_owner_id"),
    crm_owner_name: formData.get("crm_owner_name"),
    user_id: formData.get("user_id") || undefined,
    manager_rep_id: formData.get("manager_rep_id") || undefined,
    role: formData.get("role"),
    active: formData.get("active") || undefined,
  });

  await updateRep({
    organizationId: orgId,
    repId: parsed.repId,
    rep_name: parsed.rep_name,
    display_name: emptyToNull(parsed.display_name),
    crm_owner_id: emptyToNull(parsed.crm_owner_id),
    crm_owner_name: emptyToNull(parsed.crm_owner_name),
    user_id: parsed.user_id ?? null,
    manager_rep_id: parsed.manager_rep_id ?? null,
    role: emptyToNull(parsed.role),
    active: parsed.active ?? true,
  });

  revalidatePath("/admin/reps");
  redirect(`/admin/reps`);
}

export async function deleteRepAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = z
    .object({
      repId: z.coerce.number().int().positive(),
    })
    .parse({
      repId: formData.get("repId"),
    });

  await deleteRep({ organizationId: orgId, repId: parsed.repId });
  revalidatePath("/admin/reps");
  redirect(`/admin/reps`);
}

