import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import { UserTopNav } from "../../../_components/UserTopNav";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { GapDrivingDealsClient } from "./ui/GapDrivingDealsClient";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

type PeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

type RepOption = { public_id: string; name: string };

export default async function GapDrivingDealsReportPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const periods: PeriodLite[] = await pool
    .query<PeriodLite>(
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

  const initialQuotaPeriodId = String(sp(searchParams?.quota_period_id) || defaultQuotaPeriodId).trim();

  const roleRaw = String(ctx.user.role || "").trim();
  const scopedRole =
    roleRaw === "ADMIN" || roleRaw === "EXEC_MANAGER" || roleRaw === "MANAGER" || roleRaw === "REP"
      ? (roleRaw as "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP")
      : ("REP" as const);

  const scope = await getScopedRepDirectory({
    orgId: ctx.user.org_id,
    userId: ctx.user.id,
    role: scopedRole,
  }).catch(() => null);

  const allowedRepIds = scope?.allowedRepIds ?? [];
  const useScoped = scope?.allowedRepIds !== null;

  const reps: RepOption[] = await pool
    .query<RepOption>(
      `
      SELECT
        public_id::text AS public_id,
        COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), NULLIF(btrim(crm_owner_name), ''), '(Unnamed)') AS name
      FROM reps
      WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint
        AND (active IS TRUE OR active IS NULL)
        AND role = 'REP'
        AND (NOT $2::boolean OR id = ANY($3::bigint[]))
      ORDER BY name ASC, id ASC
      `,
      [ctx.user.org_id, useScoped, Array.isArray(allowedRepIds) ? allowedRepIds : []]
    )
    .then((r) => (r.rows || []).map((x: any) => ({ public_id: String(x.public_id), name: String(x.name || "").trim() || "(Unnamed)" })))
    .catch(() => []);

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Deals Driving the Gap</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Deal-level breakdown of the weighted outlook delta between CRM (rep-weighted) and AI/Verdict (health-modified).
            </p>
            <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics/meddpicc-tb">
                MEDDPICC+TB Reports
              </Link>
              {" · "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics/meddpicc-tb/verdict">
                Verdict (CRM vs AI Forecast)
              </Link>
            </div>
          </div>
        </div>

        <GapDrivingDealsClient basePath="/analytics/meddpicc-tb/gap-driving-deals" periods={periods} reps={reps} initialQuotaPeriodId={initialQuotaPeriodId} />
      </main>
    </div>
  );
}

