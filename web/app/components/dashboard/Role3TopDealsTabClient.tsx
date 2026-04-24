"use client";

import { useMemo, useState } from "react";

type Role3TopDealRow = {
  opportunity_public_id: string;
  account_name: string | null;
  opportunity_name: string | null;
  partner_name: string | null;
  product: string | null;
  amount: number;
  create_date: string | null;
  close_date: string | null;
  baseline_health_score: number | null;
  health_score: number | null;
};

type SortDir = "asc" | "desc";

function fmtMoney(n: unknown) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function dateOnly(s: string | null | undefined) {
  return s ? String(s).slice(0, 10) : "-";
}

function daysBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
  return Number.isFinite(d) ? d : null;
}

function healthPctFrom30(score: unknown) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round((n / 30) * 100);
  return Math.max(0, Math.min(100, pct));
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function HealthScorePill({ score }: { score: unknown }) {
  const pct = healthPctFrom30(score);
  return <span className={`font-mono text-sm ${healthColorClass(pct)}`}>{pct == null ? "-" : `${pct}%`}</span>;
}

function Role3TopDealsTable(props: {
  title: string;
  emptyLabel: string;
  rows: Role3TopDealRow[];
  activePeriod?: { period_start: string; period_end: string } | null;
}) {
  const [sortKey, setSortKey] = useState<string>("amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  }

  const sortedRows = useMemo(() => {
    const rows = props.rows ?? [];
    return [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "account") return dir * String(a.account_name || "").localeCompare(String(b.account_name || ""));
      if (sortKey === "opportunity") {
        return dir * String(a.opportunity_name || "").localeCompare(String(b.opportunity_name || ""));
      }
      if (sortKey === "partner") return dir * String(a.partner_name || "").localeCompare(String(b.partner_name || ""));
      if (sortKey === "product") return dir * String(a.product || "").localeCompare(String(b.product || ""));
      if (sortKey === "age") return dir * ((daysBetween(a.create_date, a.close_date) ?? -1) - (daysBetween(b.create_date, b.close_date) ?? -1));
      if (sortKey === "initial_health") return dir * (Number(a.baseline_health_score ?? -1) - Number(b.baseline_health_score ?? -1));
      if (sortKey === "final_health") return dir * (Number(a.health_score ?? -1) - Number(b.health_score ?? -1));
      return dir * (Number(b.amount || 0) - Number(a.amount || 0));
    });
  }, [props.rows, sortDir, sortKey]);

  const sortLabelClass = (active: boolean) => (active ? "text-yellow-600" : "");
  const sortCellClass = (active: boolean) => (active ? "bg-yellow-50/5" : "");
  const period = props.activePeriod;

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">{props.title}</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Period: <span className="font-mono text-xs">{dateOnly(period?.period_start)}</span> →{" "}
            <span className="font-mono text-xs">{dateOnly(period?.period_end)}</span>
          </p>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Sorted by revenue descending</p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr>
              <th
                className={`w-[16%] px-3 py-3 text-left cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "account")}`}
                onClick={() => toggleSort("account")}
              >
                account {sortKey === "account" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
              <th
                className={`w-[22%] px-3 py-3 text-left cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "opportunity")}`}
                onClick={() => toggleSort("opportunity")}
              >
                opportunity {sortKey === "opportunity" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
              <th
                className={`w-[16%] px-3 py-3 text-left cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "partner")}`}
                onClick={() => toggleSort("partner")}
              >
                channel partner {sortKey === "partner" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
              <th
                className={`w-[12%] px-3 py-3 text-left cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "product")}`}
                onClick={() => toggleSort("product")}
              >
                product {sortKey === "product" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
              <th
                className={`w-[12%] px-3 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "amount")}`}
                onClick={() => toggleSort("amount")}
              >
                revenue {sortKey === "amount" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
              <th
                className={`w-[6%] px-3 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "age")}`}
                onClick={() => toggleSort("age")}
              >
                age {sortKey === "age" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
              <th
                className={`w-[9%] px-2 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "initial_health")}`}
                onClick={() => toggleSort("initial_health")}
              >
                initial health {sortKey === "initial_health" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
              <th
                className={`w-[9%] px-2 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-[color:var(--sf-border)] ${sortLabelClass(sortKey === "final_health")}`}
                onClick={() => toggleSort("final_health")}
              >
                final health {sortKey === "final_health" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? (
              sortedRows.map((deal) => (
                <tr
                  key={deal.opportunity_public_id}
                  className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]"
                >
                  <td className={`px-3 py-3 align-top ${sortCellClass(sortKey === "account")}`} title={deal.account_name || undefined}>
                    <div className="max-w-[220px] truncate">{deal.account_name || "-"}</div>
                  </td>
                  <td
                    className={`px-3 py-3 align-top ${sortCellClass(sortKey === "opportunity")}`}
                    title={deal.opportunity_name || undefined}
                  >
                    <div className="max-w-[280px] truncate">{deal.opportunity_name || "-"}</div>
                  </td>
                  <td className={`px-3 py-3 align-top ${sortCellClass(sortKey === "partner")}`} title={deal.partner_name || undefined}>
                    <div className="max-w-[220px] truncate">{deal.partner_name || "-"}</div>
                  </td>
                  <td className={`px-3 py-3 align-top ${sortCellClass(sortKey === "product")}`} title={deal.product || undefined}>
                    <div className="max-w-[180px] truncate">{deal.product || "-"}</div>
                  </td>
                  <td className={`px-3 py-3 text-right font-mono text-xs whitespace-nowrap ${sortCellClass(sortKey === "amount")}`}>
                    {fmtMoney(deal.amount)}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono text-xs whitespace-nowrap ${sortCellClass(sortKey === "age")}`}>
                    {daysBetween(deal.create_date, deal.close_date) == null ? "-" : String(daysBetween(deal.create_date, deal.close_date))}
                  </td>
                  <td
                    className={`px-3 py-3 text-right align-top whitespace-nowrap ${sortCellClass(sortKey === "initial_health")}`}
                  >
                    <HealthScorePill score={deal.baseline_health_score} />
                  </td>
                  <td className={`px-3 py-3 text-right align-top whitespace-nowrap ${sortCellClass(sortKey === "final_health")}`}>
                    <HealthScorePill score={deal.health_score} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  {props.emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Role3TopDealsTabClient(props: {
  topDealsWon?: Role3TopDealRow[];
  topDealsLost?: Role3TopDealRow[];
  activePeriod?: { period_start: string; period_end: string } | null;
}) {
  return (
    <div className="-mx-4 -mt-4 space-y-5">
      <Role3TopDealsTable
        title="Closed Won"
        emptyLabel="No won deals found for this quarter."
        rows={props.topDealsWon ?? []}
        activePeriod={props.activePeriod}
      />
      <Role3TopDealsTable
        title="Closed Loss"
        emptyLabel="No closed loss deals found for this quarter."
        rows={props.topDealsLost ?? []}
        activePeriod={props.activePeriod}
      />
    </div>
  );
}
