import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { UserTopNav } from "../../../_components/UserTopNav";
import { DEFAULT_FORECAST_STAGE_PROBABILITIES, getForecastStageProbabilities, upsertForecastStageProbabilities } from "../../../../lib/forecastStageProbabilities";

function pct(v: number) {
  return Math.round(v * 1000) / 10;
}

function parsePct01(raw: FormDataEntryValue | null) {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n / 100;
}

async function saveAction(formData: FormData) {
  "use server";
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "EXEC_MANAGER" && ctx.user.role !== "MANAGER" && ctx.user.role !== "ADMIN") redirect("/dashboard");
  if (ctx.user.role === "ADMIN" && !ctx.user.admin_has_full_analytics_access) redirect("/admin");

  const commit = parsePct01(formData.get("commit_pct"));
  const best_case = parsePct01(formData.get("best_case_pct"));
  const pipeline = parsePct01(formData.get("pipeline_pct"));
  if (commit == null || best_case == null || pipeline == null) redirect(`/analytics/executive/forecast-probabilities?error=${encodeURIComponent("Invalid percentage")}`);

  await upsertForecastStageProbabilities({ orgId: ctx.user.org_id, values: { commit, best_case, pipeline } });
  revalidatePath("/analytics/executive/forecast-probabilities");
  redirect("/analytics/executive/forecast-probabilities?saved=1");
}

export default async function ExecutiveForecastProbabilitiesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "EXEC_MANAGER" && ctx.user.role !== "MANAGER" && ctx.user.role !== "ADMIN") redirect("/dashboard");
  if (ctx.user.role === "ADMIN" && !ctx.user.admin_has_full_analytics_access) redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const saved = String((searchParams as any)?.saved || "") === "1";
  const error = String((searchParams as any)?.error || "").trim();

  const cur = await getForecastStageProbabilities({ orgId: ctx.user.org_id }).catch(() => DEFAULT_FORECAST_STAGE_PROBABILITIES);

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Forecast stage probabilities</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Set default close probability assumptions by forecast category.</p>
            <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics/executive">
                Executive analytics
              </Link>
              {" · "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics">
                Analytics home
              </Link>
            </div>
          </div>
        </div>

        {saved ? (
          <div className="mt-4 rounded-md border border-[#2ECC71]/40 bg-[#2ECC71]/10 p-3 text-sm text-[color:var(--sf-text-primary)]">
            Saved.
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-md border border-[#E74C3C]/40 bg-[#E74C3C]/10 p-3 text-sm text-[#E74C3C]">
            {error}
          </div>
        ) : null}

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Industry guidance (if you don’t know your close rates)</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            These are common benchmarks. Set your own percentages based on historical win rates for each category.
          </p>

          <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">Forecast Category</th>
                  <th className="px-4 py-3">Industry Close Rate</th>
                  <th className="px-4 py-3">Definition</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">Commit</td>
                  <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-primary)]">70–90%</td>
                  <td className="px-4 py-3 text-[color:var(--sf-text-primary)]">Rep believes it will close this quarter; strong evidence.</td>
                </tr>
                <tr className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">Best Case / Upside</td>
                  <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-primary)]">25–40%</td>
                  <td className="px-4 py-3 text-[color:var(--sf-text-primary)]">Could close if ideal conditions align.</td>
                </tr>
                <tr className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">Pipeline</td>
                  <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-primary)]">5–15%</td>
                  <td className="px-4 py-3 text-[color:var(--sf-text-primary)]">Early stage; unlikely to close this quarter.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Your organization’s probabilities</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">These values are stored per org and used as default assumptions.</p>

          <form action={saveAction} className="mt-4 grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Commit (%)</label>
                <input
                  name="commit_pct"
                  type="number"
                  step="0.1"
                  defaultValue={pct(cur.commit)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Best Case / Upside (%)</label>
                <input
                  name="best_case_pct"
                  type="number"
                  step="0.1"
                  defaultValue={pct(cur.best_case)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Pipeline (%)</label>
                <input
                  name="pipeline_pct"
                  type="number"
                  step="0.1"
                  defaultValue={pct(cur.pipeline)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Save
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

