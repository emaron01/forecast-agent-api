"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createRep, deleteRep, getRep, getUserById, updateRep } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";
import { resolvePublicId } from "../../../lib/publicId";

const RepUpsertSchema = z.object({
  public_id: z.string().uuid().optional(),
  rep_name: z.string().min(1),
  display_name: z.string().optional(),
  crm_owner_id: z.string().optional(),
  crm_owner_name: z.string().optional(),
  user_public_id: z.string().uuid().optional(),
  manager_rep_public_id: z.string().uuid().optional(),
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
    user_public_id: formData.get("user_public_id") || undefined,
    manager_rep_public_id: formData.get("manager_rep_public_id") || undefined,
    role: formData.get("role"),
    active: formData.get("active") || undefined,
  });

  const user_id = parsed.user_public_id ? await resolvePublicId("users", parsed.user_public_id) : null;
  if (user_id != null) {
    const u = await getUserById({ orgId, userId: user_id }).catch(() => null);
    if (!u) throw new Error("user_public_id must reference a user in this org");
  }

  const manager_rep_id = parsed.manager_rep_public_id ? await resolvePublicId("reps", parsed.manager_rep_public_id) : null;
  if (manager_rep_id != null) {
    const mgr = await getRep({ organizationId: orgId, repId: manager_rep_id }).catch(() => null);
    if (!mgr) throw new Error("manager_rep_public_id must reference a rep in this org");
  }

  await createRep({
    organizationId: orgId,
    rep_name: parsed.rep_name,
    display_name: emptyToNull(parsed.display_name),
    crm_owner_id: emptyToNull(parsed.crm_owner_id),
    crm_owner_name: emptyToNull(parsed.crm_owner_name),
    user_id,
    manager_rep_id,
    role: emptyToNull(parsed.role),
    active: parsed.active ?? true,
  });

  revalidatePath("/admin/reps");
  redirect(`/admin/reps`);
}

export async function updateRepAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = RepUpsertSchema.extend({ public_id: z.string().uuid() }).parse({
    public_id: formData.get("public_id"),
    rep_name: formData.get("rep_name"),
    display_name: formData.get("display_name"),
    crm_owner_id: formData.get("crm_owner_id"),
    crm_owner_name: formData.get("crm_owner_name"),
    user_public_id: formData.get("user_public_id") || undefined,
    manager_rep_public_id: formData.get("manager_rep_public_id") || undefined,
    role: formData.get("role"),
    active: formData.get("active") || undefined,
  });

  const repId = await resolvePublicId("reps", parsed.public_id);

  const user_id = parsed.user_public_id ? await resolvePublicId("users", parsed.user_public_id) : null;
  if (user_id != null) {
    const u = await getUserById({ orgId, userId: user_id }).catch(() => null);
    if (!u) throw new Error("user_public_id must reference a user in this org");
  }

  const manager_rep_id = parsed.manager_rep_public_id ? await resolvePublicId("reps", parsed.manager_rep_public_id) : null;
  if (manager_rep_id != null) {
    if (manager_rep_id === repId) throw new Error("manager_rep_public_id cannot reference the same rep");
    const mgr = await getRep({ organizationId: orgId, repId: manager_rep_id }).catch(() => null);
    if (!mgr) throw new Error("manager_rep_public_id must reference a rep in this org");
  }

  await updateRep({
    organizationId: orgId,
    repId,
    rep_name: parsed.rep_name,
    display_name: emptyToNull(parsed.display_name),
    crm_owner_id: emptyToNull(parsed.crm_owner_id),
    crm_owner_name: emptyToNull(parsed.crm_owner_name),
    user_id,
    manager_rep_id,
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
      public_id: z.string().uuid(),
    })
    .parse({
      public_id: formData.get("public_id"),
    });

  const repId = await resolvePublicId("reps", parsed.public_id);
  await deleteRep({ organizationId: orgId, repId });
  revalidatePath("/admin/reps");
  redirect(`/admin/reps`);
}

