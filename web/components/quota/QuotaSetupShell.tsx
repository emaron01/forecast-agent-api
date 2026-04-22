import { ExportToExcelButton } from "../../app/_components/ExportToExcelButton";
import { dateOnly } from "../../lib/dateOnly";
import { QuotaSetupClient, type QuotaSetupQuarter } from "./QuotaSetupClient";

type QuotaPeriodLike = {
  id: number | string;
  fiscal_quarter?: string | number | null;
  period_name?: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

type RepQuotaLike = {
  periodId: number;
  amount: number;
  annualTarget?: number | null;
};

type RepWonLike = {
  periodId: number;
  wonAmount: number;
};

type ShellRep = {
  repId: number;
  repPublicId: string;
  repName: string;
  userId: number | null;
  hierarchyLevel: number | null;
  managerRepId: number | null;
  quota: RepQuotaLike[];
  wonByPeriod: RepWonLike[];
  isOverlay: boolean;
  managerHasQuota: boolean;
};

export type QuotaSetupShellProps = {
  fiscalYear: string;
  quotaPeriods: QuotaPeriodLike[];
  viewer: {
    repId: number | null;
    repPublicId: string;
    repName: string;
    hierarchyLevel: number;
    isAdmin: boolean;
  };
  leaderQuota: RepQuotaLike[];
  leaderHasQuota: boolean;
  leaderQuarterTotal: number;
  reps: ShellRep[];
  selectedRepPublicId?: string;
  sumRepQuotas: number;
  overlayQuotaTotal: number;
  overlayPartnerNames: string[];
  saveAction: (formData: FormData) => void | Promise<void>;
  hideClosedWonValues?: boolean;
  groupWonByPeriod?: RepWonLike[];
};

function fmtMoney(n: number | null | undefined) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function quarterNumberFromAny(v: unknown): "" | "1" | "2" | "3" | "4" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "1" || s === "q1" || s.includes("1st")) return "1";
  if (s === "2" || s === "q2" || s.includes("2nd")) return "2";
  if (s === "3" || s === "q3" || s.includes("3rd")) return "3";
  if (s === "4" || s === "q4" || s.includes("4th")) return "4";
  return "";
}

function orderedQuarterInputs(periods: QuotaPeriodLike[]): Array<{ key: "q1" | "q2" | "q3" | "q4"; periodId: number; periodLabel: string }> {
  const byQuarter = new Map<"1" | "2" | "3" | "4", QuotaPeriodLike>();
  for (const p of periods) {
    const qn = quarterNumberFromAny(p.fiscal_quarter) || quarterNumberFromAny(p.period_name);
    if (qn === "1" || qn === "2" || qn === "3" || qn === "4") {
      if (!byQuarter.has(qn)) byQuarter.set(qn, p);
    }
  }
  return ([
    { key: "q1", qn: "1" },
    { key: "q2", qn: "2" },
    { key: "q3", qn: "3" },
    { key: "q4", qn: "4" },
  ] as const)
    .map(({ key, qn }) => {
      const p = byQuarter.get(qn);
      const id = Number(p?.id);
      if (!p || !Number.isFinite(id) || id <= 0) return null;
      return {
        key,
        periodId: id,
        periodLabel: `${key.toUpperCase()} · ${dateOnly(p.period_start || "")} → ${dateOnly(p.period_end || "")}`,
      };
    })
    .filter((x): x is { key: "q1" | "q2" | "q3" | "q4"; periodId: number; periodLabel: string } => x != null);
}

function clientQuarters(periods: Array<{ key: "q1" | "q2" | "q3" | "q4"; periodId: number; periodLabel: string }>, rows: RepQuotaLike[]): QuotaSetupQuarter[] {
  const byPeriodId = new Map(rows.map((r) => [Number(r.periodId), Number(r.amount || 0)] as const));
  return periods.map((p) => ({
    key: p.key,
    periodId: p.periodId,
    periodLabel: p.periodLabel,
    initialQuotaAmount: byPeriodId.get(p.periodId) || 0,
  }));
}

