import { redirect } from "next/navigation";
import { requireAuth } from "../lib/auth";

export default async function Page() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");
  redirect("/dashboard");
}

