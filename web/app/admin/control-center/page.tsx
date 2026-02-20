import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, type AuthUser } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";

export const runtime = "nodejs";

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct01(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtDays(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  return `${v.toLocaleString()} day${v === 1 ? "" : "s"}`;
}

async function pickOrgAnalyticsUser(orgId: number): Promise<AuthUser | null> {
  const r = await pool
    .query<AuthUser>(
      `
      SELECT
        id,
        public_id::text AS public_id,
        org_id,
        email,
        role,
        hierarchy_level,
        display_name,
        account_owner_name,
        manager_user_id,
        admin_has_full_analytics_access,
        see_all_visibility,
        active
      FROM users
      WHERE org_id = $1::bigint
        AND active = true
        AND role IN ('EXEC_MANAGER', 'MANAGER', 'ADMIN')
      ORDER BY
        (role = 'EXEC_MANAGER') DESC,
        (role = 'MANAGER') DESC,
        (see_all_visibility) DESC,
        id ASC
      LIMIT 1
      `,
      [orgId]
    )
    .catch(() => ({ rows: [] as AuthUser[] } as any));
  return (r.rows?.[0] as any) || null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</h2>
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  );
}

function Item({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-lg border border-[color:var(--sf-border)] p-4 hover:border-[color:var(--sf-accent-secondary)]">
      <div className="font-medium text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{desc}</div>
    </Link>
  );
}

