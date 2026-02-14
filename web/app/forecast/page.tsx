import { redirect } from "next/navigation";
import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { pool } from "../../lib/pool";
import { UserTopNav } from "../_components/UserTopNav";
import { SimpleForecastDashboardClient } from "./simple/simpleClient";
import { QuarterSalesForecastSummary } from "./_components/QuarterSalesForecastSummary";

export const runtime = "nodejs";

export default async function ForecastPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const repFilterLocked = ctx.user.role === "REP";
  const defaultRepName = repFilterLocked ? String(ctx.user.account_owner_name || "") : "";

  const quotaPeriods =
    repFilterLocked
      ? await pool
          .query<{
            id: string;
            fiscal_year: string;
            fiscal_quarter: string;
            period_name: string;
            period_start: string;
            period_end: string;
          }>(
            `
            SELECT
              id::text AS id,
              fiscal_year,
              fiscal_quarter::text AS fiscal_quarter,
              period_name,
              period_start::text AS period_start,
              period_end::text AS period_end
            FROM quota_periods
            WHERE org_id = $1::bigint
            ORDER BY period_start DESC, id DESC
            `,
            [ctx.user.org_id]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];

  const currentQuotaPeriodId =
    repFilterLocked && quotaPeriods.length
      ? await pool
          .query<{ id: string }>(
            `
            SELECT id::text AS id
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND period_start <= CURRENT_DATE
               AND period_end >= CURRENT_DATE
             ORDER BY period_start DESC, id DESC
             LIMIT 1
            `,
            [ctx.user.org_id]
          )
          .then((r) => String(r.rows?.[0]?.id || "").trim() || String(quotaPeriods[0]?.id || ""))
          .catch(() => String(quotaPeriods[0]?.id || ""))
      : "";

  const quotaPeriodOptions = quotaPeriods.map((p) => {
    const q = Number.parseInt(String(p.fiscal_quarter || "").trim(), 10);
    const y = String(p.fiscal_year || "").trim();
    const ord = q === 1 ? "1st Quarter" : q === 2 ? "2nd Quarter" : q === 3 ? "3rd Quarter" : q === 4 ? "4th Quarter" : `Q${q}`;
    const label = Number.isFinite(q) && q > 0 && y ? `${ord} ${y}` : String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`;
    return { id: String(p.id), label };
  });

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <QuarterSalesForecastSummary orgId={ctx.user.org_id} user={ctx.user} currentPath="/forecast" searchParams={searchParams} />
        <SimpleForecastDashboardClient
          defaultRepName={defaultRepName}
          repFilterLocked={repFilterLocked}
          quotaPeriods={quotaPeriodOptions}
          defaultQuotaPeriodId={currentQuotaPeriodId}
        />
      </main>
    </div>
  );
}

