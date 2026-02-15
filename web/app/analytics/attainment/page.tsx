import Link from "next/link";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/pool";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { listCroAttainment, listManagerAttainment, listRepAttainment, listVpAttainment } from "../../../lib/quotaRollups";
import { dateOnly } from "../../../lib/dateOnly";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

type QuotaPeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string;
};

async function listQuotaPeriodsForOrg(orgId: number): Promise<QuotaPeriodLite[]> {
  const { rows } = await pool.query<QuotaPeriodLite>(
    `
    SELECT
      id::text AS id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter
    FROM quota_periods
    WHERE org_id = $1::bigint
    ORDER BY period_start DESC, id DESC
    `,
    [orgId]
  );
  return rows as QuotaPeriodLite[];
}

export const runtime = "nodejs";

export default async function AnalyticsAttainmentPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin/analytics/attainment");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const periods = await listQuotaPeriodsForOrg(ctx.user.org_id).catch(() => []);
  const quotaPeriodId = String(sp(searchParams.quota_period_id) || "").trim();
  const selected = quotaPeriodId ? periods.find((p) => String(p.id) === quotaPeriodId) || null : null;

  const reps = selected ? await listRepAttainment({ orgId: ctx.user.org_id, quotaPeriodId }).catch(() => []) : [];
  const managers = selected ? await listManagerAttainment({ orgId: ctx.user.org_id, quotaPeriodId }).catch(() => []) : [];
  const vps = selected ? await listVpAttainment({ orgId: ctx.user.org_id, quotaPeriodId }).catch(() => []) : [];
  const cros = selected ? await listCroAttainment({ orgId: ctx.user.org_id, quotaPeriodId }).catch(() => []) : [];

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Attainment dashboards</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Rep → Manager → VP → CRO roll-ups.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/analytics"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/attainment" className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_period_id</label>
              <select
                name="quota_period_id"
                defaultValue={quotaPeriodId}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                <option value="">(select)</option>
                {periods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.period_name} ({p.fiscal_year} {p.fiscal_quarter}) ({dateOnly(p.period_start)} → {dateOnly(p.period_end)}) [id {p.id}]
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-end gap-2">
              <Link
                href="/analytics/attainment"
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Reset
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Apply
              </button>
            </div>
          </form>
        </section>

        {!selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a `quota_period_id` to view attainment dashboards.</p>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Rep attainment</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.rep_attainment(org_id, quota_period_id)`.</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">rep_id</th>
                  <th className="px-4 py-3">rep_name</th>
                  <th className="px-4 py-3 text-right">quota_amount</th>
                  <th className="px-4 py-3 text-right">carry_forward</th>
                  <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                  <th className="px-4 py-3 text-right">actual_amount</th>
                  <th className="px-4 py-3 text-right">attainment</th>
                </tr>
              </thead>
              <tbody>
                {reps.length ? (
                  reps.map((r) => (
                    <tr key={r.quota_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">{r.rep_id}</td>
                      <td className="px-4 py-3">{r.rep_name || ""}</td>
                      <td className="px-4 py-3 text-right">{r.quota_amount}</td>
                      <td className="px-4 py-3 text-right">{r.carry_forward}</td>
                      <td className="px-4 py-3 text-right">{r.adjusted_quota_amount}</td>
                      <td className="px-4 py-3 text-right">{r.actual_amount}</td>
                      <td className="px-4 py-3 text-right">{r.attainment == null ? "" : r.attainment}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No rep quotas found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Manager attainment</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.manager_attainment(org_id, quota_period_id)`.</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">manager_id</th>
                  <th className="px-4 py-3">manager_name</th>
                  <th className="px-4 py-3 text-right">quota_amount</th>
                  <th className="px-4 py-3 text-right">carry_forward</th>
                  <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                  <th className="px-4 py-3 text-right">actual_amount</th>
                  <th className="px-4 py-3 text-right">attainment</th>
                </tr>
              </thead>
              <tbody>
                {managers.length ? (
                  managers.map((m) => (
                    <tr key={m.quota_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">{m.manager_id}</td>
                      <td className="px-4 py-3">{m.manager_name || ""}</td>
                      <td className="px-4 py-3 text-right">{m.quota_amount}</td>
                      <td className="px-4 py-3 text-right">{m.carry_forward}</td>
                      <td className="px-4 py-3 text-right">{m.adjusted_quota_amount}</td>
                      <td className="px-4 py-3 text-right">{m.actual_amount}</td>
                      <td className="px-4 py-3 text-right">{m.attainment == null ? "" : m.attainment}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No manager quotas found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">VP attainment</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.vp_attainment(org_id, quota_period_id)`.</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">vp_id</th>
                  <th className="px-4 py-3">vp_name</th>
                  <th className="px-4 py-3 text-right">quota_amount</th>
                  <th className="px-4 py-3 text-right">carry_forward</th>
                  <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                  <th className="px-4 py-3 text-right">actual_amount</th>
                  <th className="px-4 py-3 text-right">attainment</th>
                </tr>
              </thead>
              <tbody>
                {vps.length ? (
                  vps.map((v) => (
                    <tr key={v.quota_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">{v.vp_id}</td>
                      <td className="px-4 py-3">{v.vp_name || ""}</td>
                      <td className="px-4 py-3 text-right">{v.quota_amount}</td>
                      <td className="px-4 py-3 text-right">{v.carry_forward}</td>
                      <td className="px-4 py-3 text-right">{v.adjusted_quota_amount}</td>
                      <td className="px-4 py-3 text-right">{v.actual_amount}</td>
                      <td className="px-4 py-3 text-right">{v.attainment == null ? "" : v.attainment}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No VP quotas found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">CRO/company attainment</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.cro_attainment(org_id, quota_period_id)`.</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3 text-right">quota_amount</th>
                  <th className="px-4 py-3 text-right">carry_forward</th>
                  <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                  <th className="px-4 py-3 text-right">actual_amount</th>
                  <th className="px-4 py-3 text-right">attainment</th>
                </tr>
              </thead>
              <tbody>
                {cros.length ? (
                  cros.map((c) => (
                    <tr key={c.quota_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 text-right">{c.quota_amount}</td>
                      <td className="px-4 py-3 text-right">{c.carry_forward}</td>
                      <td className="px-4 py-3 text-right">{c.adjusted_quota_amount}</td>
                      <td className="px-4 py-3 text-right">{c.actual_amount}</td>
                      <td className="px-4 py-3 text-right">{c.attainment == null ? "" : c.attainment}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No CRO/company quota found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}
      </main>
    </div>
  );
}

