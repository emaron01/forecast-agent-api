import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../lib/auth";
import { listHierarchyLevels, listUsers } from "../../../lib/db";
import { updateSalesOrgChartAction } from "../actions/orgChart";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function HierarchyPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const saved = sp(searchParams.saved) || "";
  const error = sp(searchParams.error) || "";

  const hierarchyLevels = await listHierarchyLevels().catch(() => []);
  const hierarchyLabelByLevel = new Map<number, string>(
    hierarchyLevels.map((h): [number, string] => [Number(h.level), String(h.label || "").trim()])
  );
  const labelForLevel = (level: number, fallback: string) => hierarchyLabelByLevel.get(level) || fallback;

  const users = await listUsers({ orgId, includeInactive: true }).catch(() => []);
  const executives = users.filter((u) => u.hierarchy_level === 1 && u.active);
  const managers = users.filter((u) => u.hierarchy_level === 2 && u.active);
  const reps = users.filter((u) => u.hierarchy_level === 3 && u.active);

  const managersByExecId = new Map<number, typeof managers>();
  for (const m of managers) {
    const execId = m.manager_user_id || 0;
    if (!managersByExecId.has(execId)) managersByExecId.set(execId, [] as any);
    (managersByExecId.get(execId) as any).push(m);
  }

  const repsByManagerId = new Map<number, typeof reps>();
  for (const r of reps) {
    const mgrId = r.manager_user_id || 0;
    if (!repsByManagerId.has(mgrId)) repsByManagerId.set(mgrId, [] as any);
    (repsByManagerId.get(mgrId) as any).push(r);
  }

  const unassignedManagers = managersByExecId.get(0) || [];
  const unassignedReps = repsByManagerId.get(0) || [];

  return (
    <main className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sales Org Chart</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Assign managers for Executive Managers, Managers, and Reps. This drives who can view whose data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Users
          </Link>
          <Link
            href="/admin/org-profile"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Org profile
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        {saved ? (
          <div className="mb-4 rounded-md border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
            Saved.
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
            {error === "cycle_detected"
              ? "Invalid org chart: a user cannot manage themselves (directly or indirectly)."
              : error === "rep_manager_must_be_manager"
                ? "Invalid assignment: Reps must report to a Manager."
                : error === "manager_manager_must_be_exec"
                  ? "Invalid assignment: Managers must report to an Executive Manager (or be unassigned)."
                  : "Could not save. Please review your selections and try again."}
          </div>
        ) : null}

        <form action={updateSalesOrgChartAction} className="grid gap-5">
          <div className="flex items-center justify-end gap-2">
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Save org chart
            </button>
          </div>

          {executives.length ? (
            <div className="grid gap-4">
              {executives.map((exec) => {
                const myManagers = managersByExecId.get(exec.id) || [];
                return (
                  <section key={exec.id} className="rounded-xl border border-[color:var(--sf-border)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                          {labelForLevel(1, "Executive Manager")}: {exec.display_name}
                        </div>
                        <div className="text-xs text-[color:var(--sf-text-disabled)]">{exec.email}</div>
                      </div>
                      <div className="text-xs text-[color:var(--sf-text-disabled)]">{exec.public_id}</div>
                    </div>

                    <div className="mt-4 grid gap-3">
                      {myManagers.length ? (
                        myManagers.map((m) => {
                          const myReps = repsByManagerId.get(m.id) || [];
                          return (
                            <div key={m.id} className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                                  {labelForLevel(2, "Manager")}: {m.display_name}
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Managed by</label>
                                  <select
                                    name={`mgr_${m.public_id}`}
                                    defaultValue={exec.public_id}
                                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm text-[color:var(--sf-text-primary)]"
                                  >
                                    <option value="">(unassigned)</option>
                                    {executives.map((e) => (
                                      <option key={e.public_id} value={String(e.public_id)}>
                                        {e.display_name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div className="mt-2 text-xs text-[color:var(--sf-text-disabled)]">{m.email}</div>

                              <div className="mt-3">
                                <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Reps</div>
                                {myReps.length ? (
                                  <ul className="mt-2 grid gap-2">
                                    {myReps.map((r) => (
                                      <li
                                        key={r.id}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--sf-border)] px-3 py-2"
                                      >
                                        <div>
                                          <div className="text-sm text-[color:var(--sf-text-primary)]">{r.display_name}</div>
                                          <div className="text-xs text-[color:var(--sf-text-disabled)]">{r.email}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Managed by</label>
                                          <select
                                            name={`mgr_${r.public_id}`}
                                            defaultValue={m.public_id}
                                            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm text-[color:var(--sf-text-primary)]"
                                          >
                                            <option value="">(unassigned)</option>
                                            {managers.map((mm) => (
                                              <option key={mm.public_id} value={String(mm.public_id)}>
                                                {mm.display_name}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="mt-2 text-sm text-[color:var(--sf-text-disabled)]">No reps assigned.</div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-[color:var(--sf-text-disabled)]">No managers assigned to this executive.</div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--sf-text-secondary)]">
              No Executive Managers found. Create an Executive Manager user first.
            </div>
          )}

          {(unassignedManagers.length || unassignedReps.length) ? (
            <section className="rounded-xl border border-[#F1C40F] bg-[color:var(--sf-surface-alt)] p-4">
              <div className="text-sm font-semibold text-[#F1C40F]">Unassigned</div>
              <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                These users do not currently have a manager assigned.
              </p>

              {unassignedManagers.length ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-[#F1C40F]">Managers</div>
                  <ul className="mt-2 grid gap-2">
                    {unassignedManagers.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#F1C40F] bg-[color:var(--sf-surface)] px-3 py-2"
                      >
                        <div>
                          <div className="text-sm text-[color:var(--sf-text-primary)]">{m.display_name}</div>
                          <div className="text-xs text-[color:var(--sf-text-disabled)]">{m.email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Managed by</label>
                          <select
                            name={`mgr_${m.public_id}`}
                            defaultValue=""
                            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm text-[color:var(--sf-text-primary)]"
                          >
                            <option value="">(unassigned)</option>
                            {executives.map((e) => (
                              <option key={e.public_id} value={String(e.public_id)}>
                                {e.display_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {unassignedReps.length ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-[#F1C40F]">Reps</div>
                  <ul className="mt-2 grid gap-2">
                    {unassignedReps.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#F1C40F] bg-[color:var(--sf-surface)] px-3 py-2"
                      >
                        <div>
                          <div className="text-sm text-[color:var(--sf-text-primary)]">{r.display_name}</div>
                          <div className="text-xs text-[color:var(--sf-text-disabled)]">{r.email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Managed by</label>
                          <select
                            name={`mgr_${r.public_id}`}
                            defaultValue=""
                            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm text-[color:var(--sf-text-primary)]"
                          >
                            <option value="">(unassigned)</option>
                            {managers.map((m) => (
                              <option key={m.public_id} value={String(m.public_id)}>
                                {m.display_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Save org chart
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

