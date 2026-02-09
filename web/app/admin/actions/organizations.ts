"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../lib/auth";
import { createOrganization, deleteOrganization, updateOrganization } from "../../../lib/db";

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

