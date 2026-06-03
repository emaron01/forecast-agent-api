import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function AdminDashboardV2Redirect() {
  redirect("/admin");
}
