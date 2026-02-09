"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "../../../lib/auth";
import {
  createPasswordResetToken,
  replaceManagerVisibility,
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  setUserManagerUserId,
  updateUser,
} from "../../../lib/db";
import { hashPassword } from "../../../lib/password";
import { randomToken, sha256Hex } from "../../../lib/auth";
import { resolvePublicId } from "../../../lib/publicId";

const CreateSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(8),
  confirm_password: z.string().min(8),
  role: z.enum(["ADMIN", "EXEC_MANAGER", "MANAGER", "REP"]),
  hierarchy_level: z.coerce.number().int().min(0).max(3),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  account_owner_name: z.string().optional(),
  manager_user_public_id: z.string().uuid().optional(),
  admin_has_full_analytics_access: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : false)),
  see_all_visibility: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : false)),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : true)),
});

const UpdateSchema = z.object({
  public_id: z.string().uuid(),
  email: z.string().min(1),
  role: z.enum(["ADMIN", "EXEC_MANAGER", "MANAGER", "REP"]),
  hierarchy_level: z.coerce.number().int().min(0).max(3),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  account_owner_name: z.string().optional(),
  manager_user_public_id: z.string().uuid().optional(),
  admin_has_full_analytics_access: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : false)),
  see_all_visibility: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : false)),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : true)),
});

function closeHref() {
  return "/admin/users";
}

function buildDisplayName(first_name: string, last_name: string) {
  return `${String(first_name || "").trim()} ${String(last_name || "").trim()}`.trim();
}

export async function createUserAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();

  const parsed = CreateSchema.parse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirm_password: formData.get("confirm_password"),
    role: formData.get("role"),
    hierarchy_level: formData.get("hierarchy_level"),
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    account_owner_name: formData.get("account_owner_name") || undefined,
    manager_user_public_id: formData.get("manager_user_public_id") || undefined,
    admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access") || undefined,
    see_all_visibility: formData.get("see_all_visibility") || undefined,
    active: formData.get("active") || undefined,
  });

  if (ctx.kind === "user" && ctx.user.role === "MANAGER") {
    // Managers can only create REP users and assign them to themselves.
    parsed.role = "REP";
    parsed.manager_user_public_id = ctx.user.public_id;
    parsed.hierarchy_level = 3;
    parsed.admin_has_full_analytics_access = false;
    parsed.see_all_visibility = false;
  } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  if (String(parsed.password || "") !== String(parsed.confirm_password || "")) throw new Error("passwords do not match");

  // Deterministic mapping: role -> hierarchy_level
  const expectedLevel =
    parsed.role === "ADMIN" ? 0 : parsed.role === "EXEC_MANAGER" ? 1 : parsed.role === "MANAGER" ? 2 : 3;
  if (parsed.hierarchy_level !== expectedLevel) {
    throw new Error(`hierarchy_level must be ${expectedLevel} for role ${parsed.role}`);
  }

  // Only REP/MANAGER users should have a manager_user_id.
  let effectiveManagerId: number | null = null;
  if (parsed.role === "REP" || parsed.role === "MANAGER") {
    if (parsed.manager_user_public_id) {
      const id = await resolvePublicId("users", parsed.manager_user_public_id);
      const mgr = await getUserById({ orgId, userId: id });
      if (!mgr || mgr.role !== "MANAGER") throw new Error("manager_user_id must reference a MANAGER user in this org");
      effectiveManagerId = id;
    }
  }

  // Only ADMIN users can have admin_has_full_analytics_access.
  if (parsed.role !== "ADMIN") parsed.admin_has_full_analytics_access = false;

  // Only MANAGER/EXEC_MANAGER can have see_all_visibility.
  if (parsed.role !== "MANAGER" && parsed.role !== "EXEC_MANAGER") parsed.see_all_visibility = false;

  // manager_user_id validity already checked above (if provided).

  // Reps must have account_owner_name (CRM Account Owner Name).
  const account_owner_name = String(parsed.account_owner_name || "").trim();
  if (parsed.hierarchy_level === 3 && !account_owner_name) throw new Error("account_owner_name is required for REPs");

  const password_hash = await hashPassword(String(parsed.password));

  const created = await createUser({
    org_id: orgId,
    email: parsed.email,
    password_hash,
    role: parsed.role,
    hierarchy_level: parsed.hierarchy_level,
    first_name: parsed.first_name,
    last_name: parsed.last_name,
    display_name: buildDisplayName(parsed.first_name, parsed.last_name),
    account_owner_name: account_owner_name || null,
    manager_user_id: effectiveManagerId,
    admin_has_full_analytics_access: parsed.admin_has_full_analytics_access ?? false,
    see_all_visibility: parsed.see_all_visibility ?? false,
    active: parsed.active ?? true,
  });

  // Manager visibility assignments (required unless see-all).
  const visiblePublicIds = formData.getAll("visible_user_public_id").map(String).filter(Boolean);
  const visibleIds: number[] = [];
  for (const pid of visiblePublicIds) {
    visibleIds.push(await resolvePublicId("users", pid));
  }
  if (parsed.hierarchy_level === 2 && !(parsed.see_all_visibility ?? false) && visibleIds.length === 0) {
    throw new Error("MANAGER must have visibility assignments unless see_all_visibility is enabled");
  }
  if ((parsed.hierarchy_level === 1 || parsed.hierarchy_level === 2) && !(parsed.see_all_visibility ?? false)) {
    await replaceManagerVisibility({
      orgId,
      managerUserId: created.id,
      visibleUserIds: visibleIds,
      see_all_visibility: false,
    });
  } else if (parsed.hierarchy_level === 1 || parsed.hierarchy_level === 2) {
    await replaceManagerVisibility({ orgId, managerUserId: created.id, visibleUserIds: [], see_all_visibility: true });
  }

  revalidatePath("/admin/users");
  redirect(closeHref());
}