export default async function OwnerControlCenterPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const activeOrg = ctx.orgId ? await getOrganization({ id: ctx.orgId }).catch(() => null) : null;
  const analyticsUser = activeOrg?.id ? await pickOrgAnalyticsUser(activeOrg.id) : null;
  const execSummary =
    activeOrg?.id && analyticsUser
      ? await getExecutiveForecastDashboardSummary({ orgId: activeOrg.id, user: analyticsUser, searchParams }).catch(() => null)
      : null;

  const dvp = execSummary?.quarterKpis?.directVsPartner || null;
  const story = dvp
    ? [
        {
          k: "partners",
          label: "Partners = larger but slower",
          detail: `AOV ${dvp.partnerAov == null ? "—" : fmtMoney(dvp.partnerAov)} vs ${dvp.directAov == null ? "—" : fmtMoney(dvp.directAov)} · Avg cycle ${
            dvp.partnerAvgAgeDays == null ? "—" : fmtDays(dvp.partnerAvgAgeDays)
          } vs ${dvp.directAvgAgeDays == null ? "—" : fmtDays(dvp.directAvgAgeDays)}`,
        },
        {
          k: "direct",
          label: "Direct = faster volume engine",
          detail: `Closed-won deals ${dvp.directClosedDeals == null ? "—" : String(dvp.directClosedDeals)} vs ${
            dvp.partnerClosedDeals == null ? "—" : String(dvp.partnerClosedDeals)
          } · Faster by ${
            dvp.directAvgAgeDays != null && dvp.partnerAvgAgeDays != null ? fmtDays(Math.max(0, dvp.partnerAvgAgeDays - dvp.directAvgAgeDays)) : "—"
          }`,
        },
        {
          k: "channel",
          label: "Channel = meaningful but not dominant",
          detail: dvp.partnerContributionPct == null ? "—" : `Partner contribution ${fmtPct01(dvp.partnerContributionPct)}`,
        },
      ]
    : [];

  return (
    <main className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">SaaS Owner Control Center</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Site map + QA panel (master only).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/organizations"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Organizations
          </Link>
          <Link href="/admin" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
            Admin home
          </Link>
        </div>
      </header>

      {!activeOrg ? (
        <div className="rounded-xl border border-[#F1C40F] bg-[color:var(--sf-surface-alt)] px-5 py-4 text-sm text-[color:var(--sf-text-primary)]">
          <div className="font-semibold">No active organization selected</div>
          <div className="mt-1 text-[color:var(--sf-text-secondary)]">
            Org-scoped pages (Users/Reps/Ingestion/Mapping Sets/Org Profile) require an active org. Set it on{" "}
            <Link href="/admin/organizations" className="font-medium underline">
              Organizations
            </Link>
            .
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-5 py-4 text-sm text-[color:var(--sf-text-primary)]">
          <div className="font-semibold">Active organization</div>
          <div className="mt-1">
            <span className="font-medium">{activeOrg.name}</span>{" "}
            <span className="font-mono text-xs text-[color:var(--sf-text-disabled)]">{activeOrg.public_id}</span>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">CRO decision engine (master-only)</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Moved from the Executive Dashboard. Uses the active org context to compute the narrative from real numbers.
            </p>
          </div>
          {activeOrg?.id ? (
            <Link
              href="/dashboard/executive"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Open Executive Dashboard
            </Link>
          ) : null}
        </div>

        {!activeOrg?.id ? (
          <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">Select an active organization to view the CRO recommendation.</div>
        ) : !analyticsUser ? (
          <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">No eligible org user found to compute analytics (needs EXEC_MANAGER/MANAGER/ADMIN).</div>
        ) : !dvp ? (
          <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">Quarter KPIs unavailable for the active org/period.</div>
        ) : (
          <>
            <div className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Your data is telling a very clear story:</div>
              <ul className="mt-3 grid gap-2 text-sm text-[color:var(--sf-text-primary)]">
                {story.map((s) => (
                  <li key={s.k} className="grid gap-0.5">
                    <div className="flex items-start gap-2">
                      <span className="text-[color:var(--sf-accent-secondary)]">•</span>
                      <span className="font-semibold">{s.label}</span>
                    </div>
                    {s.detail ? <div className="pl-5 text-xs text-[color:var(--sf-text-secondary)]">{s.detail}</div> : null}
                  </li>
                ))}
              </ul>

              <div className="mt-3 text-sm font-semibold text-[color:var(--sf-text-primary)]">That is exactly the kind of narrative CROs fund.</div>
              <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                If you want the real mic-drop next, here are three executive indices that turn this into a coverage and investment engine.
              </div>
            </div>

            <details className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">Show the CRO-grade scoring models (WIC / PQS / CEI)</summary>

              <div className="mt-4 grid gap-4 text-sm text-[color:var(--sf-text-primary)]">
                <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
                  <div className="font-semibold">🔥 1) Where to Invest Coverage Score (WIC)</div>
                  <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
                    Answers: “Where should we put more reps or partner focus to grow fastest with lowest risk?”
                  </div>
                  <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">Normalize inputs (0–1):</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-[12px] text-[color:var(--sf-text-primary)]">
{`GC = normalize(open_pipeline OR pipeline_value_next_2_qtrs)
WQ = win_rate * avg_health_score
VE = 1 - normalize(avg_sales_cycle_days)
DE = normalize(AOV)

WIC = (GC*0.35) + (WQ*0.30) + (VE*0.20) + (DE*0.15)`}
                  </pre>
                  <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">Output bands:</div>
                  <div className="mt-2 overflow-x-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                    <table className="min-w-[640px] w-full table-auto border-collapse text-[12px]">
                      <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                        <tr>
                          <th className="px-3 py-2 text-left">Score</th>
                          <th className="px-3 py-2 text-left">Label</th>
                          <th className="px-3 py-2 text-left">Executive meaning</th>
                        </tr>
                      </thead>
                      <tbody className="text-[color:var(--sf-text-primary)]">
                        {[
                          { a: "80–100", b: "INVEST AGGRESSIVELY", c: "Add capacity" },
                          { a: "60–79", b: "SCALE SELECTIVELY", c: "Monitor & grow" },
                          { a: "40–59", b: "MAINTAIN", c: "No change" },
                          { a: "<40", b: "DEPRIORITIZE", c: "Reduce focus" },
                        ].map((r) => (
                          <tr key={r.a} className="border-t border-[color:var(--sf-border)]">
                            <td className="px-3 py-2 font-mono">{r.a}</td>
                            <td className="px-3 py-2 font-semibold">{r.b}</td>
                            <td className="px-3 py-2">{r.c}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
                  <div className="font-semibold">🔥 2) Partner Quality Score (PQS)</div>
                  <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
                    Separates strategic partners vs opportunistic vs dead weight — defensible, simple, and executive-friendly.
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-[12px] text-[color:var(--sf-text-primary)]">
{`WRF = win_rate
DSF = normalize(partner_AOV)
VP  = normalize(avg_sales_cycle_days)        // penalty
CF  = min(1, log(deal_count+1) / log(10))    // consistency

PQS = (WRF*0.40) + (DSF*0.25) + (CF*0.20) - (VP*0.15)
Clamp to 0–100`}
                  </pre>
                  <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">Executive tiers:</div>
                  <div className="mt-2 grid gap-1 text-[12px] text-[color:var(--sf-text-primary)]">
                    <div>
                      <span className="font-mono">80+</span> — <span className="font-semibold">Strategic Partner</span>
                    </div>
                    <div>
                      <span className="font-mono">60–79</span> — <span className="font-semibold">High Potential</span>
                    </div>
                    <div>
                      <span className="font-mono">40–59</span> — <span className="font-semibold">Opportunistic</span>
                    </div>
                    <div>
                      <span className="font-mono">&lt;40</span> — <span className="font-semibold">At Risk</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
                  <div className="font-semibold">🔥 3) Channel Efficiency Index (CEI)</div>
                  <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">Boardroom metric: “Is channel actually more efficient than direct?”</div>
                  <pre className="mt-3 whitespace-pre-wrap rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-[12px] text-[color:var(--sf-text-primary)]">
{`RV = total_closed_won / avg_sales_cycle_days
QM = win_rate * avg_health_score   // if no health, use win_rate
CEI = RV * QM

Normalize to an index: Direct = 100 baseline`}
                  </pre>
                  <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">Interpretation (vs Direct):</div>
                  <div className="mt-2 grid gap-1 text-[12px] text-[color:var(--sf-text-primary)]">
                    <div>
                      <span className="font-mono">&gt;120</span> — <span className="font-semibold">Channel highly efficient</span>
                    </div>
                    <div>
                      <span className="font-mono">90–120</span> — <span className="font-semibold">Comparable</span>
                    </div>
                    <div>
                      <span className="font-mono">70–89</span> — <span className="font-semibold">Less efficient</span>
                    </div>
                    <div>
                      <span className="font-mono">&lt;70</span> — <span className="font-semibold">Drag on business</span>
                    </div>
                  </div>
                </div>
              </div>
            </details>
          </>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="1. SaaS Owner (master) tasks">
          <Item href="/admin/organizations?modal=new" title="Create organization" desc="Create a new customer organization." />
          <Item href="/admin/organizations" title="Organizations" desc="List orgs + set active org context." />
          <Item href="/admin/all-users" title="All users (cross-org)" desc="Support/QA view across all orgs." />
          <Item href="/admin/email-templates" title="Email templates" desc="Manage welcome/invite/reset templates." />
          <Item href="/api/db-check" title="DB check" desc="Health/status endpoint (admin/master only)." />
        </Section>

        <Section title="2. Active org (org-scoped) tasks">
          <Item href="/admin/users" title="Users" desc="Create/edit users, roles, reporting lines (active org)." />
          <Item href="/admin/org-profile" title="Org profile" desc="Org profile editor (active org)." />
          <Item href="/admin/hierarchy" title="Sales Organization" desc="set-up, edit and review Sales Org Assignmnets." />
        </Section>

        <Section title="3. Ingestion + mappings (active org)">
          <Item href="/admin/mapping-sets" title="Mapping sets" desc="Create mapping sets + field mappings." />
          <Item href="/admin/ingestion" title="Ingestion" desc="View staging rows, retry failures, trigger processing." />
          <Item href="/admin/excel-opportunities" title="Excel opportunities upload" desc="Upload Excel, map fields, ingest opportunities." />
        </Section>

        <Section title="4. System utilities (placeholders)">
          <Item href="/admin/system/logs" title="View System Logs (placeholder)" desc="Placeholder page for future log viewing." />
          <Item href="/admin/system/ingestion-status" title="View Ingestion Status (placeholder)" desc="Placeholder page for ingestion monitoring." />
          <Item href="/admin/system/test-emails" title="Trigger Test Emails (stub)" desc="Stub to exercise email templating." />
          <Item href="/admin/system/test-notifications" title="Trigger Test Notifications (stub)" desc="Stub page for future notifications." />
        </Section>

        <Section title="5. App pages (for testing)">
          <Item href="/dashboard" title="Dashboard" desc="Role-based dashboard routing." />
          <Item href="/admin" title="Admin home" desc="Admin landing page cards." />
          <Item href="/admin/users" title="Users" desc="Users + reporting lines UI." />
          <Item href="/admin/mapping-sets" title="Mapping sets" desc="Mapping sets + field mappings UI." />
          <Item href="/admin/ingestion" title="Ingestion" desc="Staging rows UI." />
          <Item href="/admin/analytics" title="Admin Analytics" desc="Admin analytics landing page." />
          <Item href="/admin/analytics/quota-periods" title="Admin quota periods" desc="Manage quota_periods." />
          <Item href="/admin/analytics/quotas" title="Admin quotas" desc="Manage quotas." />
          <Item href="/admin/analytics/quota-rollups" title="Admin quota rollups" desc="Quota rollups by level." />
          <Item href="/admin/analytics/attainment" title="Admin attainment" desc="Attainment dashboards." />
          <Item href="/admin/analytics/comparisons" title="Admin comparisons" desc="Stage comparisons + attainment." />
          <Item href="/analytics/quotas/admin" title="/analytics/quotas/admin" desc="Admin-only quota management (org user)." />
          <Item href="/analytics/quotas/manager" title="/analytics/quotas/manager" desc="Manager-only team quotas (org user)." />
          <Item href="/analytics/quotas/executive" title="/analytics/quotas/executive" desc="Executive-only company quotas (org user)." />
          <Item href="/login" title="Login Page" desc="Login flow." />
          <Item href="/forgot-password" title="Forgot Password Page" desc="Password reset request flow." />
          <Item href="/reset-password" title="Reset Password Page" desc="Password reset set-new-password flow." />
        </Section>
      </div>
    </main>
  );
}

