import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";

export const runtime = "nodejs";

function Card({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm hover:border-[color:var(--sf-accent-secondary)]"
    >
      <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{desc}</div>
    </Link>
  );
}

export default async function MeddpiccTbAnalyticsHubPage() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-4xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">MEDDPICC+TB Reports</h1>
            <p className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
              Deal-level MEDDPICC heatmaps and action-oriented risk reporting. Colors follow the same score rules (1=red, 2=yellow, 3=green).
            </p>
          </div>
          <div>
            <Link
              href="/analytics"
              className="inline-flex h-[40px] shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
            >
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Card
            href="/analytics/meddpicc-tb/heatmap"
            title="MEDDPICC+TB Heatmap"
            desc="Sortable deal view with MEDDPICC + Timing/Budget scores."
          />
          <Card
            href="/analytics/meddpicc-tb/risk-next-steps"
            title="Risk Summary + Next Steps"
            desc="Sortable list of deals with risk summary and next steps."
          />
          <Card
            href="/analytics/meddpicc-tb/tips-populated"
            title="Tips Populated (by category)"
            desc="Shows which MEDDPICC categories have an agent tip populated."
          />
          <Card
            href="/analytics/meddpicc-tb/rep-rollup"
            title="Rep rollup by Forecast Stage"
            desc="Opportunity counts + avg MEDDPICC+TB scores, rolled up to manager."
          />
          <Card
            href="/analytics/meddpicc-tb/verdict"
            title="Verdict (CRM vs AI Forecast)"
            desc="Sales Forecast vs The Verdict + variance and quarter range."
          />
        </section>
      </main>
    </div>
  );
}

