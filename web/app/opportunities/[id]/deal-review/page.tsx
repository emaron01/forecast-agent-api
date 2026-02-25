import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { UserTopNav } from "../../../_components/UserTopNav";
import { DealReviewClient } from "./DealReviewClient";
import { pool } from "../../../../lib/pool";
import { resolvePublicId } from "../../../../lib/publicId";
import { closedOutcomeFromOpportunityRow } from "../../../../lib/opportunityOutcome";

export const runtime = "nodejs";

const PAPER_PROCESS_PREFILL = `Who (legal/procurement contact): 
What artifact (PO, MSA, redlines): 
When (date / next milestone): 
Current status (e.g., procurement cutting PO): `;

export default async function DealReviewPage(
  ctx: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }
) {
  const auth = await requireAuth();
  if (auth.kind === "master") redirect("/admin/organizations");
  if (auth.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: auth.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const { id } = await ctx.params;
  const opportunityPublicId = String(id || "").trim();
  if (!opportunityPublicId) redirect("/forecast");

  const rawParams = ctx.searchParams ? await ctx.searchParams : {};
  const category = String(Array.isArray(rawParams?.category) ? rawParams.category[0] : rawParams?.category || "").trim() || undefined;
  const prefillRaw = String(Array.isArray(rawParams?.prefill) ? rawParams.prefill[0] : rawParams?.prefill || "").trim();
  const prefill = prefillRaw || (category === "paper" ? PAPER_PROCESS_PREFILL : undefined);

  // Block Deal Review for closed opportunities (Won/Lost).
  try {
    const internalId = await resolvePublicId("opportunities", opportunityPublicId);
    const { rows } = await pool.query(`SELECT sales_stage, forecast_stage FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`, [
      auth.user.org_id,
      internalId,
    ]);
    const opp = rows?.[0] || null;
    const closed = closedOutcomeFromOpportunityRow({ ...opp, stage: opp?.sales_stage });
    if (closed) redirect("/forecast");
  } catch {
    // If we can't load the row, let the client page handle missing/unauthorized.
  }

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={auth.user} />
      <DealReviewClient opportunityId={opportunityPublicId} initialCategory={category} initialPrefill={prefill} />
    </div>
  );
}

