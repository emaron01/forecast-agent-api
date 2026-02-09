"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "../../../lib/auth";
import {
  createPasswordResetToken,
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  setUserManagerUserId,
  updateUser,
} from "../../../lib/db";
import { hashPassword } from "../../../lib/password";
import { randomToken, sha256Hex } from "../../../lib/auth";

const CreateSchema = z.object({
  email: z.string().min(1),
  password: z.string().optional(),
  role: z.enum(["ADMIN", "MANAGER", "REP"]),
  hierarchy_level: z.coerce.number().int().min(0).optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  account_owner_name: z.string().min(1),
  manager_user_id: z.coerce.number().int().positive().optional(),
  admin_has_full_analytics_access: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : false)),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : true)),
});

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  email: z.string().min(1),
  role: z.enum(["ADMIN", "MANAGER", "REP"]),
  hierarchy_level: z.coerce.number().int().min(0).optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  account_owner_name: z.string().min(1),
  manager_user_id: z.coerce.number().int().positive().optional(),
  admin_has_full_analytics_access: z
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
    password: formData.get("password") || undefined,
    role: formData.get("role"),
    hierarchy_level: formData.get("hierarchy_level") || undefined,
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    account_owner_name: formData.get("account_owner_name"),
    manager_user_id: formData.get("manager_user_id") || undefined,
    admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access") || undefined,
    active: formData.get("active") || undefined,
  });

  if (ctx.kind === "user" && ctx.user.role === "MANAGER") {
    // Managers can only create REP users and assign them to themselves.
    parsed.role = "REP";
    parsed.manager_user_id = ctx.user.id;
    parsed.hierarchy_level = 0;
    parsed.admin_has_full_analytics_access = false;
  } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  // Only REP/MANAGER users should have a manager_user_id.
  if (parsed.role !== "REP" && parsed.role !== "MANAGER") parsed.manager_user_id = undefined;

  // Only ADMIN users can have admin_has_full_analytics_access.
  if (parsed.role !== "ADMIN") parsed.admin_has_full_analytics_access = false;

  // Default hierarchy levels if omitted.
  if (parsed.role === "REP") parsed.hierarchy_level = 0;
  if (parsed.role === "MANAGER" && parsed.hierarchy_level == null) parsed.hierarchy_level = 1;
  if (parsed.role === "ADMIN" && parsed.hierarchy_level == null) parsed.hierarchy_level = 0;

  // If a manager is provided, ensure it's a MANAGER in this org.
  if ((parsed.role === "REP" || parsed.role === "MANAGER") && parsed.manager_user_id != null) {
    const mgr = await getUserById({ orgId, userId: parsed.manager_user_id });
    if (!mgr || mgr.role !== "MANAGER") throw new Error("manager_user_id must reference a MANAGER user in this org");
  }

  const pw = String(parsed.password || "");
  if (pw && pw.length < 8) throw new Error("password must be at least 8 characters (or leave blank to invite)");
  const password_hash = await hashPassword(pw || randomToken());

  const created = await createUser({
    org_id: orgId,
    email: parsed.email,
    password_hash,
    role: parsed.role,
    hierarchy_level: parsed.hierarchy_level ?? 0,
    first_name: parsed.first_name,
    last_name: parsed.last_name,
    display_name: buildDisplayName(parsed.first_name, parsed.last_name),
    account_owner_name: parsed.account_owner_name,
    manager_user_id: parsed.manager_user_id ?? null,
    admin_has_full_analytics_access: parsed.admin_has_full_analytics_access ?? false,
    active: parsed.active ?? true,
  });

  // Invite-only UX: if no password supplied, generate a password-set link (dev shows link).
  if (!pw) {
    const token = randomToken();
    await createPasswordResetToken({ userId: created.id, token_hash: sha256Hex(token), expires_at: new Date(Date.now() + 60 * 60 * 1000) });
    revalidatePath("/admin/users");
    if (process.env.NODE_ENV !== "production") {
      redirect(`/admin/users?reset=${encodeURIComponent(`/reset-password?token=${token}`)}`);
    }
    redirect(`/admin/users?reset=sent`);
  }

  revalidatePath("/admin/users");
  redirect(closeHref());
}

