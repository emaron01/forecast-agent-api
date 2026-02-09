"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../lib/auth";
import { randomToken, sha256Hex } from "../../../lib/auth";
import { hashPassword } from "../../../lib/password";
import { createOrganization, createOrganizationWithFirstAdmin, deleteOrganization, updateOrganization } from "../../../lib/db";

const UpsertSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().min(1),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : true)),
  parent_org_id: z.coerce.number().int().positive().optional(),
  billing_plan: z.string().optional(),
  hq_address_line1: z.string().optional(),
  hq_address_line2: z.string().optional(),
  hq_city: z.string().optional(),
  hq_state: z.string().optional(),
  hq_postal_code: z.string().optional(),
  hq_country: z.string().optional(),
});

function norm(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export async function createOrganizationAction(formData: FormData) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = UpsertSchema.omit({ id: true }).parse({
    name: formData.get("name"),
    active: formData.get("active") || undefined,
    parent_org_id: formData.get("parent_org_id") || undefined,
    billing_plan: formData.get("billing_plan") || undefined,
    hq_address_line1: formData.get("hq_address_line1") || undefined,
    hq_address_line2: formData.get("hq_address_line2") || undefined,
    hq_city: formData.get("hq_city") || undefined,
    hq_state: formData.get("hq_state") || undefined,
    hq_postal_code: formData.get("hq_postal_code") || undefined,
    hq_country: formData.get("hq_country") || undefined,
  });

  await createOrganization({
    name: parsed.name,
    active: parsed.active ?? true,
    parent_org_id: parsed.parent_org_id ?? null,
    billing_plan: norm(parsed.billing_plan),
    hq_address_line1: norm(parsed.hq_address_line1),
    hq_address_line2: norm(parsed.hq_address_line2),
    hq_city: norm(parsed.hq_city),
    hq_state: norm(parsed.hq_state),
    hq_postal_code: norm(parsed.hq_postal_code),
    hq_country: norm(parsed.hq_country),
  });
  revalidatePath("/admin/organizations");
  redirect("/admin/organizations");
}

const CreateWithAdminSchema = UpsertSchema.omit({ id: true }).extend({
  admin_email: z.string().min(1),
  admin_password: z.string().optional(),
  admin_first_name: z.string().min(1),
  admin_last_name: z.string().min(1),
  admin_account_owner_name: z.string().min(1),
  admin_has_full_analytics_access: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : false)),
});

function buildDisplayName(first_name: string, last_name: string) {
  return `${String(first_name || "").trim()} ${String(last_name || "").trim()}`.trim();
}

export async function createOrganizationWithFirstAdminAction(formData: FormData) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = CreateWithAdminSchema.parse({
    name: formData.get("name"),
    active: formData.get("active") || undefined,
    parent_org_id: formData.get("parent_org_id") || undefined,
    billing_plan: formData.get("billing_plan") || undefined,
    hq_address_line1: formData.get("hq_address_line1") || undefined,
    hq_address_line2: formData.get("hq_address_line2") || undefined,
    hq_city: formData.get("hq_city") || undefined,
    hq_state: formData.get("hq_state") || undefined,
    hq_postal_code: formData.get("hq_postal_code") || undefined,
    hq_country: formData.get("hq_country") || undefined,

    admin_email: formData.get("admin_email"),
    admin_password: formData.get("admin_password") || undefined,
    admin_first_name: formData.get("admin_first_name"),
    admin_last_name: formData.get("admin_last_name"),
    admin_account_owner_name: formData.get("admin_account_owner_name"),
    admin_has_full_analytics_access: formData.get("admin_has_full_analytics_access") || undefined,
  });

  const email = String(parsed.admin_email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("admin_email is required");

  const pw = String(parsed.admin_password || "");
  if (pw && pw.length < 8) throw new Error("admin_password must be at least 8 characters (or leave blank to invite)");
  const password_hash = await hashPassword(pw || randomToken());

  const inviteReset =
    pw.trim() === ""
      ? { token: randomToken(), expires_at: new Date(Date.now() + 60 * 60 * 1000) } // 1 hour
      : null;

  const created = await createOrganizationWithFirstAdmin({
    organization: {
      name: parsed.name,
      active: parsed.active ?? true,
      parent_org_id: parsed.parent_org_id ?? null,
      billing_plan: norm(parsed.billing_plan),
      hq_address_line1: norm(parsed.hq_address_line1),
      hq_address_line2: norm(parsed.hq_address_line2),
      hq_city: norm(parsed.hq_city),
      hq_state: norm(parsed.hq_state),
      hq_postal_code: norm(parsed.hq_postal_code),
      hq_country: norm(parsed.hq_country),
    },
    admin: {
      email,
      password_hash,
      first_name: parsed.admin_first_name,
      last_name: parsed.admin_last_name,
      display_name: buildDisplayName(parsed.admin_first_name, parsed.admin_last_name),
      account_owner_name: parsed.admin_account_owner_name,
      admin_has_full_analytics_access: parsed.admin_has_full_analytics_access ?? false,
      active: true,
    },
    inviteReset: inviteReset ? { token_hash: sha256Hex(inviteReset.token), expires_at: inviteReset.expires_at } : null,
  });

  revalidatePath("/admin/organizations");

  const params = new URLSearchParams();
  params.set("createdOrgId", String(created.org.id));
  params.set("createdAdminEmail", created.user.email);
  if (inviteReset) {
    if (process.env.NODE_ENV !== "production") {
      params.set("reset", `/reset-password?token=${inviteReset.token}`);
    } else {
      params.set("reset", "sent");
    }
  }

  redirect(`/admin/organizations?${params.toString()}`);
}

export async function updateOrganizationAction(formData: FormData) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = UpsertSchema.extend({ id: z.coerce.number().int().positive() }).parse({
    id: formData.get("id"),
    name: formData.get("name"),
    active: formData.get("active") || undefined,
    parent_org_id: formData.get("parent_org_id") || undefined,
    billing_plan: formData.get("billing_plan") || undefined,
    hq_address_line1: formData.get("hq_address_line1") || undefined,
    hq_address_line2: formData.get("hq_address_line2") || undefined,
    hq_city: formData.get("hq_city") || undefined,
    hq_state: formData.get("hq_state") || undefined,
    hq_postal_code: formData.get("hq_postal_code") || undefined,
    hq_country: formData.get("hq_country") || undefined,
  });

  await updateOrganization({
    id: parsed.id,
    name: parsed.name,
    active: parsed.active ?? true,
    parent_org_id: parsed.parent_org_id ?? null,
    billing_plan: norm(parsed.billing_plan),
    hq_address_line1: norm(parsed.hq_address_line1),
    hq_address_line2: norm(parsed.hq_address_line2),
    hq_city: norm(parsed.hq_city),
    hq_state: norm(parsed.hq_state),
    hq_postal_code: norm(parsed.hq_postal_code),
    hq_country: norm(parsed.hq_country),
  });
  revalidatePath("/admin/organizations");
  redirect("/admin/organizations");
}

export async function deleteOrganizationAction(formData: FormData) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = z
    .object({ id: z.coerce.number().int().positive() })
    .parse({ id: formData.get("id") });

  await deleteOrganization({ id: parsed.id });
  revalidatePath("/admin/organizations");
  redirect("/admin/organizations");
}

