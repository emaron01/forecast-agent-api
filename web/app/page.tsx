import { redirect } from "next/navigation";
import { requireAuth } from "../lib/auth";
import { isAdmin } from "../lib/roleHelpers";

export default async function Page() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (isAdmin(ctx.user)) redirect("/admin");
  redirect("/dashboard");
}

