"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../lib/auth";
import { upsertEmailTemplate } from "../../../lib/db";

const UpsertSchema = z.object({
  template_key: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : true)),
});

export async function upsertEmailTemplateAction(formData: FormData) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const parsed = UpsertSchema.parse({
    template_key: formData.get("template_key"),
    subject: formData.get("subject"),
    body: formData.get("body"),
    active: formData.get("active") || undefined,
  });

  await upsertEmailTemplate({
    template_key: parsed.template_key,
    subject: parsed.subject,
    body: parsed.body,
    active: parsed.active ?? true,
  });

  revalidatePath("/admin/email-templates");
  redirect("/admin/email-templates");
}

