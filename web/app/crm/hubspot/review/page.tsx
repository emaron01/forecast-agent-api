import { redirect } from "next/navigation";
import { verifyExtensionToken } from "../../../../lib/hubspotExtensionJwt";
import { DealReviewClient } from "../../../opportunities/[id]/deal-review/DealReviewClient";
import { pool } from "../../../../lib/pool";
import { closedOutcomeFromOpportunityRow } from "../../../../lib/opportunityOutcome";

export const runtime = "nodejs";

const PAPER_PROCESS_PREFILL = `Who (legal/procurement contact): 
What artifact (PO, MSA, redlines): 
When (date / next milestone): 
Current status (e.g., procurement cutting PO): `;

export default async function HubSpotReviewPage(ctx: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = ctx.searchParams ? await ctx.searchParams : {};
  const token = String(Array.isArray(rawParams?.token) ? rawParams.token[0] : rawParams?.token || "").trim();
  const category =
    String(Array.isArray(rawParams?.category) ? rawParams.category[0] : rawParams?.category || "").trim() || undefined;

  if (!token) redirect("/");

  let payload: Awaited<ReturnType<typeof verifyExtensionToken>>;
  try {
    payload = await verifyExtensionToken(token);
  } catch {
    redirect("/");
  }

  if (payload.purpose !== "review") redirect("/");

  // Block closed opportunities
  try {
    const { rows } = await pool.query(
      `SELECT sales_stage, forecast_stage FROM opportunities
       WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [payload.org_id, payload.opportunity_id]
    );
    const opp = rows?.[0] || null;
    const closed = closedOutcomeFromOpportunityRow({
      ...opp,
      stage: opp?.sales_stage,
    });
    if (closed) redirect("/");
  } catch {
    // Let client handle it
  }

  const prefill = category === "paper" ? PAPER_PROCESS_PREFILL : undefined;

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <DealReviewClient
        opportunityId={payload.public_id}
        initialCategory={category}
        initialPrefill={prefill}
        readOnly={false}
      />
    </div>
  );
}

