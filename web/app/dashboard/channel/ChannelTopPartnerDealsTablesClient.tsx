"use client";

import { useMemo, useState } from "react";

export type TopPartnerDealRow = {
  opportunity_public_id: string;
  partner_name: string;
  deal_registration: boolean | null;
  deal_reg_date?: string | null;
  deal_reg_id?: string | null;
  account_name: string | null;
  opportunity_name: string | null;
  product: string | null;
  amount: number;
  create_date: string | null;
  close_date: string | null;
  baseline_health_score: number | null;
  health_score: number | null;
};

type SortKey = "partner" | "account" | "opportunity" | "product" | "amount" | "age" | "initial_health" | "final_health";

function fmtMoneyChannel(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function dateOnlyChannel(s: string | null | undefined) {
  return s ? String(s).slice(0, 10) : "—";
}

function daysBetweenChannel(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  return Number.isFinite(d) ? d : null;
}

function healthPctChannel(score: number | null | undefined): string {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${Math.max(0, Math.min(100, Math.round((n / 30) * 100)))}%`;
}

function renderDealRegChannel(row: Pick<TopPartnerDealRow, "deal_registration" | "deal_reg_date" | "deal_reg_id">) {
  const dealRegistration = row?.deal_registration;
  const dealRegId = String(row?.deal_reg_id || "").trim() || null;
  const dealRegDate = row?.deal_reg_date ? String(row.deal_reg_date).slice(0, 10) : null;

  // Invariant (computed at display time):
  // isRegistered = deal_registration = true OR deal_reg_date IS NOT NULL OR deal_reg_id is non-empty
  const isRegistered = dealRegistration === true || !!dealRegDate || !!dealRegId;

  const tooltip = dealRegId
    ? `Registered — ${dealRegId}`
    : dealRegDate
      ? `Registered — ${dealRegDate}`
      : isRegistered
        ? "Registered"
        : dealRegistration === false
          ? "Not registered"
          : "—";

  if (!isRegistered && dealRegistration == null && !dealRegDate && !dealRegId) {
    return (
      <span className="text-[color:var(--sf-text-secondary)]" title={tooltip}>
        —
      </span>
    );
  }

  if (isRegistered) {
    return (
      <span className="text-[#16A34A]" title={tooltip}>
        Y
      </span>
    );
  }

  return (
    <span className="text-[#E74C3C]" title={tooltip}>
      N
    </span>
  );
}

function toggleSort(
  key: SortKey,
  currentKey: SortKey,
  setKey: (k: SortKey) => void,
  currentDir: "asc" | "desc",
  setDir: (d: "asc" | "desc") => void
) {
  if (currentKey === key) {
    setDir(currentDir === "asc" ? "desc" : "asc");
  } else {
    setKey(key);
    setDir("desc");
  }
}

function sortLabelClass(active: boolean) {
  return active ? "text-yellow-600" : "";
}

function sortCellClass(active: boolean) {
  return active ? "bg-yellow-50/5" : "";
}

function sortRows(rows: TopPartnerDealRow[], sortKey: SortKey, sortDir: "asc" | "desc"): TopPartnerDealRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    if (sortKey === "partner") return dir * (a.partner_name || "").localeCompare(b.partner_name || "");
    if (sortKey === "account") return dir * (a.account_name || "").localeCompare(b.account_name || "");
    if (sortKey === "opportunity") return dir * (a.opportunity_name || "").localeCompare(b.opportunity_name || "");
    if (sortKey === "product") return dir * (a.product || "").localeCompare(b.product || "");
    if (sortKey === "age") {
      const da = daysBetweenChannel(a.create_date, a.close_date) ?? -1;
      const db = daysBetweenChannel(b.create_date, b.close_date) ?? -1;
      return dir * (da - db);
    }
    if (sortKey === "initial_health") {
      const va = Number(a.baseline_health_score ?? -1);
      const vb = Number(b.baseline_health_score ?? -1);
      return dir * (va - vb);
    }
    if (sortKey === "final_health") {
      const va = Number(a.health_score ?? -1);
      const vb = Number(b.health_score ?? -1);
      return dir * (va - vb);
    }
    return dir * (Number(b.amount || 0) - Number(a.amount || 0));
  });
}

export function ChannelTopPartnerDealsTablesClient(props: {
  won: TopPartnerDealRow[];
  lost: TopPartnerDealRow[];
  periodStart: string | null | undefined;
  periodEnd: string | null | undefined;
}) {
  const { won, lost, periodStart, periodEnd } = props;
  const [wonSortKey, setWonSortKey] = useState<SortKey>("amount");
  const [wonSortDir, setWonSortDir] = useState<"asc" | "desc">("desc");
  const [lostSortKey, setLostSortKey] = useState<SortKey>("amount");
  const [lostSortDir, setLostSortDir] = useState<"asc" | "desc">("desc");

  const wonRows = useMemo(() => sortRows(won, wonSortKey, wonSortDir), [won, wonSortKey, wonSortDir]);
  const lostRows = useMemo(() => sortRows(lost, lostSortKey, lostSortDir), [lost, lostSortKey, lostSortDir]);

  const thWon = (key: SortKey, label: string, className: string) => (
    <th
      className={`${className} cursor-pointer select-none hover:bg-[color:var(--sf-border)]/40 ${sortLabelClass(wonSortKey === key)}`}
      onClick={() => toggleSort(key, wonSortKey, setWonSortKey, wonSortDir, setWonSortDir)}
    >
      {label} {wonSortKey === key ? (wonSortDir === "asc" ? "↑" : "↓") : "↕"}
    </th>
  );

  const thLost = (key: SortKey, label: string, className: string) => (
    <th
      className={`${className} cursor-pointer select-none hover:bg-[color:var(--sf-border)]/40 ${sortLabelClass(lostSortKey === key)}`}
      onClick={() => toggleSort(key, lostSortKey, setLostSortKey, lostSortDir, setLostSortDir)}
    >
      {label} {lostSortKey === key ? (lostSortDir === "asc" ? "↑" : "↓") : "↕"}
    </th>
  );

  return (
    <>
      <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Top partner deals won (top 10 by revenue)</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Period: <span className="font-mono text-xs">{dateOnlyChannel(periodStart)}</span> →{" "}
              <span className="font-mono text-xs">{dateOnlyChannel(periodEnd)}</span>
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-md border border-[color:var(--sf-border)]">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
              <tr>
                {thWon("partner", "partner", "w-[12%] px-3 py-3 text-left")}
                <th className="w-[8%] px-3 py-3 text-center">deal reg</th>
                {thWon("account", "account", "w-[14%] px-3 py-3 text-left")}
                {thWon("opportunity", "opportunity", "w-[20%] px-3 py-3 text-left")}
                {thWon("product", "product", "w-[12%] px-3 py-3 text-left")}
                {thWon("amount", "revenue", "w-[10%] px-3 py-3 text-right whitespace-nowrap")}
                {thWon("age", "age", "w-[6%] px-3 py-3 text-right whitespace-nowrap")}
                {thWon("initial_health", "initial health", "w-[9%] px-2 py-3 text-right whitespace-nowrap")}
                {thWon("final_health", "final health", "w-[9%] px-2 py-3 text-right whitespace-nowrap")}
              </tr>
            </thead>
            <tbody>
              {wonRows.length ? (
                wonRows.map((d) => {
                  const ageDays = daysBetweenChannel(d.create_date, d.close_date);
                  return (
                    <tr key={d.opportunity_public_id} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                      <td className={`min-w-0 px-3 py-3 font-medium align-top truncate ${sortCellClass(wonSortKey === "partner")}`} title={d.partner_name}>
                        {d.partner_name}
                      </td>
                      <td className="px-3 py-3 text-center font-semibold align-top whitespace-nowrap">
                        {renderDealRegChannel(d)}
                      </td>
                      <td className={`min-w-0 px-3 py-3 align-top truncate ${sortCellClass(wonSortKey === "account")}`} title={d.account_name || undefined}>
                        {d.account_name || ""}
                      </td>
                      <td className={`min-w-0 px-3 py-3 align-top truncate ${sortCellClass(wonSortKey === "opportunity")}`} title={d.opportunity_name || undefined}>
                        {d.opportunity_name || ""}
                      </td>
                      <td className={`min-w-0 px-3 py-3 align-top truncate ${sortCellClass(wonSortKey === "product")}`} title={d.product || undefined}>
                        {d.product || ""}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(wonSortKey === "amount")}`}>
                        {fmtMoneyChannel(d.amount)}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(wonSortKey === "age")}`}>
                        {ageDays == null ? "—" : String(ageDays)}
                      </td>
                      <td className={`px-2 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(wonSortKey === "initial_health")}`}>
                        {healthPctChannel(d.baseline_health_score)}
                      </td>
                      <td className={`px-2 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(wonSortKey === "final_health")}`}>
                        {healthPctChannel(d.health_score)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                    No partner Won deals found for this quarter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Closed Loss (top 10 by revenue)</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Period: <span className="font-mono text-xs">{dateOnlyChannel(periodStart)}</span> →{" "}
              <span className="font-mono text-xs">{dateOnlyChannel(periodEnd)}</span>
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-md border border-[color:var(--sf-border)]">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
              <tr>
                {thLost("partner", "partner", "w-[12%] px-3 py-3 text-left")}
                <th className="w-[8%] px-3 py-3 text-center">deal reg</th>
                {thLost("account", "account", "w-[14%] px-3 py-3 text-left")}
                {thLost("opportunity", "opportunity", "w-[20%] px-3 py-3 text-left")}
                {thLost("product", "product", "w-[12%] px-3 py-3 text-left")}
                {thLost("amount", "revenue", "w-[10%] px-3 py-3 text-right whitespace-nowrap")}
                {thLost("age", "age", "w-[6%] px-3 py-3 text-right whitespace-nowrap")}
                {thLost("initial_health", "initial health", "w-[9%] px-2 py-3 text-right whitespace-nowrap")}
                {thLost("final_health", "final health", "w-[9%] px-2 py-3 text-right whitespace-nowrap")}
              </tr>
            </thead>
            <tbody>
              {lostRows.length ? (
                lostRows.map((d) => {
                  const ageDays = daysBetweenChannel(d.create_date, d.close_date);
                  return (
                    <tr key={d.opportunity_public_id} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                      <td className={`min-w-0 px-3 py-3 font-medium align-top truncate ${sortCellClass(lostSortKey === "partner")}`} title={d.partner_name}>
                        {d.partner_name}
                      </td>
                      <td className="px-3 py-3 text-center font-semibold align-top whitespace-nowrap">
                        {renderDealRegChannel(d)}
                      </td>
                      <td className={`min-w-0 px-3 py-3 align-top truncate ${sortCellClass(lostSortKey === "account")}`} title={d.account_name || undefined}>
                        {d.account_name || ""}
                      </td>
                      <td className={`min-w-0 px-3 py-3 align-top truncate ${sortCellClass(lostSortKey === "opportunity")}`} title={d.opportunity_name || undefined}>
                        {d.opportunity_name || ""}
                      </td>
                      <td className={`min-w-0 px-3 py-3 align-top truncate ${sortCellClass(lostSortKey === "product")}`} title={d.product || undefined}>
                        {d.product || ""}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(lostSortKey === "amount")}`}>
                        {fmtMoneyChannel(d.amount)}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(lostSortKey === "age")}`}>
                        {ageDays == null ? "—" : String(ageDays)}
                      </td>
                      <td className={`px-2 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(lostSortKey === "initial_health")}`}>
                        {healthPctChannel(d.baseline_health_score)}
                      </td>
                      <td className={`px-2 py-3 text-right font-mono text-xs align-top whitespace-nowrap ${sortCellClass(lostSortKey === "final_health")}`}>
                        {healthPctChannel(d.health_score)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                    No partner Closed Loss deals found for this quarter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
