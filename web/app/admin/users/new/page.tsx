import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function NewUserPage() {
  redirect("/admin/users?modal=new");
}

