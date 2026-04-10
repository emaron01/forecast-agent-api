import { redirect } from "next/navigation";
import { requireAuth } from "../lib/auth";
import { isAdmin } from "../lib/roleHelpers";

export default async function Page() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (isAdmin(ctx.user)) {
    redirect(ctx.user.admin_has_full_analytics_access ? "/dashboard/executive" : "/admin");
  }
  redirect("/dashboard");
}

