"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MEDDPICC_CANONICAL } from "../../lib/meddpiccCanonical";
import { closedOutcomeFromStage } from "../../lib/opportunityOutcome";
import { dateOnly } from "../../lib/dateOnly";

type Deal = Record<string, any> & {
  id: string;
  updated_at?: string | null;
  rep_name?: string | null;
  account_name?: string | null;
  opportunity_name?: string | null;
  amount?: number | null;
  close_date?: string | null;
  stage?: string | null;
  forecast_stage?: string | null;
  ai_verdict?: string | null;
  ai_forecast?: string | null;
  health_score?: number | null;
  risk_summary?: string | null;
  next_steps?: string | null;
  rep_comments?: string | null;
};

function safeDate(d: any) {
  const s = dateOnly(d);
  return s || "—";
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function scoreTotal(deal: Deal) {
  const keys = [
    "pain_score",
    "metrics_score",
    "champion_score",
    "eb_score",
    "criteria_score",
    "process_score",
    "competition_score",
    "paper_score",
    "timing_score",
    "budget_score",
  ];
  return keys.reduce((sum, k) => sum + (Number(deal?.[k] || 0) || 0), 0);
}

function healthPct(deal: Deal) {
  const hs = Number(deal.health_score);
  if (Number.isFinite(hs) && hs > 0) return Math.max(0, Math.min(100, Math.round((hs / 30) * 100)));
  const total = scoreTotal(deal);
  return Math.max(0, Math.min(100, Math.round((total / 30) * 100)));
}

function labelFromSummary(summary: any, fallbackScore: any) {
  const s = String(summary || "");
  if (s.includes(":")) return s.split(":")[0].trim();
  const n = Number(fallbackScore || 0) || 0;
  return `Score ${n}/3`;
}

function evidenceFromSummary(summary: any) {
  const s = String(summary || "");
  if (s.includes(":")) return s.split(":").slice(1).join(":").trim() || "—";
  return s.trim() || "—";
}

function scoreColor(s: any) {
  const n = Number(s || 0) || 0;
  // Semantic scoring colors — MUST remain hard-coded
  return n >= 3 ? "text-[#2ECC71]" : n >= 2 ? "text-[#F1C40F]" : "text-[#E74C3C]";
}

function ScoreCard(props: { titleLine: string; meaningLine: string; score: any; tip: any; summary: any }) {
  const score = Number(props.score || 0) || 0;
  return (
    <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{props.titleLine}</div>
          <div className="mt-0.5 text-[11px] text-[color:var(--sf-text-disabled)]">{props.meaningLine}</div>
        </div>
        <div className={`text-sm font-bold ${scoreColor(score)}`}>{score}/3</div>
      </div>
      <div className="mt-2 text-xs font-semibold text-[color:var(--sf-accent-primary)]">{labelFromSummary(props.summary, score)}</div>
      <div className="mt-2 text-xs text-[#F1C40F]">
        <span className="font-semibold">Tip:</span> {String(props.tip || "—")}
      </div>
      <div className="mt-1 text-xs text-[color:var(--sf-text-primary)]">
        <span className="font-semibold text-[color:var(--sf-text-secondary)]">Evidence:</span> {evidenceFromSummary(props.summary)}
      </div>
    </div>
  );
}

export function ForecastDashboardClient(props: {
  defaultRepName?: string;
  repFilterLocked?: boolean;
}) {
  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<
    "updated_desc" | "updated_asc" | "amount_desc" | "amount_asc" | "health_desc" | "health_asc"
  >("updated_desc");
  const [pollMs, setPollMs] = useState(10000);
  const [repFilter, setRepFilter] = useState(props.defaultRepName || "");
  const [statusKind, setStatusKind] = useState<"ok" | "warn" | "err">("warn");
  const [statusMsg, setStatusMsg] = useState("Ready.");
  const [lastRefresh, setLastRefresh] = useState<string>("—");
  const [saveCount, setSaveCount] = useState(0);
  const [showRaw, setShowRaw] = useState(false);

  const lastSnapshotRef = useRef<Map<string, { upd: string | null }>>(new Map());
  const saveBlinksRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<any>(null);

  async function refresh() {
    setStatusKind("warn");
    setStatusMsg("Fetching latest deals…");
    setSaveCount(0);
    saveBlinksRef.current.clear();

    const params = new URLSearchParams();
    if (repFilter.trim()) params.set("rep_name", repFilter.trim());
    params.set("limit", "200");

    try {
      const res = await fetch(`/api/forecast/deals?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setStatusKind("err");
        setStatusMsg(data?.error ? String(data.error) : `API error (${res.status})`);
        setAllDeals([]);
        return;
      }

      const deals = Array.isArray(data.deals) ? (data.deals as Deal[]) : [];
      setAllDeals(deals);
      setLastRefresh(dateOnly(new Date()) || "—");

      let saves = 0;
      for (const d of deals) {
        const id = String(d.id || "");
        if (!id) continue;
        const nowUpd = d.updated_at ? String(d.updated_at) : null;
        const prev = lastSnapshotRef.current.get(id);
        if (prev && nowUpd && prev.upd && nowUpd !== prev.upd) {
          saves++;
          saveBlinksRef.current.add(id);
        }
        lastSnapshotRef.current.set(id, { upd: nowUpd });
      }
      setSaveCount(saves);
      setStatusKind("ok");
      setStatusMsg(saves > 0 ? `Detected ${saves} update(s) since last poll.` : "No updates detected this poll.");
    } catch (e: any) {
      setStatusKind("err");
      setStatusMsg(`Fetch failed: ${e?.message || String(e)}`);
      setAllDeals([]);
    }
  }

  useEffect(() => {
    // Initial load
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => void refresh(), pollMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, repFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = allDeals.slice();
    if (q) {
      list = list.filter((d) => {
        const hay = [
          d.account_name,
          d.opportunity_name,
          d.rep_name,
          d.stage,
          d.forecast_stage,
          d.ai_verdict,
          d.risk_summary,
          d.next_steps,
          d.rep_comments,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    list.sort((a, b) => {
      const au = new Date(a.updated_at || 0).getTime();
      const bu = new Date(b.updated_at || 0).getTime();
      const aa = Number(a.amount || 0) || 0;
      const ba = Number(b.amount || 0) || 0;
      const ah = Number(a.health_score ?? scoreTotal(a)) || 0;
      const bh = Number(b.health_score ?? scoreTotal(b)) || 0;
      switch (sort) {
        case "updated_asc":
          return au - bu;
        case "updated_desc":
          return bu - au;
        case "amount_asc":
          return aa - ba;
        case "amount_desc":
          return ba - aa;
        case "health_asc":
          return ah - bh;
        case "health_desc":
          return bh - ah;
        default:
          return bu - au;
      }
    });
    return list;
  }, [allDeals, search, sort]);

  const pillClass =
    statusKind === "ok"
      ? "border-[#2ECC71] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
      : statusKind === "err"
        ? "border-[#E74C3C] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
        : "border-[#F1C40F] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]";

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sales Forecaster</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Live deal coaching dashboard (polls server for updates).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/forecast/simple"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              title="Simplified table view with queue review controls."
            >
              Simple dashboard
            </Link>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              {showRaw ? "Hide RAW" : "Show RAW"}
            </button>
          </div>
        </div>

        <form
          className="mt-4 grid gap-3 md:grid-cols-12"
          onSubmit={(e) => {
            e.preventDefault();
            void refresh();
          }}
        >
          <div className="md:col-span-4">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Search</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search account, rep, stage, AI verdict…"
                className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
              >
                Search
              </button>
            </div>
            <div className="mt-1 text-xs text-[color:var(--sf-text-disabled)]">
              Filters the current list as you type. Press Enter / Search to refresh.
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Rep (optional)</label>
            <input
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              placeholder={props.repFilterLocked ? "Locked" : "Erik M"}
              disabled={!!props.repFilterLocked}
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)] disabled:opacity-60"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            >
              <option value="updated_desc">Updated (newest)</option>
              <option value="updated_asc">Updated (oldest)</option>
              <option value="health_desc">Health score (high)</option>
              <option value="health_asc">Health score (low)</option>
              <option value="amount_desc">Amount (high)</option>
              <option value="amount_asc">Amount (low)</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Poll</label>
            <select
              value={pollMs}
              onChange={(e) => setPollMs(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            >
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={20000}>20s</option>
              <option value={60000}>60s</option>
            </select>
          </div>
        </form>
      </section>

      <section className={`rounded-xl border p-4 ${pillClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium">
            Status:{" "}
            <span className="font-semibold">
              {statusKind === "ok" ? "OK" : statusKind === "err" ? "ERROR" : "INFO"}
            </span>{" "}
            · {statusMsg}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-current/20 px-3 py-1">Last refresh: {lastRefresh}</span>
            <span className="rounded-full border border-current/20 px-3 py-1">Deals: {filtered.length}</span>
            <span className="rounded-full border border-current/20 px-3 py-1">Updates: {saveCount}</span>
          </div>
        </div>
      </section>

      {showRaw ? (
        <details className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm" open>
          <summary className="cursor-pointer text-sm font-medium text-[color:var(--sf-text-primary)]">RAW JSON</summary>
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-xs text-[color:var(--sf-text-secondary)]">
            {JSON.stringify(allDeals, null, 2)}
          </pre>
        </details>
      ) : null}

      <div className="grid gap-4">
        {filtered.map((d) => {
          const pct = healthPct(d);
          const total = Number(d.health_score ?? scoreTotal(d)) || 0;
          const justSaved = saveBlinksRef.current.has(String(d.id || ""));
          const dealId = String(d.id || "");
          const closed = closedOutcomeFromStage(d.stage) || closedOutcomeFromStage(d.forecast_stage);

          return (
            <article
              key={d.id}
              className={`rounded-xl border bg-[color:var(--sf-surface)] p-5 shadow-sm ${
                justSaved ? "border-[#2ECC71] ring-1 ring-[#2ECC71]" : "border-[color:var(--sf-border)]"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
                    {d.account_name || "Unnamed account"}
                    {d.opportunity_name ? (
                      <span className="text-[color:var(--sf-text-secondary)]"> · {d.opportunity_name}</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-secondary)]">
                      Rep: {d.rep_name || "—"}
                    </span>
                    <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-secondary)]">
                      Stage: {d.stage || "—"}
                    </span>
                    <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-secondary)]">
                      Forecast: {d.forecast_stage || "—"}
                    </span>
                    <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-secondary)]">
                      AI: {d.ai_verdict || d.ai_forecast || "—"}
                    </span>
                    <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-secondary)]">
                      Health:{" "}
                      <span className={pct >= 80 ? "text-[#2ECC71]" : pct >= 50 ? "text-[#F1C40F]" : "text-[#E74C3C]"}>
                        {pct}%
                      </span>{" "}
                      ({total}/30)
                    </span>
                    {justSaved ? (
                      <span className="rounded-full border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-primary)]">
                        Updated this poll
                      </span>
                    ) : null}
                    {dealId ? (
                      closed ? (
                        <span
                          className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-disabled)]"
                          title="Closed deals (Won/Lost) cannot be reviewed."
                        >
                          Closed ({closed})
                        </span>
                      ) : (
                        <Link
                          href={`/opportunities/${encodeURIComponent(dealId)}/deal-review`}
                          className="rounded-full border border-[color:var(--sf-accent-secondary)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-accent-secondary)] hover:bg-[color:var(--sf-surface)]"
                          title="Open single-deal review (mic tuning + full review + category updates)."
                        >
                          Review
                        </Link>
                      )
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs text-[color:var(--sf-text-disabled)]">
                    Amount: <span className="font-medium text-[color:var(--sf-text-primary)]">{fmtMoney(d.amount)}</span> · Close:{" "}
                    <span className="font-medium text-[color:var(--sf-text-primary)]">{dateOnly(d.close_date) || "—"}</span> · Updated:{" "}
                    <span className="font-medium text-[color:var(--sf-text-primary)]">{safeDate(d.updated_at)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Risk summary</div>
                  <div className="mt-2 text-sm text-[color:var(--sf-text-primary)]">{String(d.risk_summary || "—")}</div>
                </div>
                <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Next steps / coaching</div>
                  <div className="mt-2 text-sm text-[color:var(--sf-text-primary)]">
                    <span className="font-semibold">Next steps:</span> {String(d.next_steps || "—")}
                  </div>
                  <div className="mt-2 text-sm text-[color:var(--sf-text-primary)]">
                    <span className="font-semibold">Rep comments:</span> {String(d.rep_comments || "—")}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.pain.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.pain.meaningLine}
                  score={d.pain_score}
                  tip={d.pain_tip}
                  summary={d.pain_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.metrics.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.metrics.meaningLine}
                  score={d.metrics_score}
                  tip={d.metrics_tip}
                  summary={d.metrics_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.champion.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.champion.meaningLine}
                  score={d.champion_score}
                  tip={d.champion_tip}
                  summary={d.champion_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.criteria.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.criteria.meaningLine}
                  score={d.criteria_score}
                  tip={d.criteria_tip}
                  summary={d.criteria_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.competition.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.competition.meaningLine}
                  score={d.competition_score}
                  tip={d.competition_tip}
                  summary={d.competition_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.timing.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.timing.meaningLine}
                  score={d.timing_score}
                  tip={d.timing_tip}
                  summary={d.timing_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.budget.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.budget.meaningLine}
                  score={d.budget_score}
                  tip={d.budget_tip}
                  summary={d.budget_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.economic_buyer.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.economic_buyer.meaningLine}
                  score={d.eb_score}
                  tip={d.eb_tip}
                  summary={d.eb_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.process.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.process.meaningLine}
                  score={d.process_score}
                  tip={d.process_tip}
                  summary={d.process_summary}
                />
                <ScoreCard
                  titleLine={MEDDPICC_CANONICAL.paper.titleLine}
                  meaningLine={MEDDPICC_CANONICAL.paper.meaningLine}
                  score={d.paper_score}
                  tip={d.paper_tip}
                  summary={d.paper_summary}
                />
              </div>

              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-medium text-[color:var(--sf-text-secondary)]">Raw deal object</summary>
                <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-xs text-[color:var(--sf-text-secondary)]">
                  {JSON.stringify(d, null, 2)}
                </pre>
              </details>
            </article>
          );
        })}
      </div>

      {!filtered.length ? (
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 text-sm text-[color:var(--sf-text-secondary)] shadow-sm">
          No deals found (or you don’t have visibility to the rep filter).
        </div>
      ) : null}
    </div>
  );
}

