import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function EditUserPage({ params }: { params: { id: string } }) {
  const id = encodeURIComponent(String(params.id || ""));
  redirect(`/admin/users?modal=edit&id=${id}`);
}

