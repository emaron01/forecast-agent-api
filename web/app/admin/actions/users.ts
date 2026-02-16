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

const CheckboxBool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

function isNextRedirectError(e: unknown) {
  return typeof (e as any)?.digest === "string" && String((e as any).digest).startsWith("NEXT_REDIRECT");
}

function buildErrorRedirect(params: Record<string, string | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = String(v ?? "").trim();
    if (s) sp.set(k, s);
  }
  return `/admin/users?${sp.toString()}`;
}

const CreateSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(8),
  confirm_password: z.string().min(8),
  role: z.enum(["ADMIN", "EXEC_MANAGER", "MANAGER", "REP"]),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  title: z.string().max(100).optional(),
  account_owner_name: z.string().optional(),
  manager_user_public_id: z.string().uuid().optional(),
  admin_has_full_analytics_access: CheckboxBool.optional(),
  see_all_visibility: CheckboxBool.optional(),
  active: CheckboxBool.optional(),
});

const UpdateSchema = z.object({
  public_id: z.string().uuid(),
  email: z.string().min(1),
  role: z.enum(["ADMIN", "EXEC_MANAGER", "MANAGER", "REP"]),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  title: z.string().max(100).optional(),
  account_owner_name: z.string().optional(),
  manager_user_public_id: z.string().uuid().optional(),
  admin_has_full_analytics_access: CheckboxBool.optional(),
  see_all_visibility: CheckboxBool.optional(),
  active: CheckboxBool.optional(),
});

function closeHref() {
  return "/admin/users";
}

function buildSuccessRedirect(params: Record<string, string | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = String(v ?? "").trim();
    if (s) sp.set(k, s);
  }
  return `/admin/users?${sp.toString()}`;
}

function buildDisplayName(first_name: string, last_name: string) {
  return `${String(first_name || "").trim()} ${String(last_name || "").trim()}`.trim();
}

async function syncDirectReportsFromVisibility(args: {
  orgId: number;
  managerUserId: number;
  managerRole: "EXEC_MANAGER" | "MANAGER";
  visibleUserIds: number[];
}) {
  const all = await listUsers({ orgId: args.orgId, includeInactive: true }).catch(() => []);
  const userById = new Map<number, any>();
  for (const u of all as any[]) {
    userById.set(Number((u as any)?.id), u);
  }

  const targetRole = args.managerRole === "EXEC_MANAGER" ? "MANAGER" : "REP";
  const desired = new Set<number>();

  for (const id of args.visibleUserIds) {
    const u = userById.get(Number(id));
    if (!u) continue;
    if (String(u.role) !== targetRole) continue;
    desired.add(Number(id));
  }

  // Assign selected direct reports.
  for (const id of desired) {
    await setUserManagerUserId({ orgId: args.orgId, userId: id, manager_user_id: args.managerUserId });
  }

  // Unassign any previous direct reports that are no longer selected.
  for (const u of all as any[]) {
    if (String(u.role) !== targetRole) continue;
    if (u.manager_user_id == null) continue;
    if (Number(u.manager_user_id) !== args.managerUserId) continue;
    if (desired.has(Number(u.id))) continue;
    await setUserManagerUserId({ orgId: args.orgId, userId: Number(u.id), manager_user_id: null });
  }
}

