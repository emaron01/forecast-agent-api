import type { AuthUser } from "../../../lib/auth";

export function RepDashboardHero(props: { user: AuthUser; orgName: string }) {
  const { user, orgName } = props;
  const displayName = user.display_name?.trim() || user.email || "there";

  // Role-based hero: only REP lands on this dashboard page; render rep-focused hero.
  if (user.role === "REP") {
    return (
      <section
        className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm"
        aria-label="Sales Rep Dashboard hero"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
              Sales Rep Dashboard
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-[color:var(--sf-text-primary)] sm:text-3xl">
              Welcome back, {displayName}
            </h1>
            <p className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
              Your pipeline and forecast for {orgName}. View and manage your opportunities below.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Fallback if another role ever hits this page
  return (
    <section
      className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm"
      aria-label="Dashboard hero"
    >
      <h1 className="text-2xl font-bold tracking-tight text-[color:var(--sf-text-primary)]">Dashboard</h1>
      <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Signed in as {displayName}</p>
    </section>
  );
}
