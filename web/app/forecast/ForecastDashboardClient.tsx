"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : "—";
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
  return n >= 3 ? "text-emerald-700" : n >= 2 ? "text-indigo-700" : "text-rose-700";
}

function ScoreCard(props: { name: string; score: any; tip: any; summary: any }) {
  const score = Number(props.score || 0) || 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900">{props.name}</div>
        <div className={`text-sm font-bold ${scoreColor(score)}`}>{score}/3</div>
      </div>
      <div className="mt-2 text-xs font-semibold text-indigo-700">{labelFromSummary(props.summary, score)}</div>
      <div className="mt-2 text-xs text-slate-700">
        <span className="font-semibold">Action:</span> {String(props.tip || "—")}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        <span className="font-semibold text-slate-600">Evidence:</span> {evidenceFromSummary(props.summary)}
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
      setLastRefresh(new Date().toLocaleString());

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
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : statusKind === "err"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sales Forecaster</h1>
            <p className="mt-1 text-sm text-slate-600">Live deal coaching dashboard (polls server for updates).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
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
            <label className="text-xs font-medium text-slate-600">Search</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search account, rep, stage, AI verdict…"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
              />
              <button type="submit" className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Search
              </button>
            </div>
            <div className="mt-1 text-xs text-slate-500">Filters the current list as you type. Press Enter / Search to refresh.</div>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-slate-600">Rep (optional)</label>
            <input
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              placeholder={props.repFilterLocked ? "Locked" : "Erik M"}
              disabled={!!props.repFilterLocked}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-slate-600">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
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
            <label className="text-xs font-medium text-slate-600">Poll</label>
            <select
              value={pollMs}
              onChange={(e) => setPollMs(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
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
        <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" open>
          <summary className="cursor-pointer text-sm font-medium text-slate-900">RAW JSON</summary>
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3 text-xs text-emerald-200">
            {JSON.stringify(allDeals, null, 2)}
          </pre>
        </details>
      ) : null}

      <div className="grid gap-4">
        {filtered.map((d) => {
          const pct = healthPct(d);
          const total = Number(d.health_score ?? scoreTotal(d)) || 0;
          const justSaved = saveBlinksRef.current.has(String(d.id || ""));

          return (
            <article
              key={d.id}
              className={`rounded-xl border bg-white p-5 shadow-sm ${
                justSaved ? "border-emerald-300 ring-1 ring-emerald-200" : "border-slate-200"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold tracking-tight text-slate-900">
                    {d.account_name || "Unnamed account"}
                    {d.opportunity_name ? (
                      <span className="text-slate-500"> · {d.opportunity_name}</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                      Rep: {d.rep_name || "—"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                      Stage: {d.stage || "—"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                      Forecast: {d.forecast_stage || "—"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                      AI: {d.ai_verdict || d.ai_forecast || "—"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                      Health:{" "}
                      <span className={pct >= 80 ? "text-emerald-700" : pct >= 50 ? "text-indigo-700" : "text-rose-700"}>
                        {pct}%
                      </span>{" "}
                      ({total}/30)
                    </span>
                    {justSaved ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-900">
                        Updated this poll
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Amount: <span className="font-medium text-slate-700">{fmtMoney(d.amount)}</span> · Close:{" "}
                    <span className="font-medium text-slate-700">{d.close_date || "—"}</span> · Updated:{" "}
                    <span className="font-medium text-slate-700">{safeDate(d.updated_at)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Risk summary</div>
                  <div className="mt-2 text-sm text-slate-800">{String(d.risk_summary || "—")}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Next steps / coaching</div>
                  <div className="mt-2 text-sm text-slate-800">
                    <span className="font-semibold">Next steps:</span> {String(d.next_steps || "—")}
                  </div>
                  <div className="mt-2 text-sm text-slate-800">
                    <span className="font-semibold">Rep comments:</span> {String(d.rep_comments || "—")}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <ScoreCard name="Pain" score={d.pain_score} tip={d.pain_tip} summary={d.pain_summary} />
                <ScoreCard name="Metrics" score={d.metrics_score} tip={d.metrics_tip} summary={d.metrics_summary} />
                <ScoreCard name="Champion" score={d.champion_score} tip={d.champion_tip} summary={d.champion_summary} />
                <ScoreCard name="Economic Buyer" score={d.eb_score} tip={d.eb_tip} summary={d.eb_summary} />
                <ScoreCard name="Criteria" score={d.criteria_score} tip={d.criteria_tip} summary={d.criteria_summary} />
                <ScoreCard name="Process" score={d.process_score} tip={d.process_tip} summary={d.process_summary} />
                <ScoreCard name="Competition" score={d.competition_score} tip={d.competition_tip} summary={d.competition_summary} />
                <ScoreCard name="Paper Process" score={d.paper_score} tip={d.paper_tip} summary={d.paper_summary} />
                <ScoreCard name="Timing" score={d.timing_score} tip={d.timing_tip} summary={d.timing_summary} />
                <ScoreCard name="Budget" score={d.budget_score} tip={d.budget_tip} summary={d.budget_summary} />
              </div>

              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">Raw deal object</summary>
                <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3 text-xs text-emerald-200">
                  {JSON.stringify(d, null, 2)}
                </pre>
              </details>
            </article>
          );
        })}
      </div>

      {!filtered.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          No deals found (or you don’t have visibility to the rep filter).
        </div>
      ) : null}
    </div>
  );
}