export async function createUserAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();

  // Prefill params (never include password fields).
  const prefill = {
    modal: "new",
    email: String(formData.get("email") || ""),
    first_name: String(formData.get("first_name") || ""),
    last_name: String(formData.get("last_name") || ""),
    title: String(formData.get("title") || ""),
    role: String(formData.get("role") || ""),
    account_owner_name: String(formData.get("account_owner_name") || ""),
    manager_user_public_id: String(formData.get("manager_user_public_id") || ""),
    see_all_visibility: formData.get("see_all_visibility") ? "true" : "false",
    admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access") ? "true" : "false",
    active: formData.get("active") ? "true" : "false",
  };

  try {
    const parsed = CreateSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
      confirm_password: formData.get("confirm_password"),
      role: formData.get("role"),
      first_name: formData.get("first_name"),
      last_name: formData.get("last_name"),
      title: formData.get("title") || undefined,
      account_owner_name: formData.get("account_owner_name") || undefined,
      manager_user_public_id: formData.get("manager_user_public_id") || undefined,
      admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access"),
      see_all_visibility: formData.get("see_all_visibility"),
      active: formData.get("active"),
    });

    if (ctx.kind === "user" && ctx.user.role === "MANAGER") {
      // Managers can only create REP users and assign them to themselves.
      parsed.role = "REP";
      parsed.manager_user_public_id = ctx.user.public_id;
      parsed.admin_has_full_analytics_access = false;
      parsed.see_all_visibility = false;
    } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
      redirect("/dashboard");
    }

    if (String(parsed.password || "") !== String(parsed.confirm_password || "")) {
      redirect(buildErrorRedirect({ ...prefill, error: "passwords_do_not_match" }));
    }

    // Deterministic mapping: role -> hierarchy_level
    const expectedLevel =
      parsed.role === "ADMIN" ? 0 : parsed.role === "EXEC_MANAGER" ? 1 : parsed.role === "MANAGER" ? 2 : 3;
    const hierarchy_level = expectedLevel;

    // Only REP/MANAGER users should have a manager_user_id.
    let effectiveManagerId: number | null = null;
    if (parsed.role === "REP" || parsed.role === "MANAGER") {
      if (parsed.manager_user_public_id) {
        const id = await resolvePublicId("users", parsed.manager_user_public_id);
        const mgr = await getUserById({ orgId, userId: id });
        if (!mgr) throw new Error("manager_user_id must reference a user in this org");
        if (parsed.role === "REP" && mgr.role !== "MANAGER") {
          throw new Error("REP manager must be a MANAGER user in this org");
        }
        if (parsed.role === "MANAGER" && mgr.role !== "EXEC_MANAGER") {
          throw new Error("MANAGER manager must be an EXEC_MANAGER user in this org");
        }
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
    if (hierarchy_level === 3 && !account_owner_name) throw new Error("account_owner_name is required for REPs");

    const password_hash = await hashPassword(String(parsed.password));

    const created = await createUser({
      org_id: orgId,
      email: parsed.email,
      password_hash,
      role: parsed.role,
      hierarchy_level,
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      display_name: buildDisplayName(parsed.first_name, parsed.last_name),
      title: String(parsed.title || "").trim() || null,
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
    if (hierarchy_level === 2 && !(parsed.see_all_visibility ?? false) && visibleIds.length === 0) {
      throw new Error("MANAGER must have visibility assignments unless see_all_visibility is enabled");
    }
    if ((hierarchy_level === 1 || hierarchy_level === 2) && !(parsed.see_all_visibility ?? false)) {
      await replaceManagerVisibility({
        orgId,
        managerUserId: created.id,
        visibleUserIds: visibleIds,
        see_all_visibility: false,
      });
      // Treat visibility assignments as direct-report assignments.
      await syncDirectReportsFromVisibility({
        orgId,
        managerUserId: created.id,
        managerRole: parsed.role === "EXEC_MANAGER" ? "EXEC_MANAGER" : "MANAGER",
        visibleUserIds: visibleIds,
      });
    } else if (hierarchy_level === 1 || hierarchy_level === 2) {
      await replaceManagerVisibility({ orgId, managerUserId: created.id, visibleUserIds: [], see_all_visibility: true });
    }

    revalidatePath("/admin/users");
    redirect(buildSuccessRedirect({ created: created.public_id }));
  } catch (e) {
    if (isNextRedirectError(e)) throw e;
    const msg = String((e as any)?.message || "");
    if (msg.toLowerCase().includes("passwords do not match")) {
      redirect(buildErrorRedirect({ ...prefill, error: "passwords_do_not_match" }));
    }
    if (msg.toLowerCase().includes("account_owner_name is required")) {
      redirect(buildErrorRedirect({ ...prefill, error: "missing_account_owner_name" }));
    }
    if (msg.toLowerCase().includes("visibility assignments")) {
      redirect(buildErrorRedirect({ ...prefill, error: "missing_visibility_assignments" }));
    }
    if (msg.toLowerCase().includes("duplicate key") || msg.toLowerCase().includes("already exists")) {
      redirect(buildErrorRedirect({ ...prefill, error: "email_in_use" }));
    }
    if (msg.toLowerCase().includes("manager_user_id")) {
      redirect(buildErrorRedirect({ ...prefill, error: "invalid_manager" }));
    }
    redirect(buildErrorRedirect({ ...prefill, error: "invalid_request" }));
  }
}

export async function updateUserAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();

  const parsed = UpdateSchema.parse({
    public_id: formData.get("public_id"),
    email: formData.get("email"),
    role: formData.get("role"),
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    title: formData.get("title") || undefined,
    account_owner_name: formData.get("account_owner_name") || undefined,
    manager_user_public_id: formData.get("manager_user_public_id") || undefined,
    admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access"),
    see_all_visibility: formData.get("see_all_visibility"),
    active: formData.get("active"),
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
    parsed.admin_has_full_analytics_access = false;
    parsed.see_all_visibility = false;
  } else if (ctx.kind === "user" && ctx.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const expectedLevel =
    parsed.role === "ADMIN" ? 0 : parsed.role === "EXEC_MANAGER" ? 1 : parsed.role === "MANAGER" ? 2 : 3;
  const hierarchy_level = expectedLevel;

  let effectiveManagerId: number | null = null;
  if (parsed.role === "REP" || parsed.role === "MANAGER") {
    if (parsed.manager_user_public_id) {
      const id = await resolvePublicId("users", parsed.manager_user_public_id);
      if (id === userId) throw new Error("manager_user_id cannot reference the same user");
      const mgr = await getUserById({ orgId, userId: id });
      if (!mgr) throw new Error("manager_user_id must reference a user in this org");
      if (parsed.role === "REP" && mgr.role !== "MANAGER") {
        throw new Error("REP manager must be a MANAGER user in this org");
      }
      if (parsed.role === "MANAGER" && mgr.role !== "EXEC_MANAGER") {
        throw new Error("MANAGER manager must be an EXEC_MANAGER user in this org");
      }
      effectiveManagerId = id;
    }
  }
  if (parsed.role !== "ADMIN") parsed.admin_has_full_analytics_access = false;
  if (parsed.role !== "MANAGER" && parsed.role !== "EXEC_MANAGER") parsed.see_all_visibility = false;
  // manager_user_id validity already checked above (if provided).

  const account_owner_name = String(parsed.account_owner_name || "").trim();
  if (hierarchy_level === 3 && !account_owner_name) throw new Error("account_owner_name is required for REPs");

  await updateUser({
    org_id: orgId,
    id: userId,
    email: parsed.email,
    role: parsed.role,
    hierarchy_level,
    first_name: parsed.first_name,
    last_name: parsed.last_name,
    display_name: buildDisplayName(parsed.first_name, parsed.last_name),
    title: String(parsed.title || "").trim() || null,
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
  if (hierarchy_level === 2 && !(parsed.see_all_visibility ?? false) && visibleIds.length === 0) {
    throw new Error("MANAGER must have visibility assignments unless see_all_visibility is enabled");
  }
  if ((hierarchy_level === 1 || hierarchy_level === 2) && !(parsed.see_all_visibility ?? false)) {
    await replaceManagerVisibility({
      orgId,
      managerUserId: userId,
      visibleUserIds: visibleIds,
      see_all_visibility: false,
    });
    // Treat visibility assignments as direct-report assignments.
    await syncDirectReportsFromVisibility({
      orgId,
      managerUserId: userId,
      managerRole: parsed.role === "EXEC_MANAGER" ? "EXEC_MANAGER" : "MANAGER",
      visibleUserIds: visibleIds,
    });
  } else if (hierarchy_level === 1 || hierarchy_level === 2) {
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

