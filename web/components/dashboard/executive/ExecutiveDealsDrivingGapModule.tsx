"use client";

import { useEffect, useMemo, useState } from "react";
import { MEDDPICC_CANONICAL } from "../../../lib/meddpiccCanonical";

type RiskCategoryKey =
  | "pain"
  | "metrics"
  | "champion"
  | "criteria"
  | "competition"
  | "timing"
  | "budget"
  | "economic_buyer"
  | "process"
  | "paper"
  | "suppressed";

type MeddpiccEntry = {
  key:
    | "pain"
    | "metrics"
    | "champion"
    | "criteria"
    | "competition"
    | "timing"
    | "budget"
    | "economic_buyer"
    | "process"
    | "paper"
    | string;
  score: number | null;
  score_label?: string;
  tip?: string | null;
  evidence?: string | null;
};

export type ExecutiveGapDeal = {
  id: string;
  rep: { rep_public_id?: string | null; rep_name: string | null };
  deal_name: { account_name: string | null; opportunity_name: string | null };
  crm_stage: { forecast_stage?: string | null; bucket: "commit" | "best_case" | "pipeline" | null; label: string };
  amount: number;
  health: { health_pct: number | null; suppression: boolean; health_modifier?: number };
  weighted: { gap: number; crm_weighted?: number; ai_weighted?: number };
  meddpicc_tb: MeddpiccEntry[];
  signals?: { risk_summary: string | null; next_steps: string | null };
  risk_flags: Array<{ key: RiskCategoryKey; label: string; tip?: string | null }>;
};

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function deltaTextClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-[color:var(--sf-text-secondary)]";
  return n > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

function healthTextClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function scoreBadgeClass(score: number | null) {
  const s = Number(score == null ? 0 : score);
  if (s >= 3) return "border-[#2ECC71]/50 bg-[#2ECC71]/10 text-[#2ECC71]";
  if (s >= 2) return "border-[#F1C40F]/60 bg-[#F1C40F]/10 text-[#F1C40F]";
  return "border-[#E74C3C]/60 bg-[#E74C3C]/10 text-[#E74C3C]";
}

function canonicalTitle(key: string) {
  const row = (MEDDPICC_CANONICAL as any)?.[key] || null;
  return String(row?.titleLine || key).trim() || key;
}

function canonicalMeaning(key: string) {
  const row = (MEDDPICC_CANONICAL as any)?.[key] || null;
  return String(row?.meaningLine || "").trim();
}

function chipLabel(key: string) {
  const k = String(key || "").trim();
  if (k === "economic_buyer") return "Economic Buyer";
  if (k === "paper") return "Paper Process";
  if (k === "process") return "Decision Process";
  if (k === "champion") return "Champion";
  if (k === "criteria") return "Decision Criteria";
  if (k === "competition") return "Competition";
  if (k === "timing") return "Timeline";
  if (k === "budget") return "Budget";
  if (k === "metrics") return "Metrics";
  if (k === "pain") return "Pain";
  return canonicalTitle(k);
}

function riskToneForDeal(d: ExecutiveGapDeal): "high" | "medium" | "low" | "muted" {
  if (d.health?.suppression) return "high";
  const hp = d.health?.health_pct;
  const rf = Array.isArray(d.risk_flags) ? d.risk_flags.length : 0;
  if (hp != null && hp < 50) return "high";
  if (rf >= 3) return "high";
  if (hp != null && hp < 80) return "medium";
  if (rf >= 2) return "medium";
  if (rf >= 1) return "low";
  return "muted";
}

function riskPillClass(tone: "high" | "medium" | "low" | "muted") {
  if (tone === "high") return "border-[#E74C3C]/40 bg-[#E74C3C]/10 text-[#E74C3C]";
  if (tone === "medium") return "border-[#F1C40F]/40 bg-[#F1C40F]/10 text-[#F1C40F]";
  if (tone === "low") return "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]";
  return "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";
}

function dealTitle(d: ExecutiveGapDeal) {
  const a = String(d.deal_name?.account_name || "").trim();
  const o = String(d.deal_name?.opportunity_name || "").trim();
  const t = [a, o].filter(Boolean).join(" — ");
  return t || "(Untitled deal)";
}

function dealRep(d: ExecutiveGapDeal) {
  return String(d.rep?.rep_name || "").trim() || "—";
}

