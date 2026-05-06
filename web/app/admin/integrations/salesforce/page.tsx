import { redirect } from "next/navigation";
import { requireAuth, getMasterOrgIdFromCookies } from "../../../../lib/auth";
import { isAdmin } from "../../../../lib/roleHelpers";
import { SalesforceIntegrationShell } from "./SalesforceIntegrationShell";

export const runtime = "nodejs";

export default async function SalesforceIntegrationPage() {
  const ctx = await requireAuth();
  let orgId = 0;
  if (ctx.kind === "user") {
    if (!isAdmin(ctx.user)) redirect("/admin");
    orgId = ctx.user.org_id;
  } else {
    const mid = getMasterOrgIdFromCookies();
    if (!mid) redirect("/admin/organizations");
    orgId = mid;
  }
  return <SalesforceIntegrationShell orgId={orgId} />;
}