export async function updateUserAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();

  const parsed = UpdateSchema.parse({
    id: formData.get("id"),
    email: formData.get("email"),
    role: formData.get("role"),
    hierarchy_level: formData.get("hierarchy_level") || undefined,
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    account_owner_name: formData.get("account_owner_name"),
    manager_user_id: formData.get("manager_user_id") || undefined,
    admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access") || undefined,
    active: formData.get("active") || undefined,
  });

  const existing = await getUserById({ orgId, userId: parsed.id });
  if (!existing) redirect(closeHref());

  if (ctx.kind === "user" && ctx.user.role === "MANAGER") {
    // Managers can only update REP users, and only for reps they manage (or unassigned reps they are claiming).
    if (existing.role !== "REP") redirect(closeHref());
    if (existing.manager_user_id != null && existing.manager_user_id !== ctx.user.id) redirect(closeHref());

    parsed.role = "REP";
    parsed.manager_user_id = ctx.user.id;
    parsed.hierarchy_level = 0;
    parsed.admin_has_full_analytics_access = false;
  } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  if (parsed.role !== "REP" && parsed.role !== "MANAGER") parsed.manager_user_id = undefined;
  if (parsed.role !== "ADMIN") parsed.admin_has_full_analytics_access = false;

  if (parsed.role === "REP") parsed.hierarchy_level = 0;
  if (parsed.role === "MANAGER" && parsed.hierarchy_level == null) parsed.hierarchy_level = 1;
  if (parsed.role === "ADMIN" && parsed.hierarchy_level == null) parsed.hierarchy_level = existing.hierarchy_level ?? 0;

  if ((parsed.role === "REP" || parsed.role === "MANAGER") && parsed.manager_user_id != null) {
    if (parsed.manager_user_id === parsed.id) throw new Error("manager_user_id cannot reference the same user");
    const mgr = await getUserById({ orgId, userId: parsed.manager_user_id });
    if (!mgr || mgr.role !== "MANAGER") throw new Error("manager_user_id must reference a MANAGER user in this org");
  }

  await updateUser({
    org_id: orgId,
    id: parsed.id,
    email: parsed.email,
    role: parsed.role,
    hierarchy_level: parsed.hierarchy_level ?? existing.hierarchy_level ?? 0,
    first_name: parsed.first_name,
    last_name: parsed.last_name,
    display_name: buildDisplayName(parsed.first_name, parsed.last_name),
    account_owner_name: parsed.account_owner_name,
    manager_user_id: parsed.manager_user_id ?? null,
    admin_has_full_analytics_access: parsed.admin_has_full_analytics_access ?? existing.admin_has_full_analytics_access ?? false,
    active: parsed.active ?? true,
  });

  revalidatePath("/admin/users");
  redirect(closeHref());
}

export async function deleteUserAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  const parsed = z.object({ id: z.coerce.number().int().positive() }).parse({ id: formData.get("id") });

  const existing = await getUserById({ orgId, userId: parsed.id });
  if (!existing) redirect(closeHref());

  if (ctx.kind === "user" && ctx.user.role === "MANAGER") {
    if (existing.role !== "REP") redirect(closeHref());
    if (existing.manager_user_id !== ctx.user.id) redirect(closeHref());
  } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  await deleteUser({ orgId, userId: parsed.id });
  revalidatePath("/admin/users");
  redirect(closeHref());
}

export async function generateResetLinkAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect(closeHref());

  const parsed = z.object({ id: z.coerce.number().int().positive() }).parse({ id: formData.get("id") });
  const u = await getUserById({ orgId, userId: parsed.id });
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

  const parsed = z.object({ id: z.coerce.number().int().positive() }).parse({ id: formData.get("id") });
  const existing = await getUserById({ orgId, userId: parsed.id });
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

