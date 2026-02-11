import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { UserTopNav } from "../../../_components/UserTopNav";
import { DealReviewClient } from "./DealReviewClient";

export const runtime = "nodejs";

export default async function DealReviewPage(ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.kind === "master") redirect("/admin/organizations");
  if (auth.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: auth.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const { id } = await ctx.params;

  return (
    <div className="min-h-screen bg-slate-50">
      <UserTopNav orgName={orgName} user={auth.user} />
      <DealReviewClient opportunityId={String(id || "").trim()} />
    </div>
  );
}

