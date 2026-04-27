import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyExtensionToken } from "../../../../lib/hubspotExtensionJwt";
import { DealReviewClient } from "../../../opportunities/[id]/deal-review/DealReviewClient";
import { pool } from "../../../../lib/pool";
import { closedOutcomeFromOpportunityRow } from "../../../../lib/opportunityOutcome";
import { randomToken, sha256Hex } from "../../../../lib/auth";

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

  const repRes = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM reps WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [payload.rep_id, payload.org_id]
  );
  const userId = repRes.rows[0]?.user_id;
  if (!userId) redirect("/");

  const sessionToken = randomToken();
  const tokenHash = sha256Hex(sessionToken);
  await pool.query(
    `INSERT INTO user_sessions (user_id, session_token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '14 days')`,
    [userId, tokenHash]
  );
  cookies().set("fa_session", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });

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

