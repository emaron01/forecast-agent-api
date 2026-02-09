import { redirect } from "next/navigation";
import { getAuth } from "../lib/auth";

export default async function Page() {
  const ctx = await getAuth();
  if (!ctx) redirect("/login");
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");
  redirect("/dashboard");
}

