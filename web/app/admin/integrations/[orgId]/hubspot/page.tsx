import { redirect } from "next/navigation";
import { requireAuth } from "../../../../../lib/auth";
import { resolvePublicId } from "../../../../../lib/publicId";
import { HubspotIntegrationShell } from "../../hubspot/HubspotIntegrationShell";

export const runtime = "nodejs";

export default async function HubspotIntegrationForOrgPage({ params }: { params: { orgId: string } }) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin/integrations/hubspot");

  const orgPublicId = String(params?.orgId || "").trim();
  if (!orgPublicId) redirect("/admin/integrations");

  let orgId = 0;
  try {
    orgId = await resolvePublicId("organizations", orgPublicId);
  } catch {
    redirect("/admin/integrations");
  }
  if (!orgId) redirect("/admin/integrations");

  return <HubspotIntegrationShell orgId={orgId} />;
}
