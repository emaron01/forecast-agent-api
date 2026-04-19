"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createRep, deleteRep, getRep, getUserById, syncRepsFromUsers, updateRep } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { requireOrgContext } from "../../../lib/auth";
import { resolvePublicId } from "../../../lib/publicId";
import { isAdmin, isManager } from "../../../lib/roleHelpers";

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
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

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
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

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

export async function relinkRepDealsForUserAction(
  userPublicId: string
): Promise<{ ok: true; relinked: number } | { ok: false; error: string }> {
  const { ctx, orgId } = await requireOrgContext();
  const pid = String(userPublicId || "").trim();
  if (!pid) return { ok: false, error: "Missing user" };

  let userId: number;
  try {
    userId = await resolvePublicId("users", pid);
  } catch {
    return { ok: false, error: "Invalid user" };
  }

  const user = await getUserById({ orgId, userId }).catch(() => null);
  if (!user) return { ok: false, error: "User not found" };
  if (user.role !== "REP") return { ok: false, error: "Not a rep user" };

  if (ctx.kind === "user") {
    if (isAdmin(ctx.user)) {
      /* ok */
    } else if (isManager(ctx.user)) {
      if (user.manager_user_id !== ctx.user.id) return { ok: false, error: "Forbidden" };
    } else {
      return { ok: false, error: "Forbidden" };
    }
  }

  const crmOwnerName = String(user.account_owner_name || "").trim() || null;
  if (!crmOwnerName) return { ok: false, error: "Set CRM Name first" };

  const loadRep = async () => {
    const { rows } = await pool.query<{
      id: number;
      rep_name: string;
      display_name: string | null;
      crm_owner_id: string | null;
      crm_owner_name: string | null;
      user_id: number | null;
      manager_rep_id: number | null;
      role: string | null;
      active: boolean | null;
    }>(
      `
      SELECT r.id, r.rep_name, r.display_name, r.crm_owner_id, r.crm_owner_name, r.user_id, r.manager_rep_id, r.role, r.active
        FROM reps r
       WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1
         AND r.user_id = $2
       LIMIT 1
      `,
      [orgId, user.id]
    );
    return rows?.[0] ?? null;
  };

  let repRow = await loadRep();
  if (!repRow) {
    await syncRepsFromUsers({ organizationId: orgId });
    repRow = await loadRep();
  }
  if (!repRow) return { ok: false, error: "No rep record for this user" };

  const updated = await updateRep({
    organizationId: orgId,
    repId: repRow.id,
    rep_name: repRow.rep_name,
    display_name: repRow.display_name,
    crm_owner_id: repRow.crm_owner_id,
    crm_owner_name: crmOwnerName,
    user_id: repRow.user_id,
    manager_rep_id: repRow.manager_rep_id,
    role: repRow.role,
    active: repRow.active ?? true,
  });
  if (!updated) return { ok: false, error: "Update failed" };
  return { ok: true, relinked: updated.relinked_opportunities };
}

export async function deleteRepAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

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