export function QuotaSetupShell(props: QuotaSetupShellProps) {
  const quarters = orderedQuarterInputs(props.quotaPeriods);
  const selectedRep = props.reps.find((r) => r.repPublicId === props.selectedRepPublicId) ?? props.reps[0] ?? null;
  const selectedRepClientQuarters = selectedRep ? clientQuarters(quarters, selectedRep.quota) : [];
  const leaderClientQuarters = clientQuarters(quarters, props.leaderQuota);
  const leaderAnnualQuota = props.leaderQuota.find((q) => Number(q.annualTarget || 0) > 0)?.annualTarget ?? null;
  const showLeaderSection =
    !props.viewer.isAdmin &&
    props.viewer.repId != null &&
    Number(props.viewer.hierarchyLevel) >= 1 &&
    props.reps.length > 0 &&
    !!props.viewer.repPublicId;
  const showRepSection = props.viewer.isAdmin || !showLeaderSection || props.leaderHasQuota;
  const remainingToAssign = props.leaderQuarterTotal - props.sumRepQuotas;
  const groupWonByPeriod = new Map((props.groupWonByPeriod || []).map((r) => [Number(r.periodId), Number(r.wonAmount || 0)] as const));

  return (
    <div className="grid gap-5">
      {showLeaderSection ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Your Annual Quota</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Set your personal quota target before assigning quotas to your team.</p>
          {!props.leaderHasQuota ? (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              Set your quota before assigning team quotas
            </div>
          ) : null}
          <QuotaSetupClient
            key={`leader-shell-${props.fiscalYear}-${props.viewer.repPublicId}`}
            action={props.saveAction}
            fiscalYear={props.fiscalYear}
            repPublicId={props.viewer.repPublicId}
            repName={props.viewer.repName}
            initialAnnualQuota={leaderAnnualQuota}
            quarters={leaderClientQuarters}
            submitButtonLabel="Save My Quota"
          />
        </section>
      ) : null}

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Team Quota Assignment</h2>
        {!quarters.length ? (
          <p className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">Missing quota periods for this fiscal year (Q1–Q4).</p>
        ) : !showRepSection ? (
          <p className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">Set your quota above before assigning team quotas.</p>
        ) : !selectedRep ? (
          <p className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">No reps available for quota assignment.</p>
        ) : !props.viewer.isAdmin && !selectedRep.managerHasQuota ? (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
            Manager quota required first
          </div>
        ) : (
          <>
            <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Rep: <span className="font-medium text-[color:var(--sf-text-primary)]">{selectedRep.repName || "—"}</span>
            </div>
            <QuotaSetupClient
              key={`rep-shell-${props.fiscalYear}-${selectedRep.repPublicId}`}
              action={props.saveAction}
              fiscalYear={props.fiscalYear}
              repPublicId={selectedRep.repPublicId}
              repName={selectedRep.repName}
              initialAnnualQuota={selectedRep.quota.find((q) => Number(q.annualTarget || 0) > 0)?.annualTarget ?? null}
              quarters={selectedRepClientQuarters}
              submitButtonLabel="Save and next rep"
              isOverlay={selectedRep.isOverlay}
            />
          </>
        )}
      </section>

      {showLeaderSection && props.leaderHasQuota ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quota Summary</h2>
          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">Your Quota</span>
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.leaderQuarterTotal)}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">Sum of Rep Quotas</span>
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.sumRepQuotas)}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">Remaining to assign/ Overlay Quota not counted in Annual Quota</span>
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(remainingToAssign)}</span>
            </div>
            {props.overlayQuotaTotal > 0 ? (
              <p className="mt-2 text-base leading-relaxed text-[color:var(--sf-text-secondary)]">
                includes {fmtMoney(props.overlayQuotaTotal)} overlay quota
                {props.overlayPartnerNames.length ? ` for ${props.overlayPartnerNames.join(", ")}` : ""} not counted toward your target
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Rep quotas vs Closed Won (by quarter)</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Fiscal year: <span className="font-mono text-xs">{props.fiscalYear || "—"}</span>
            </p>
          </div>
        </div>

        {!quarters.length ? (
          <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">Missing quota periods for this fiscal year (Q1–Q4).</div>
        ) : !props.reps.length ? (
          <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">No reps available.</div>
        ) : (
          <>
            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3">rep</th>
                    {quarters.map((q) => (
                      <th key={q.periodId} className="px-4 py-3">
                        <div className="font-semibold text-[color:var(--sf-text-primary)]">{q.key.toUpperCase()}</div>
                        <div className="mt-0.5 text-[11px] font-normal text-[color:var(--sf-text-secondary)]">{q.periodLabel.replace(/^Q\d · /, "")}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {props.reps.map((rep) => {
                    const quotaByPeriodId = new Map(rep.quota.map((q) => [Number(q.periodId), Number(q.amount || 0)] as const));
                    const wonByPeriodId = new Map(rep.wonByPeriod.map((q) => [Number(q.periodId), Number(q.wonAmount || 0)] as const));
                    return (
                      <tr key={rep.repPublicId} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-4 py-3 text-[color:var(--sf-text-primary)]">
                          <div className="flex flex-wrap items-baseline gap-x-1.5 font-medium">
                            <span>{rep.repName || "—"}</span>
                            {rep.isOverlay ? <span className="text-xs font-medium text-[color:var(--sf-text-secondary)]">· Overlay</span> : null}
                          </div>
                          {rep.isOverlay ? (
                            <div className="mt-0.5 text-[11px] font-normal text-[color:var(--sf-text-secondary)]">
                              Personal target — not included in your rollup
                            </div>
                          ) : null}
                        </td>
                        {quarters.map((q) => (
                          <td key={`${rep.repPublicId}:${q.periodId}`} className="px-4 py-3 align-top">
                            <div className="grid gap-1">
                              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">quota</div>
                              <div className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                                {fmtMoney(quotaByPeriodId.get(q.periodId) || 0)}
                              </div>
                              {!props.hideClosedWonValues ? (
                                <>
                                  <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">closed won</div>
                                  <div className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                                    {fmtMoney(wonByPeriodId.get(q.periodId) || 0)}
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end">
              <ExportToExcelButton
                fileName={`Team Quotas - Quota vs Won - ${props.fiscalYear}`}
                sheets={[
                  {
                    name: "Quota vs Won",
                    rows: props.reps.map((rep) => {
                      const quotaByPeriodId = new Map(rep.quota.map((q) => [Number(q.periodId), Number(q.amount || 0)] as const));
                      const wonByPeriodId = new Map(rep.wonByPeriod.map((q) => [Number(q.periodId), Number(q.wonAmount || 0)] as const));
                      const out: Record<string, string | number> = { rep: rep.repName || "—" };
                      for (const q of quarters) {
                        out[`${q.key.toUpperCase()}_quota`] = quotaByPeriodId.get(q.periodId) || 0;
                        out[`${q.key.toUpperCase()}_won`] = groupWonByPeriod.size
                          ? groupWonByPeriod.get(q.periodId) || 0
                          : wonByPeriodId.get(q.periodId) || 0;
                      }
                      return out;
                    }) as any,
                  },
                ]}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
