import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { isAdmin } from "../../../lib/roleHelpers";

export const runtime = "nodejs";

function SetupCard({
  href,
  title,
  desc,
  icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex gap-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm hover:border-[color:var(--sf-accent-secondary)]"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-base"
        aria-hidden
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
        <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{desc}</div>
      </div>
    </Link>
  );
}

function DataSourceChip({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-medium text-[color:var(--sf-text-primary)] hover:border-[color:var(--sf-accent-secondary)] hover:bg-[color:var(--sf-surface)]"
    >
      {label}
    </Link>
  );
}

function SetupStep({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--sf-accent-primary)] text-xs font-bold text-[color:var(--sf-button-primary-text)]">
          {step}
        </span>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</h2>
      </div>
      <hr className="mt-3 border-[color:var(--sf-border)]" />
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function AdminDashboardV2Page() {
  const ctx = await requireAuth();
  if (ctx.kind !== "user" || !isAdmin(ctx.user)) redirect("/admin/users");

  return (
    <main className="grid gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Organization setup</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Configure your organization in order — foundation, data, pipeline, quotas, and channel.
        </p>
      </div>

      <SetupStep step={1} title="Organization foundation">
        <div className="grid gap-4 md:grid-cols-3">
          <SetupCard
            href="/admin/org-profile"
            title="Org Profile"
            desc="Manage organization profile fields."
            icon="🏢"
          />
          <SetupCard
            href="/admin/users"
            title="Users"
            desc="Create, edit, deactivate, and manage roles and reporting lines."
            icon="👥"
          />
          <SetupCard
            href="/admin/hierarchy"
            title="Sales Organization"
            desc="Set up, edit and review Sales Org assignments."
            icon="🧭"
          />
        </div>
      </SetupStep>

      <SetupStep step={2} title="Data source">
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="flex gap-4">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-base"
              aria-hidden
            >
              📥
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">Connect your CRM or upload data</div>
              <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                Choose how opportunities enter SalesForecast.io — spreadsheet upload or a live CRM integration.
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <DataSourceChip href="/admin/excel-opportunities" label="Excel upload" />
            <DataSourceChip href="/admin/integrations/salesforce" label="Salesforce" />
            <DataSourceChip href="/admin/integrations/hubspot" label="HubSpot" />
          </div>
        </div>
      </SetupStep>

      <SetupStep step={3} title="Pipeline & stage configuration">
        <div className="grid gap-4 md:grid-cols-2">
          <SetupCard
            href="/admin/stage-mapping"
            title="Stage mapping"
            desc="Map CRM forecast category and sales stage values to forecast buckets."
            icon="🗺️"
          />
          <SetupCard
            href="/admin/analytics/forecast-probabilities"
            title="Forecast probabilities"
            desc="Set close probabilities by forecast category (Commit/Best/Pipeline)."
            icon="📊"
          />
        </div>
      </SetupStep>

      <SetupStep step={4} title="Quota & targets">
        <div className="grid gap-4 md:grid-cols-2">
          <SetupCard
            href="/admin/analytics/quota-periods"
            title="Quota periods"
            desc="Manage fiscal calendar (quota periods)."
            icon="📅"
          />
          <SetupCard
            href="/admin/analytics/quotas"
            title="Quotas"
            desc="Assign quotas to reps and manage quota sets."
            icon="🎯"
          />
        </div>
      </SetupStep>

      <SetupStep step={5} title="Channel & partner setup">
        <div className="grid gap-4 md:grid-cols-2">
          <SetupCard
            href="/admin/channel-alignment"
            title="Channel alignment"
            desc="Align channel team members to sales territories."
            icon="🔗"
          />
          <SetupCard
            href="/admin/partner-assignments"
            title="Partner assignments"
            desc="Assign partners to channel reps for deal attribution."
            icon="🤝"
          />
        </div>
      </SetupStep>
    </main>
  );
}