export async function updateUserAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();

  const parsed = UpdateSchema.parse({
    public_id: formData.get("public_id"),
    email: formData.get("email"),
    role: formData.get("role"),
    hierarchy_level: formData.get("hierarchy_level"),
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    account_owner_name: formData.get("account_owner_name") || undefined,
    manager_user_public_id: formData.get("manager_user_public_id") || undefined,
    admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access") || undefined,
    see_all_visibility: formData.get("see_all_visibility") || undefined,
    active: formData.get("active") || undefined,
  });

  const userId = await resolvePublicId("users", parsed.public_id);
  const existing = await getUserById({ orgId, userId });
  if (!existing) redirect(closeHref());

  if (ctx.kind === "user" && ctx.user.role === "MANAGER") {
    // Managers can only update REP users, and only for reps they manage (or unassigned reps they are claiming).
    if (existing.role !== "REP") redirect(closeHref());
    if (existing.manager_user_id != null && existing.manager_user_id !== ctx.user.id) redirect(closeHref());

    parsed.role = "REP";
    parsed.manager_user_public_id = ctx.user.public_id;
    parsed.hierarchy_level = 3;
    parsed.admin_has_full_analytics_access = false;
    parsed.see_all_visibility = false;
  } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const expectedLevel =
    parsed.role === "ADMIN" ? 0 : parsed.role === "EXEC_MANAGER" ? 1 : parsed.role === "MANAGER" ? 2 : 3;
  if (parsed.hierarchy_level !== expectedLevel) {
    throw new Error(`hierarchy_level must be ${expectedLevel} for role ${parsed.role}`);
  }

  let effectiveManagerId: number | null = null;
  if (parsed.role === "REP" || parsed.role === "MANAGER") {
    if (parsed.manager_user_public_id) {
      const id = await resolvePublicId("users", parsed.manager_user_public_id);
      if (id === userId) throw new Error("manager_user_id cannot reference the same user");
      const mgr = await getUserById({ orgId, userId: id });
      if (!mgr || mgr.role !== "MANAGER") throw new Error("manager_user_id must reference a MANAGER user in this org");
      effectiveManagerId = id;
    }
  }
  if (parsed.role !== "ADMIN") parsed.admin_has_full_analytics_access = false;
  if (parsed.role !== "MANAGER" && parsed.role !== "EXEC_MANAGER") parsed.see_all_visibility = false;
  // manager_user_id validity already checked above (if provided).

  const account_owner_name = String(parsed.account_owner_name || "").trim();
  if (parsed.hierarchy_level === 3 && !account_owner_name) throw new Error("account_owner_name is required for REPs");

  await updateUser({
    org_id: orgId,
    id: userId,
    email: parsed.email,
    role: parsed.role,
    hierarchy_level: parsed.hierarchy_level,
    first_name: parsed.first_name,
    last_name: parsed.last_name,
    display_name: buildDisplayName(parsed.first_name, parsed.last_name),
    account_owner_name: account_owner_name || null,
    manager_user_id: effectiveManagerId,
    admin_has_full_analytics_access: parsed.admin_has_full_analytics_access ?? existing.admin_has_full_analytics_access ?? false,
    see_all_visibility: parsed.see_all_visibility ?? existing.see_all_visibility ?? false,
    active: parsed.active ?? true,
  });

  const visiblePublicIds = formData.getAll("visible_user_public_id").map(String).filter(Boolean);
  const visibleIds: number[] = [];
  for (const pid of visiblePublicIds) {
    visibleIds.push(await resolvePublicId("users", pid));
  }
  if (parsed.hierarchy_level === 2 && !(parsed.see_all_visibility ?? false) && visibleIds.length === 0) {
    throw new Error("MANAGER must have visibility assignments unless see_all_visibility is enabled");
  }
  if ((parsed.hierarchy_level === 1 || parsed.hierarchy_level === 2) && !(parsed.see_all_visibility ?? false)) {
    await replaceManagerVisibility({
      orgId,
      managerUserId: userId,
      visibleUserIds: visibleIds,
      see_all_visibility: false,
    });
  } else if (parsed.hierarchy_level === 1 || parsed.hierarchy_level === 2) {
    await replaceManagerVisibility({ orgId, managerUserId: userId, visibleUserIds: [], see_all_visibility: true });
  } else {
    // Non-manager: clear edges + disable see-all.
    await replaceManagerVisibility({ orgId, managerUserId: userId, visibleUserIds: [], see_all_visibility: false }).catch(() => null);
  }

  revalidatePath("/admin/users");
  redirect(closeHref());
}

