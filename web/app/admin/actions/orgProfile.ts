"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "../../../lib/auth";
import { getOrganization, updateOrganization } from "../../../lib/db";

const Schema = z.object({
  billing_plan: z.string().optional(),
  parent_org_id: z.coerce.number().int().positive().optional(),
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

export async function updateOrgProfileAction(formData: FormData) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const org = await getOrganization({ id: orgId });
  if (!org) redirect("/admin");

  const parsed = Schema.parse({
    billing_plan: formData.get("billing_plan") ?? undefined,
    parent_org_id: formData.get("parent_org_id") || undefined,
    hq_address_line1: formData.get("hq_address_line1") ?? undefined,
    hq_address_line2: formData.get("hq_address_line2") ?? undefined,
    hq_city: formData.get("hq_city") ?? undefined,
    hq_state: formData.get("hq_state") ?? undefined,
    hq_postal_code: formData.get("hq_postal_code") ?? undefined,
    hq_country: formData.get("hq_country") ?? undefined,
  });

  await updateOrganization({
    id: org.id,
    name: org.name,
    active: org.active,
    parent_org_id: ctx.kind === "master" ? (parsed.parent_org_id ?? org.parent_org_id) : org.parent_org_id,
    billing_plan: norm(parsed.billing_plan) ?? org.billing_plan,
    hq_address_line1: norm(parsed.hq_address_line1) ?? org.hq_address_line1,
    hq_address_line2: norm(parsed.hq_address_line2) ?? org.hq_address_line2,
    hq_city: norm(parsed.hq_city) ?? org.hq_city,
    hq_state: norm(parsed.hq_state) ?? org.hq_state,
    hq_postal_code: norm(parsed.hq_postal_code) ?? org.hq_postal_code,
    hq_country: norm(parsed.hq_country) ?? org.hq_country,
  });

  revalidatePath("/admin/org-profile");
  redirect("/admin/org-profile?saved=1");
}

