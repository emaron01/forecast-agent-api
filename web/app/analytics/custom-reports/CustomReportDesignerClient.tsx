"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExportToExcelButton } from "../../_components/ExportToExcelButton";

type RepRow = {
  rep_id: string;
  rep_name: string;
  manager_id: string;
  manager_name: string;
  avg_health_all: number | null;
  avg_health_commit: number | null;
  avg_health_best: number | null;
  avg_health_pipeline: number | null;
  avg_health_won: number | null;
  avg_health_closed: number | null;
  avg_pain: number | null;
  avg_metrics: number | null;
  avg_champion: number | null;
  avg_eb: number | null;
  avg_competition: number | null;
  avg_criteria: number | null;
  avg_process: number | null;
  avg_paper: number | null;
  avg_timing: number | null;
  avg_budget: number | null;
  quota: number;
  total_count: number;
  won_amount: number;
  won_count: number;
  lost_count: number;
  active_amount: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  created_amount: number;
  created_count: number;
  win_rate: number | null;
  opp_to_win: number | null;
  aov: number | null;
  attainment: number | null;
  commit_coverage: number | null;
  best_coverage: number | null;
  partner_contribution: number | null;
  partner_win_rate: number | null;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
  mix_pipeline: number | null;
  mix_best: number | null;
  mix_commit: number | null;
  mix_won: number | null;
};

type SavedReportRow = {
  id: string;
  report_type: string;
  name: string;
  description: string | null;
  config: any;
  created_at?: string;
  updated_at?: string;
};

type MetricKey =
  | "avg_health_all"
  | "avg_health_commit"
  | "avg_health_best"
  | "avg_health_pipeline"
  | "avg_health_won"
  | "avg_health_closed"
  | "avg_pain"
  | "avg_metrics"
  | "avg_champion"
  | "avg_eb"
  | "avg_competition"
  | "avg_criteria"
  | "avg_process"
  | "avg_paper"
  | "avg_timing"
  | "avg_budget"
  | "quota"
  | "won_amount"
  | "won_count"
  | "attainment"
  | "active_amount"
  | "pipeline_amount"
  | "commit_amount"
  | "best_amount"
  | "commit_coverage"
  | "best_coverage"
  | "win_rate"
  | "opp_to_win"
  | "aov"
  | "partner_contribution"
  | "partner_win_rate"
  | "created_amount"
  | "created_count"
  | "avg_days_won"
  | "avg_days_lost"
  | "avg_days_active"
  | "mix_pipeline"
  | "mix_best"
  | "mix_commit"
  | "mix_won";

const METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: "avg_health_all", label: "Avg Health (Overall)" },
  { key: "avg_health_best", label: "Avg Health (Best Case)" },
  { key: "avg_health_closed", label: "Avg Health (Closed)" },
  { key: "avg_health_commit", label: "Avg Health (Commit)" },
  { key: "avg_health_pipeline", label: "Avg Health (Pipeline)" },
  { key: "avg_health_won", label: "Avg Health (Won)" },
  { key: "aov", label: "AOV ($)" },
  { key: "avg_days_active", label: "Aging (avg days)" },
  { key: "best_amount", label: "Best Case ($)" },
  { key: "best_coverage", label: "Best Case Coverage (%)" },
  { key: "commit_amount", label: "Commit ($)" },
  { key: "commit_coverage", label: "Commit Coverage (%)" },
  { key: "created_amount", label: "New Pipeline Created ($)" },
  { key: "created_count", label: "New Opps Created (#)" },
  { key: "active_amount", label: "Pipeline Value ($)" },
  { key: "mix_best", label: "Mix: Best (%)" },
  { key: "mix_commit", label: "Mix: Commit (%)" },
  { key: "mix_pipeline", label: "Mix: Pipeline (%)" },
  { key: "mix_won", label: "Mix: Won (%)" },
  { key: "opp_to_win", label: "Opp→Win Conversion (%)" },
  { key: "partner_contribution", label: "Partner Contribution (%)" },
  { key: "partner_win_rate", label: "Partner Win Rate (%)" },
  { key: "quota", label: "Quota ($)" },
  { key: "attainment", label: "Quota Attainment (%)" },
  { key: "avg_days_lost", label: "Sales Cycle (Lost, days)" },
  { key: "avg_days_won", label: "Sales Cycle (Won, days)" },
  { key: "win_rate", label: "Win Rate (%)" },
  { key: "won_amount", label: "Closed Won ($)" },
  { key: "won_count", label: "# Won" },
];

