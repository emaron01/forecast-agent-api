import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { UserTopNav } from "../../../_components/UserTopNav";
import { ReviewQueueClient } from "./reviewQueueClient";

export const runtime = "nodejs";

export default async function ReviewQueuePage(ctx: { params: Promise<{ runId: string }> }) {
  const auth = await requireAuth();
  if (auth.kind === "master") redirect("/admin/organizations");
  if (auth.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: auth.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const { runId } = await ctx.params;

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={auth.user} />
      <main className="mx-auto max-w-6xl p-6">
        <ReviewQueueClient runId={String(runId || "").trim()} />
      </main>
    </div>
  );
}

