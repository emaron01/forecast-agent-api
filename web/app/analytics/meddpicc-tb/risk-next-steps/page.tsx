import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import { UserTopNav } from "../../../_components/UserTopNav";
import { MeddpiccRiskNextStepsClient } from "./uiClient";

export const runtime = "nodejs";

export default async function MeddpiccRiskNextStepsPage() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const periods = await pool
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
    .catch(() => []);

  const todayIso = new Date().toISOString().slice(0, 10);
  const containingToday = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultQuotaPeriodId = String(containingToday?.id || periods?.[0]?.id || "").trim();

  const quotaPeriods = periods.map((p) => {
    const q = Number.parseInt(String(p.fiscal_quarter || "").trim(), 10);
    const y = String(p.fiscal_year || "").trim();
    const ord =
      q === 1
        ? "1st Quarter"
        : q === 2
          ? "2nd Quarter"
          : q === 3
            ? "3rd Quarter"
            : q === 4
              ? "4th Quarter"
              : `Q${q}`;
    const label =
      Number.isFinite(q) && q > 0 && y
        ? `${ord} ${y}`
        : String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`;
    return { id: String(p.id), label };
  });

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <MeddpiccRiskNextStepsClient quotaPeriods={quotaPeriods} defaultQuotaPeriodId={defaultQuotaPeriodId} />
      </main>
    </div>
  );
}