const MEDDPICC_HEALTH_METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: "avg_metrics", label: "Metrics" },
  { key: "avg_eb", label: "Economic Buyer" },
  { key: "avg_criteria", label: "Decision Criteria" },
  { key: "avg_process", label: "Decision Process" },
  { key: "avg_pain", label: "Pain" },
  { key: "avg_champion", label: "Champion" },
  { key: "avg_competition", label: "Competition" },
  { key: "avg_paper", label: "Paper Process" },
  { key: "avg_timing", label: "Timing" },
  { key: "avg_budget", label: "Budget" },
];

const ALL_METRICS: Array<{ key: MetricKey; label: string }> = [...METRICS, ...MEDDPICC_HEALTH_METRICS];

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function healthFracFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(1, n / 30));
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function lmhFromAvg(avg: any) {
  const n = avg == null ? null : Number(avg);
  if (n == null || !Number.isFinite(n) || n <= 0) {
    return { label: "—", cls: "text-[color:var(--sf-text-disabled)] bg-[color:var(--sf-surface-alt)]" };
  }
  const k = Math.round(n);
  const level = k >= 3 ? "H" : k >= 1 ? "M" : "L";
  const cls =
    level === "H"
      ? "text-[#2ECC71] bg-[#2ECC71]/10"
      : level === "M"
        ? "text-[#F1C40F] bg-[#F1C40F]/10"
        : "text-[#E74C3C] bg-[#E74C3C]/10";
  return { label: level, cls };
}

const MEDDPICC_KEYS = new Set<MetricKey>(MEDDPICC_HEALTH_METRICS.map((m) => m.key));

function renderMetricValue(key: MetricKey, r: RepRow) {
  const v: any = (r as any)[key];
  if (key.startsWith("avg_health_")) return fmtPct(healthFracFrom30(v));
  if (MEDDPICC_KEYS.has(key)) return lmhFromAvg(v).label;
  if (
    key.endsWith("_coverage") ||
    key === "attainment" ||
    key === "win_rate" ||
    key === "opp_to_win" ||
    key.startsWith("mix_") ||
    key.startsWith("partner_")
  ) {
    return fmtPct(v == null ? null : Number(v));
  }
  if (key.includes("amount") || key === "quota" || key === "aov") return fmtMoney(v);
  if (key.startsWith("avg_days_")) return v == null ? "—" : String(Math.round(Number(v)));
  return fmtNum(v);
}

function renderMetricCell(key: MetricKey, r: RepRow) {
  if (MEDDPICC_KEYS.has(key)) {
    const b = lmhFromAvg((r as any)[key]);
    return <span className={`inline-flex min-w-[40px] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold ${b.cls}`}>{b.label}</span>;
  }
  return renderMetricValue(key, r);
}

function safeNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function wavg(pairs: Array<{ v: number | null; w: number }>) {
  let num = 0;
  let den = 0;
  for (const p of pairs) {
    if (p.v == null) continue;
    const w = safeNum(p.w);
    if (w <= 0) continue;
    num += safeNum(p.v) * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function rollupRepRows(args: { label: string; execName: string; managerName: string; rows: RepRow[] }): RepRow {
  const rows = args.rows || [];
  const sum = <K extends keyof RepRow>(key: K) => rows.reduce((acc, r) => acc + safeNum((r as any)[key]), 0);

  const quota = sum("quota");
  const total_count = sum("total_count");
  const won_amount = sum("won_amount");
  const won_count = sum("won_count");
  const lost_count = sum("lost_count");
  const active_amount = sum("active_amount");
  const commit_amount = sum("commit_amount");
  const best_amount = sum("best_amount");
  const pipeline_amount = sum("pipeline_amount");
  const created_amount = sum("created_amount");
  const created_count = sum("created_count");

  const active_count = Math.max(0, total_count - won_count - lost_count);
  const closed_count = won_count + lost_count;

  const win_rate = won_count + lost_count > 0 ? won_count / (won_count + lost_count) : null;
  const opp_to_win = total_count > 0 ? won_count / total_count : null;
  const aov = won_count > 0 ? won_amount / won_count : null;
  const attainment = quota > 0 ? won_amount / quota : null;
  const commit_coverage = quota > 0 ? commit_amount / quota : null;
  const best_coverage = quota > 0 ? best_amount / quota : null;

  const partner_contribution = wavg(rows.map((r) => ({ v: r.partner_contribution, w: safeNum(r.won_amount) })));
  const partner_win_rate = wavg(rows.map((r) => ({ v: r.partner_win_rate, w: safeNum(r.won_count) + safeNum(r.lost_count) })));

  const avg_days_won = wavg(rows.map((r) => ({ v: r.avg_days_won, w: safeNum(r.won_count) })));
  const avg_days_lost = wavg(rows.map((r) => ({ v: r.avg_days_lost, w: safeNum(r.lost_count) })));
  const avg_days_active = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_days_active, w: ac };
    })
  );

  const avg_health_all = wavg(rows.map((r) => ({ v: r.avg_health_all, w: safeNum(r.total_count) })));
  const avg_health_won = wavg(rows.map((r) => ({ v: r.avg_health_won, w: safeNum(r.won_count) })));
  const avg_health_closed = wavg(rows.map((r) => ({ v: r.avg_health_closed, w: safeNum(r.won_count) + safeNum(r.lost_count) })));
  const avg_health_pipeline = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_health_pipeline, w: ac };
    })
  );
  const avg_health_commit = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_health_commit, w: ac };
    })
  );
  const avg_health_best = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_health_best, w: ac };
    })
  );

  const avg_pain = wavg(rows.map((r) => ({ v: r.avg_pain, w: safeNum(r.total_count) })));
  const avg_metrics = wavg(rows.map((r) => ({ v: r.avg_metrics, w: safeNum(r.total_count) })));
  const avg_champion = wavg(rows.map((r) => ({ v: r.avg_champion, w: safeNum(r.total_count) })));
  const avg_eb = wavg(rows.map((r) => ({ v: r.avg_eb, w: safeNum(r.total_count) })));
  const avg_competition = wavg(rows.map((r) => ({ v: r.avg_competition, w: safeNum(r.total_count) })));
  const avg_criteria = wavg(rows.map((r) => ({ v: r.avg_criteria, w: safeNum(r.total_count) })));
  const avg_process = wavg(rows.map((r) => ({ v: r.avg_process, w: safeNum(r.total_count) })));
  const avg_paper = wavg(rows.map((r) => ({ v: r.avg_paper, w: safeNum(r.total_count) })));
  const avg_timing = wavg(rows.map((r) => ({ v: r.avg_timing, w: safeNum(r.total_count) })));
  const avg_budget = wavg(rows.map((r) => ({ v: r.avg_budget, w: safeNum(r.total_count) })));

  const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
  const mix_pipeline = mixDen > 0 ? pipeline_amount / mixDen : null;
  const mix_best = mixDen > 0 ? best_amount / mixDen : null;
  const mix_commit = mixDen > 0 ? commit_amount / mixDen : null;
  const mix_won = mixDen > 0 ? won_amount / mixDen : null;

  return {
    rep_id: "",
    rep_name: args.label,
    manager_id: "",
    manager_name: args.managerName,
    avg_health_all,
    avg_health_commit,
    avg_health_best,
    avg_health_pipeline,
    avg_health_won,
    avg_health_closed,
    avg_pain,
    avg_metrics,
    avg_champion,
    avg_eb,
    avg_competition,
    avg_criteria,
    avg_process,
    avg_paper,
    avg_timing,
    avg_budget,
    quota,
    total_count,
    won_amount,
    won_count,
    lost_count,
    active_amount,
    commit_amount,
    best_amount,
    pipeline_amount,
    created_amount,
    created_count,
    win_rate,
    opp_to_win,
    aov,
    attainment,
    commit_coverage,
    best_coverage,
    partner_contribution,
    partner_win_rate,
    avg_days_won,
    avg_days_lost,
    avg_days_active,
    mix_pipeline,
    mix_best,
    mix_commit,
    mix_won,
  };
}