export async function deleteUserAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  const parsed = z.object({ public_id: z.string().uuid() }).parse({ public_id: formData.get("public_id") });
  const userId = await resolvePublicId("users", parsed.public_id);

  const existing = await getUserById({ orgId, userId });
  if (!existing) redirect(closeHref());

  if (ctx.kind === "user" && ctx.user.role === "MANAGER") {
    if (existing.role !== "REP") redirect(closeHref());
    if (existing.manager_user_id !== ctx.user.id) redirect(closeHref());
  } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  await deleteUser({ orgId, userId });
  revalidatePath("/admin/users");
  redirect(closeHref());
}

export async function generateResetLinkAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect(closeHref());

  const parsed = z.object({ public_id: z.string().uuid() }).parse({ public_id: formData.get("public_id") });
  const userId = await resolvePublicId("users", parsed.public_id);
  const u = await getUserById({ orgId, userId });
  if (!u) redirect(closeHref());

  const token = randomToken();
  await createPasswordResetToken({ userId: u.id, token_hash: sha256Hex(token), expires_at: new Date(Date.now() + 60 * 60 * 1000) });

  revalidatePath("/admin/users");
  if (process.env.NODE_ENV !== "production") {
    redirect(`/admin/users?reset=${encodeURIComponent(`/reset-password?token=${token}`)}`);
  }
  redirect(`/admin/users?reset=sent`);
}

export async function assignRepToMeAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "user" || ctx.user.role !== "MANAGER") redirect(closeHref());

  const parsed = z.object({ public_id: z.string().uuid() }).parse({ public_id: formData.get("public_id") });
  const userId = await resolvePublicId("users", parsed.public_id);
  const existing = await getUserById({ orgId, userId });
  if (!existing || existing.role !== "REP") redirect(closeHref());
  if (existing.manager_user_id != null && existing.manager_user_id !== ctx.user.id) redirect(closeHref());

  await setUserManagerUserId({ orgId, userId: existing.id, manager_user_id: ctx.user.id });
  revalidatePath("/admin/users");
  redirect(closeHref());
}

export async function listUsersForPickerAction() {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") return [];
  return await listUsers({ orgId, includeInactive: true });
}