export function ExecutiveDealsDrivingGapModule(props: {
  title: string;
  subtitle?: string;
  deals: ExecutiveGapDeal[];
}) {
  const deals = props.deals || [];
  const [expandedDealId, setExpandedDealId] = useState<string>("");
  const [expandedCat, setExpandedCat] = useState<Record<string, string>>({});

  const dealById = useMemo(() => {
    const m = new Map<string, ExecutiveGapDeal>();
    for (const d of deals) m.set(String(d.id), d);
    return m;
  }, [deals]);

  useEffect(() => {
    if (expandedDealId && !dealById.has(expandedDealId)) setExpandedDealId("");
  }, [expandedDealId, dealById]);

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{props.title}</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            {props.subtitle || "Top impact deals (click a row to drill into MEDDPICC+TB coaching)."}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-lg border border-[color:var(--sf-border)]">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[120px_1.6fr_140px_140px_120px_110px_140px_40px] gap-0 bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <div className="px-3 py-2">Risk</div>
            <div className="px-3 py-2">Deal</div>
            <div className="px-3 py-2">Sales Rep</div>
            <div className="px-3 py-2">Stage</div>
            <div className="px-3 py-2 text-right">Amount</div>
            <div className="px-3 py-2 text-right">Health</div>
            <div className="px-3 py-2 text-right">Gap</div>
            <div className="px-3 py-2 text-right" aria-hidden="true">
              &nbsp;
            </div>
          </div>

          {deals.length ? (
            deals.map((d) => {
              const id = String(d.id);
              const open = expandedDealId === id;
              const tone = riskToneForDeal(d);
              const stage = String(d.crm_stage?.label || "").trim() || "—";
              const activeKey = String(expandedCat[id] || "").trim();
              const activeCat = (d.meddpicc_tb || []).find((c) => String(c.key) === activeKey) || null;

              const detailsId = `exec-gap-deal:${id}`;

              return (
                <div key={id} className="border-t border-[color:var(--sf-border)]">
                  <button
                    type="button"
                    className="grid w-full grid-cols-[120px_1.6fr_140px_140px_120px_110px_140px_40px] items-center text-left text-sm text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                    aria-expanded={open}
                    aria-controls={detailsId}
                    onClick={() => {
                      setExpandedDealId((prev) => (prev === id ? "" : id));
                      setExpandedCat((prev) => ({ ...prev, [id]: "" }));
                    }}
                  >
                    <div className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${riskPillClass(tone)}`}>
                        {tone === "high" ? "High" : tone === "medium" ? "Medium" : tone === "low" ? "Low" : "—"}
                      </span>
                    </div>
                    <div className="px-3 py-2 font-medium">{dealTitle(d)}</div>
                    <div className="px-3 py-2 text-xs text-[color:var(--sf-text-secondary)]">{dealRep(d)}</div>
                    <div className="px-3 py-2 text-xs text-[color:var(--sf-text-secondary)]">{stage}</div>
                    <div className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(d.amount)}</div>
                    <div className={`px-3 py-2 text-right font-mono text-xs ${healthTextClass(d.health?.health_pct ?? null)}`}>
                      {d.health?.health_pct == null ? "—" : `${d.health.health_pct}%`}
                    </div>
                    <div className={`px-3 py-2 text-right font-mono text-xs ${deltaTextClass(Number(d.weighted?.gap || 0) || 0)}`}>{fmtMoney(d.weighted?.gap)}</div>
                    <div className="px-3 py-2 text-right text-[color:var(--sf-text-secondary)]">{open ? "▾" : "›"}</div>
                  </button>

                  <div
                    id={detailsId}
                    className={[
                      "overflow-hidden transition-[max-height,opacity] duration-300 ease-out motion-reduce:transition-none",
                      open ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0",
                    ].join(" ")}
                  >
                    <div className="bg-[color:var(--sf-surface-alt)] px-4 py-4">
                      <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC+TB Risk Factors (click Category for Details)</div>
                          <div className="text-xs text-[color:var(--sf-text-secondary)]">Click a factor to expand Tip + Evidence</div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {(d.meddpicc_tb || []).map((c) => {
                            const key = String(c.key || "").trim();
                            const active = key && key === activeKey;
                            const label = chipLabel(key);
                            const score = c.score == null ? null : Number(c.score);
                            return (
                              <button
                                key={key || label}
                                type="button"
                                onClick={() => {
                                  if (!key) return;
                                  setExpandedCat((prev) => ({ ...prev, [id]: active ? "" : key }));
                                }}
                                className={[
                                  "rounded-full border px-3 py-1 text-xs font-semibold",
                                  scoreBadgeClass(Number.isFinite(score as any) ? (score as number) : 0),
                                  active ? "ring-2 ring-[color:var(--sf-accent-primary)]/30" : "",
                                ].join(" ")}
                                aria-expanded={active}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>

                        <div
                          className={[
                            "overflow-hidden transition-[max-height,opacity] duration-300 ease-out motion-reduce:transition-none",
                            activeCat ? "mt-3 max-h-[600px] opacity-100" : "max-h-0 opacity-0",
                          ].join(" ")}
                        >
                          {activeCat ? (
                            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                                {canonicalTitle(String(activeCat.key))}{" "}
                                {canonicalMeaning(String(activeCat.key)) ? (
                                  <span className="font-normal text-[color:var(--sf-text-secondary)]">— {canonicalMeaning(String(activeCat.key))}</span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-sm font-semibold text-[color:var(--sf-accent-primary)]">{activeCat.score_label || "—"}</div>

                              <div className="mt-3 grid gap-2 md:grid-cols-2">
                                <div className="rounded-md border border-[#F1C40F]/40 bg-[#F1C40F]/10 p-3 text-sm text-[color:var(--sf-text-primary)]">
                                  <div className="text-xs font-semibold text-[#F1C40F]">Tip</div>
                                  <div className="mt-1">{activeCat.tip || "—"}</div>
                                </div>
                                <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-sm text-[color:var(--sf-text-primary)]">
                                  <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Evidence</div>
                                  <div className="mt-1">{activeCat.evidence || "—"}</div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                            <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Risk Summary</div>
                            <div className="mt-1 text-sm text-[color:var(--sf-text-primary)]">{d.signals?.risk_summary || "—"}</div>
                          </div>
                          <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                            <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Next Steps</div>
                            <div className="mt-1 text-sm text-[color:var(--sf-text-primary)]">{d.signals?.next_steps || "—"}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="border-t border-[color:var(--sf-border)] p-5 text-sm text-[color:var(--sf-text-secondary)]">No deals found for the current filters.</div>
          )}
        </div>
      </div>
    </section>
  );
}