function hasAnyReportData(r: RepRow | null | undefined) {
  if (!r) return false;
  // Conservative "has any actual data" check so we can suppress empty subtotal sections.
  if (safeNum(r.total_count) > 0) return true;
  if (safeNum(r.won_count) > 0) return true;
  if (safeNum(r.lost_count) > 0) return true;
  if (safeNum(r.active_amount) > 0) return true;
  if (safeNum(r.won_amount) > 0) return true;
  if (safeNum(r.created_amount) > 0) return true;
  if (safeNum(r.created_count) > 0) return true;
  if (safeNum(r.commit_amount) > 0) return true;
  if (safeNum(r.best_amount) > 0) return true;
  if (safeNum(r.pipeline_amount) > 0) return true;
  if (safeNum(r.quota) > 0) return true;

  const avgKeys: Array<keyof RepRow> = [
    "avg_health_all",
    "avg_health_commit",
    "avg_health_best",
    "avg_health_pipeline",
    "avg_health_won",
    "avg_health_closed",
    "avg_pain",
    "avg_metrics",
    "avg_champion",
    "avg_eb",
    "avg_competition",
    "avg_criteria",
    "avg_process",
    "avg_paper",
    "avg_timing",
    "avg_budget",
  ];
  for (const k of avgKeys) {
    const v = (r as any)[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return true;
  }
  return false;
}

/** Rollup / aggregate labels — exclude from bar/line/radar (individual REPs only). */
function isRollupRepNameForChart(repName: string | undefined) {
  const n = String(repName || "");
  return (
    n.startsWith("Executive Total:") ||
    n.startsWith("Manager Total:") ||
    n.startsWith("Team Total") ||
    n === "Team Total"
  );
}

function RepNameXAxisTick(props: { x?: number; y?: number; payload?: { value?: string } }) {
  const { x = 0, y = 0, payload } = props;
  const name = String(payload?.value || "");
  const short = name.length > 12 ? `${name.slice(0, 12)}…` : name;
  return (
    <text x={x} y={y} dy={16} textAnchor="middle" fill="var(--sf-text-secondary)" fontSize={11}>
      {short}
    </text>
  );
}

type ChartType = "table" | "bar" | "line" | "radar";

const CHART_COLORS = [
  "#00BCD4",
  "#2ECC71",
  "#F1C40F",
  "#E74C3C",
  "#9B59B6",
  "#FF9800",
  "#00BFA5",
  "#FF5722",
  "#607D8B",
  "#795548",
];

function normalizeConfig(cfg: any): { repIds: string[]; metrics: MetricKey[]; chartType: ChartType } {
  const repIds = Array.isArray(cfg?.repIds) ? cfg.repIds.map((x: any) => String(x)).filter(Boolean) : [];
  const metricsRaw = Array.isArray(cfg?.metrics) ? cfg.metrics.map((x: any) => String(x)).filter(Boolean) : [];
  const metrics = metricsRaw.filter((k) => ALL_METRICS.some((m) => m.key === (k as any))) as MetricKey[];
  const rawType = cfg?.chartType;
  const chartType: ChartType =
    rawType === "bar" || rawType === "line" || rawType === "radar" || rawType === "table" ? rawType : "table";
  return { repIds, metrics, chartType };
}

export function CustomReportDesignerClient(props: {
  reportType: string;
  repRows: RepRow[];
  repDirectory: Array<{ id: number; name: string; manager_rep_id: number | null; role: string }>;
  /** Logged-in executive’s rep id (for “My Team”); REPs with this manager_rep_id are selected. */
  currentExecutiveRepId?: string | null;
  savedReports: SavedReportRow[];
  periodLabel: string;
}) {
  const reps = props.repRows || [];
  const repDirectory = props.repDirectory || [];
  const saved = props.savedReports || [];

  const [selectedRepIds, setSelectedRepIds] = useState<Set<string>>(() => new Set());
  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricKey>>(
    () => new Set(["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"])
  );

  const [reportId, setReportId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [savedPickId, setSavedPickId] = useState<string>("");
  const [showReportMeta, setShowReportMeta] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [chartType, setChartType] = useState<ChartType>("table");

  const selectedReps = useMemo(() => {
    if (!selectedRepIds.size) return [] as RepRow[];
    return reps
      .filter((r) => selectedRepIds.has(String(r.rep_id)))
      .slice()
      .sort((a, b) => b.won_amount - a.won_amount || a.rep_name.localeCompare(b.rep_name));
  }, [reps, selectedRepIds]);

  const execHeaderName = useMemo(() => {
    const exec = repDirectory.find((r) => String(r.role || "").trim() === "EXEC_MANAGER");
    if (exec) {
      const nm = String(exec.name || "").trim();
      return nm || `Executive ${exec.id}`;
    }
    return props.periodLabel;
  }, [repDirectory, props.periodLabel]);

  const teamTotalRow = useMemo(() => {
    if (!selectedReps.length) return null;
    return rollupRepRows({
      label: "Team Total",
      execName: execHeaderName,
      managerName: "",
      rows: selectedReps,
    });
  }, [selectedReps, execHeaderName]);

  const managerGroups = useMemo(() => {
    const managers = repDirectory.filter((r) => r.role === "MANAGER" || r.role === "EXEC_MANAGER");
    const dirReps = repDirectory.filter((r) => r.role === "REP");
    const groups = managers
      .map((mgr) => ({
        manager: mgr,
        reps: dirReps.filter((r) => r.manager_rep_id === mgr.id),
      }))
      .filter((g) => g.reps.length > 0);
    const managedRepIds = new Set(groups.flatMap((g) => g.reps.map((r) => r.id)));
    const unassigned = dirReps.filter((r) => !managedRepIds.has(r.id));
    return { groups, unassigned };
  }, [repDirectory]);

  const metricsAlpha = useMemo(() => METRICS.slice().sort((a, b) => a.label.localeCompare(b.label)), []);
  const labelForMetric = useMemo(() => {
    const m = new Map<MetricKey, string>();
    for (const x of ALL_METRICS) m.set(x.key, x.label);
    return m;
  }, []);
  const metricList = useMemo(
    () => Array.from(selectedMetrics.values()).sort((a, b) => (labelForMetric.get(a) || String(a)).localeCompare(labelForMetric.get(b) || String(b))),
    [selectedMetrics, labelForMetric]
  );

  const selectedFields = useMemo(
    () => metricList.map((k) => ({ key: k, label: labelForMetric.get(k) || String(k) })),
    [metricList, labelForMetric]
  );
  const previewRows = selectedReps;

  const chartPreviewRows = useMemo(
    () => previewRows.filter((row) => !isRollupRepNameForChart(row.rep_name)),
    [previewRows]
  );

  const chartData = useMemo(
    () =>
      chartPreviewRows.map((row) => ({
        rep: row.rep_name,
        ...selectedFields.reduce(
          (acc, f) => ({
            ...acc,
            [f.label]: Number((row as any)[f.key] ?? 0),
          }),
          {} as Record<string, number>
        ),
      })),
    [chartPreviewRows, selectedFields]
  );

  const radarData = useMemo(() => {
    return selectedFields.map((f) => {
      const point: Record<string, any> = { metric: f.label };
      chartPreviewRows.forEach((row) => {
        point[row.rep_name] = Number((row as any)[f.key] ?? 0);
      });
      return point;
    });
  }, [selectedFields, chartPreviewRows]);

  const chartHasFields = selectedFields.length > 0;
  const chartHasReps = chartPreviewRows.length > 0;
  const showChartPlaceholder = chartType !== "table" && (!chartHasFields || !chartHasReps);
  const showBarLineChart =
    (chartType === "bar" || chartType === "line") && chartHasFields && chartHasReps;
  const showRadarChart = chartType === "radar" && chartHasFields && chartHasReps;

  function toggleRep(id: string) {
    setSelectedRepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMetric(k: MetricKey) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function clearSelection() {
    setSelectedRepIds(new Set());
    setSelectedMetrics(new Set(["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"]));
    setReportId("");
    setName("");
    setDescription("");
    setSavedPickId("");
    setStatus("");
    setChartType("table");
  }

  async function save() {
    if (!name.trim()) {
      setStatus("Name is required.");
      setShowReportMeta(true);
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const payload = {
        report_type: props.reportType,
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        config: {
          version: 1,
          repIds: Array.from(selectedRepIds.values()),
          metrics: Array.from(selectedMetrics.values()),
          chartType,
        },
      };
      const res = await fetch("/api/analytics/saved-reports", {
        method: reportId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportId ? { ...payload, id: reportId } : payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Save failed (${res.status})`);
      setStatus(reportId ? "Saved changes." : "Saved.");
      if (!reportId && json?.id) setReportId(String(json.id));
      // easiest refresh: reload page list
      window.location.reload();
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteReport(id: string) {
    if (!id) return;
    if (!window.confirm("Delete this saved report?")) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch(`/api/analytics/saved-reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Delete failed (${res.status})`);
      setStatus("Deleted.");
      window.location.reload();
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function loadReport(r: SavedReportRow) {
    const cfg = normalizeConfig(r.config);
    const defaultMetrics: MetricKey[] = [
      "won_amount",
      "attainment",
      "active_amount",
      "avg_health_all",
      "win_rate",
      "avg_days_active",
    ];
    const effectiveMetrics = cfg.metrics.length ? cfg.metrics : defaultMetrics;
    setSelectedRepIds(new Set(cfg.repIds));
    setSelectedMetrics(new Set(effectiveMetrics));
    setChartType(cfg.chartType);
    setReportId(String(r.id || ""));
    setName(String(r.name || ""));
    setDescription(String(r.description || ""));
    setSavedPickId(String(r.id || ""));
    setStatus(`Loaded "${r.name}".`);
  }

  function startNewSavedReport() {
    setReportId("");
    setName("");
    setDescription("");
    setSavedPickId("");
    setStatus("");
  }

  const exportRows = useMemo(() => {
    const teamStr = `Executive: ${execHeaderName}`;
    const rows: Record<string, any>[] = selectedReps.map((r) => {
      const out: Record<string, any> = {
        rep: r.rep_name,
        team: teamStr,
      };
      for (const k of metricList) {
        out[labelForMetric.get(k) || k] = renderMetricValue(k, r);
      }
      return out;
    });
    if (teamTotalRow && hasAnyReportData(teamTotalRow)) {
      const totalOut: Record<string, any> = {
        rep: teamTotalRow.rep_name,
        team: teamStr,
      };
      for (const k of metricList) {
        totalOut[labelForMetric.get(k) || k] = renderMetricValue(k, teamTotalRow);
      }
      rows.push(totalOut);
    }
    return rows;
  }, [metricList, selectedReps, execHeaderName, teamTotalRow, labelForMetric]);

  const allRepDirectoryRepIds = useMemo(
    () => repDirectory.filter((r) => r.role === "REP").map((r) => String(r.id)),
    [repDirectory]
  );

  function selectAllReps() {
    setSelectedRepIds(new Set(allRepDirectoryRepIds));
  }

  function clearAllReps() {
    setSelectedRepIds(new Set());
  }

  function selectMyTeam() {
    selectAllReps();
  }

  const toggleManagerReps = useCallback(
    (managerId: number) => {
      const group = managerGroups.groups.find((g) => g.manager.id === managerId);
      if (!group) return;
      const repIds = group.reps.map((r) => String(r.id));
      setSelectedRepIds((prev) => {
        const allSelected = repIds.length > 0 && repIds.every((id) => prev.has(id));
        const next = new Set(prev);
        if (allSelected) repIds.forEach((id) => next.delete(id));
        else repIds.forEach((id) => next.add(id));
        return next;
      });
    },
    [managerGroups.groups]
  );

  const toggleUnassignedReps = useCallback(() => {
    const repIds = managerGroups.unassigned.map((r) => String(r.id));
    if (!repIds.length) return;
    setSelectedRepIds((prev) => {
      const allSelected = repIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) repIds.forEach((id) => next.delete(id));
      else repIds.forEach((id) => next.add(id));
      return next;
    });
  }, [managerGroups.unassigned]);

  const outlineQuickBtn =
    "rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)]";

  return (
    <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Designer</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Period: {props.periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={savedPickId}
            onChange={(e) => {
              const id = String(e.target.value || "");
              setSavedPickId(id);
              if (!id) {
                startNewSavedReport();
                return;
              }
              const r = saved.find((x) => String(x.id) === id) || null;
              if (r) loadReport(r);
            }}
            className="h-[40px] min-w-[220px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          >
            <option value="">Select saved report…</option>
            {saved.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowReportMeta((v) => !v)}
            className="h-[40px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
          >
            Title/Description {showReportMeta ? "▲" : "▼"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
          >
            {reportId ? "Save changes" : "Save report"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
          >
            Clear
          </button>
        </div>
      </div>

      {showReportMeta ? (
        <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Report title</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="e.g. QBR rep comparison"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[42px] w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="What is this report for?"
              />
            </div>
          </div>
          {status ? <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{status}</div> : null}
        </div>
      ) : status ? (
        <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{status}</div>
      ) : null}

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Reps</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startNewSavedReport}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface)]"
            >
              New saved
            </button>
            <button
              type="button"
              disabled={!savedPickId}
              onClick={() => deleteReport(String(savedPickId))}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)] disabled:opacity-50"
            >
              Delete saved
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={selectAllReps} className={outlineQuickBtn}>
            All Reps
          </button>
          <button type="button" onClick={clearAllReps} className={outlineQuickBtn}>
            Clear
          </button>
          <button type="button" onClick={selectMyTeam} className={outlineQuickBtn}>
            My Team
          </button>
        </div>
        <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
          {managerGroups.groups.map((group) => {
            const mgr = group.manager;
            const repIds = group.reps.map((r) => String(r.id));
            const allSelected = repIds.length > 0 && repIds.every((id) => selectedRepIds.has(id));
            const someSelected = repIds.some((id) => selectedRepIds.has(id)) && !allSelected;
            const box = allSelected ? "☑" : someSelected ? "⊟" : "☐";
            return (
              <div key={`mgr-grp:${mgr.id}`}>
                <div
                  role="button"
                  tabIndex={0}
                  className="text-xs font-semibold text-[color:var(--sf-text-secondary)] uppercase tracking-wide mt-3 mb-1 cursor-pointer hover:text-[color:var(--sf-text-primary)]"
                  onClick={() => toggleManagerReps(mgr.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleManagerReps(mgr.id);
                    }
                  }}
                >
                  {box} {mgr.name}
                </div>
                {group.reps.map((rep) => (
                  <label key={rep.id} className="ml-4 flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedRepIds.has(String(rep.id))}
                      onChange={() => toggleRep(String(rep.id))}
                    />
                    <span className="text-sm text-[color:var(--sf-text-primary)]">{rep.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {managerGroups.unassigned.length ? (
            <div className="mt-3">
              {(() => {
                const repIds = managerGroups.unassigned.map((r) => String(r.id));
                const allSelected = repIds.every((id) => selectedRepIds.has(id));
                const someSelected = repIds.some((id) => selectedRepIds.has(id)) && !allSelected;
                const box = allSelected ? "☑" : someSelected ? "⊟" : "☐";
                return (
                  <>
                    <div
                      role="button"
                      tabIndex={0}
                      className="text-xs font-semibold text-[color:var(--sf-text-secondary)] uppercase tracking-wide mt-3 mb-1 cursor-pointer hover:text-[color:var(--sf-text-primary)]"
                      onClick={() => toggleUnassignedReps()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleUnassignedReps();
                        }
                      }}
                    >
                      {box} Other
                    </div>
                    {managerGroups.unassigned.map((rep) => (
                      <label key={rep.id} className="ml-4 flex items-center gap-2 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={selectedRepIds.has(String(rep.id))}
                          onChange={() => toggleRep(String(rep.id))}
                        />
                        <span className="text-sm text-[color:var(--sf-text-primary)]">{rep.name}</span>
                      </label>
                    ))}
                  </>
                );
              })()}
            </div>
          ) : null}
          {!managerGroups.groups.length && !managerGroups.unassigned.length ? (
            <div className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No reps found.</div>
          ) : null}
        </div>
        <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">Select reps to include in the preview and export.</div>
      </div>

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Report fields</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {metricsAlpha.map((m) => {
            const checked = selectedMetrics.has(m.key);
            return (
              <label key={m.key} className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                <input type="checkbox" checked={checked} onChange={() => toggleMetric(m.key)} />
                <span>{m.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)] mb-2">Visualization</div>
        <div className="flex flex-wrap gap-2">
          {(["table", "bar", "line", "radar"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setChartType(type)}
              className={
                chartType === type
                  ? "rounded-full border px-3 py-1 text-xs font-semibold border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] text-white"
                  : "rounded-full border px-3 py-1 text-xs font-semibold border-[color:var(--sf-border)] text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]"
              }
            >
              {type === "table" ? "📋 Table" : type === "bar" ? "📊 Bar" : type === "line" ? "📈 Line" : "🕸️ Radar"}
            </button>
          ))}
        </div>

      </div>

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC+TB Health</div>
        <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
          Averages shown as <span className="font-mono">L</span> (0), <span className="font-mono">M</span> (1–2), <span className="font-mono">H</span> (3)
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MEDDPICC_HEALTH_METRICS.map((m) => {
            const checked = selectedMetrics.has(m.key);
            return (
              <label key={m.key} className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                <input type="checkbox" checked={checked} onChange={() => toggleMetric(m.key)} />
                <span>{m.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 items-end gap-2">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Preview</div>
        <div className="text-sm font-semibold text-center text-[color:var(--sf-text-secondary)]">{props.periodLabel}</div>
        <div className="text-sm font-semibold text-right text-[color:var(--sf-text-secondary)]">
          Executive: <span className="font-mono">{execHeaderName}</span>
        </div>
      </div>

      {showChartPlaceholder ? (
        <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-8 text-center text-sm text-[color:var(--sf-text-secondary)]">
          {!chartHasFields
            ? "Select report fields above to visualize data."
            : "Select reps above to visualize data."}
        </div>
      ) : null}

      {showBarLineChart && chartType === "bar" ? (
        <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
              <XAxis
                dataKey="rep"
                angle={0}
                textAnchor="middle"
                interval={0}
                height={40}
                tick={RepNameXAxisTick}
              />
              <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--sf-surface)",
                  border: "1px solid var(--sf-border)",
                  color: "var(--sf-text-primary)",
                }}
              />
              <Legend
                wrapperStyle={{
                  color: "var(--sf-text-secondary)",
                  fontSize: 12,
                  paddingTop: 8,
                }}
              />
              {selectedFields.map((f, i) => (
                <Bar
                  key={f.key}
                  dataKey={f.label}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  name={f.label}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {showBarLineChart && chartType === "line" ? (
        <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
              <XAxis
                dataKey="rep"
                angle={0}
                textAnchor="middle"
                interval={0}
                height={40}
                tick={RepNameXAxisTick}
              />
              <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--sf-surface)",
                  border: "1px solid var(--sf-border)",
                  color: "var(--sf-text-primary)",
                }}
              />
              <Legend
                wrapperStyle={{
                  color: "var(--sf-text-secondary)",
                  fontSize: 12,
                  paddingTop: 8,
                }}
              />
              {selectedFields.map((f, i) => (
                <Line
                  key={f.key}
                  type="monotone"
                  dataKey={f.label}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  dot={{ fill: CHART_COLORS[i % CHART_COLORS.length] }}
                  name={f.label}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {showRadarChart ? (
        <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
          <ResponsiveContainer width="100%" height={400}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--sf-border)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
              <PolarRadiusAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} angle={90} />
              {chartPreviewRows.map((row, i) => (
                <Radar
                  key={row.rep_id || row.rep_name}
                  name={row.rep_name}
                  dataKey={row.rep_name}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.15}
                />
              ))}
              <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--sf-surface)",
                  border: "1px solid var(--sf-border)",
                  color: "var(--sf-text-primary)",
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">rep</th>
              {metricList.map((k) => (
                <th key={k} className="px-4 py-3 text-right">
                      {labelForMetric.get(k) || k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selectedReps.map((r) => (
              <tr key={`rep:${r.rep_id}`} className="border-t border-[color:var(--sf-border)]">
                <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{r.rep_name}</td>
                {metricList.map((k) => (
                  <td key={k} className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">
                    {renderMetricCell(k, r)}
                  </td>
                ))}
              </tr>
            ))}
            {teamTotalRow && hasAnyReportData(teamTotalRow) ? (
              <tr className="border-t-2 border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                <td className="px-4 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">{teamTotalRow.rep_name}</td>
                {metricList.map((k) => (
                  <td key={k} className="px-4 py-2 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                    {renderMetricCell(k, teamTotalRow)}
                  </td>
                ))}
              </tr>
            ) : null}
            {!selectedReps.length ? (
              <tr>
                <td colSpan={1 + metricList.length} className="px-4 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">
                  No reps selected.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-end">
        <ExportToExcelButton fileName={`Custom Report - ${props.periodLabel}`} sheets={[{ name: "Report", rows: exportRows }]} />
      </div>
    </section>
  );
}

