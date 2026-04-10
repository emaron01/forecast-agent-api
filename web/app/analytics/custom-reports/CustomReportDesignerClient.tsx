"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import {
  HIERARCHY,
  isChannelExecLevel,
  isChannelManagerLevel,
  isChannelRepLevel,
  isExecManagerLevel,
  isManagerLevel,
  isRepLevel,
  roleToHierarchyLevel,
  type HierarchyLevel,
} from "../../../lib/roleHelpers";

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

type RepDirectoryEntry = {
  id: number;
  name: string;
  manager_rep_id: number | null;
  role: string;
  hierarchy_level?: number | null;
};

/** Prefer `role` string; fall back to `hierarchy_level` when reps.role does not match enum (common for channel rows). */
function directoryRowLevel(row: RepDirectoryEntry): HierarchyLevel | null {
  const fromRole = roleToHierarchyLevel(row.role);
  if (fromRole != null) return fromRole;
  const n = Number(row.hierarchy_level);
  if (!Number.isFinite(n)) return null;
  if (
    n === HIERARCHY.EXEC_MANAGER ||
    n === HIERARCHY.MANAGER ||
    n === HIERARCHY.REP ||
    n === HIERARCHY.CHANNEL_EXEC ||
    n === HIERARCHY.CHANNEL_MANAGER ||
    n === HIERARCHY.CHANNEL_REP
  ) {
    return n;
  }
  return null;
}

function isLeaderRow(row: RepDirectoryEntry) {
  const level = directoryRowLevel(row);
  return (
    isManagerLevel(level) ||
    isExecManagerLevel(level) ||
    isChannelExecLevel(level) ||
    isChannelManagerLevel(level)
  );
}

function isRepRow(row: RepDirectoryEntry) {
  const level = directoryRowLevel(row);
  return isRepLevel(level) || isChannelRepLevel(level);
}

type SavedReportRow = {
  id: string;
  report_type: string;
  name: string;
  description: string | null;
  config: any;
  created_at?: string;
  updated_at?: string;
};

type QuotaPeriodOption = {
  id: string;
  name: string;
  fiscal_year?: string;
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
  { key: "avg_health_closed", label: "Avg Health Closed Lost (%)" },
  { key: "avg_health_commit", label: "Avg Health (Commit)" },
  { key: "avg_health_pipeline", label: "Avg Health (Pipeline)" },
  { key: "avg_health_won", label: "Avg Health Won (%)" },
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
  { key: "opp_to_win", label: "Opp->Win Conversion (%)" },
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

type PeriodSelectionState = { ids: Set<string>; lastId: string };

function periodSelectionReducer(
  state: PeriodSelectionState,
  action:
    | { type: "toggle"; id: string }
    | { type: "syncFromServer"; initialId: string }
    | { type: "replace"; ids: string[] }
): PeriodSelectionState {
  if (action.type === "syncFromServer") {
    const id = String(action.initialId || "").trim();
    if (!id) return { ids: new Set(), lastId: "" };
    return { ids: new Set([id]), lastId: id };
  }
  if (action.type === "replace") {
    const ids = action.ids.map((id) => String(id).trim()).filter(Boolean);
    if (ids.length === 0) return { ids: new Set(), lastId: "" };
    return { ids: new Set(ids), lastId: ids[ids.length - 1] ?? "" };
  }
  const next = new Set(state.ids);
  const had = next.has(action.id);
  if (had) {
    next.delete(action.id);
    const newLast = state.lastId === action.id ? Array.from(next)[0] ?? "" : state.lastId;
    return { ids: next, lastId: newLast };
  }
  next.add(action.id);
  return { ids: next, lastId: action.id };
}

function yearGroupKey(period: QuotaPeriodOption): string {
  const fy = String(period.fiscal_year || "").trim();
  if (fy) {
    if (/^FY\d{4}$/i.test(fy)) return fy.replace(/^fy/i, "FY");
    if (/^\d{4}$/.test(fy)) return `FY${fy}`;
    return fy;
  }
  const match = period.name.match(/FY(\d{4})/i);
  if (match) return `FY${match[1]}`;
  return "Unknown";
}

function quarterSortKey(name: string): number {
  const quarter = name.match(/\bQ([1-4])\b/i);
  if (quarter) return parseInt(quarter[1], 10);
  const ordinal = name.match(/(\d)(?:st|nd|rd|th)\s+Quarter/i);
  if (ordinal) return parseInt(ordinal[1], 10);
  return 99;
}

function fmtMoney(n: any) {
  if (n === null || n === undefined) return "-";
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined) {
  if (n == null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return `${Math.round(Number(n) * 100)}%`;
}

function healthFracFrom30(score: any) {
  if (score === null || score === undefined) return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  return Math.max(0, Math.min(1, n / 30));
}

function fmtNum(n: any) {
  if (n === null || n === undefined) return "-";
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString();
}

function lmhFromAvg(avg: any) {
  const n = avg == null ? null : Number(avg);
  if (n == null || !Number.isFinite(n)) {
    return { label: "-", cls: "text-[color:var(--sf-text-disabled)] bg-[color:var(--sf-surface-alt)]" };
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
    return fmtPct(v != null ? Number(v) : null);
  }
  if (key.includes("amount") || key === "quota" || key === "aov") return fmtMoney(v);
  if (key.startsWith("avg_days_")) return v == null || v === undefined ? "-" : String(Math.round(Number(v)));
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
  if (n == null) return 0;
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

function RepNameXAxisTick(props: { x?: number; y?: number; payload?: { value?: string } }) {
  const { x = 0, y = 0, payload } = props;
  const name = String(payload?.value || "");
  const short = name.length > 12 ? `${name.slice(0, 12)}...` : name;
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

function normalizeConfig(cfg: any): { repIds: string[]; metrics: MetricKey[]; chartType: ChartType; selectedPeriodIds: string[] } {
  const repIds = Array.isArray(cfg?.repIds) ? cfg.repIds.map((x: any) => String(x)).filter(Boolean) : [];
  const metricsRaw = Array.isArray(cfg?.metrics) ? cfg.metrics.map((x: any) => String(x)).filter(Boolean) : [];
  const metrics = metricsRaw.filter((k) => ALL_METRICS.some((m) => m.key === (k as any))) as MetricKey[];
  const selectedPeriodIds = Array.isArray(cfg?.selectedPeriodIds)
    ? cfg.selectedPeriodIds.map((x: any) => String(x)).filter(Boolean)
    : [];
  const rawType = cfg?.chartType;
  const chartType: ChartType =
    rawType === "bar" || rawType === "line" || rawType === "radar" || rawType === "table" ? rawType : "table";
  return { repIds, metrics, chartType, selectedPeriodIds };
}

export function CustomReportDesignerClient(props: {
  reportType: string;
  repRows: RepRow[];
  repDirectory: RepDirectoryEntry[];
  /** Logged-in executive's rep id (for "My Team"); REPs with this manager_rep_id are selected. */
  currentExecutiveRepId?: string | null;
  savedReports: SavedReportRow[];
  periodLabel: string;
  /** Quarters for report-builder period selector (executive dashboard). */
  quotaPeriods?: QuotaPeriodOption[];
  orgId?: number;
  /** Server-selected period; used to skip redundant client fetch until the user picks another quarter. */
  initialSelectedPeriodId?: string;
}) {
  const quotaPeriods = props.quotaPeriods ?? [];
  const orgIdForFetch = props.orgId ?? 0;
  const initialPeriodId = props.initialSelectedPeriodId ?? quotaPeriods[0]?.id ?? "";

  const [repRowsLocal, setRepRowsLocal] = useState<RepRow[]>(() => props.repRows || []);
  const [allPeriodResults, setAllPeriodResults] = useState<{
    periodId: string;
    label: string;
    rows: RepRow[];
  }[]>([]);
  const [periodLabelDisplay, setPeriodLabelDisplay] = useState(() => props.periodLabel);
  const [controlsOpen, setControlsOpen] = useState(true);

  const [periodSelection, dispatchPeriodSelection] = useReducer(
    periodSelectionReducer,
    undefined,
    (): PeriodSelectionState => ({
      ids: new Set(initialPeriodId ? [initialPeriodId] : []),
      lastId: initialPeriodId || "",
    })
  );

  const periodsNewestFirst = useMemo(() => [...quotaPeriods].reverse(), [quotaPeriods]);

  const uniquePeriods = useMemo(() => {
    const seen = new Set<string>();
    return quotaPeriods.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [quotaPeriods]);

  const quartersByYear = useMemo(() => {
    const grouped: Record<string, typeof uniquePeriods> = {};
    for (const p of uniquePeriods) {
      const year =
        p.fiscal_year && p.fiscal_year !== "0" && p.fiscal_year !== ""
          ? p.fiscal_year
          : p.name?.match(/FY(\d{4})/)?.[1] ??
            p.name?.match(/(\d{4})/)?.[1] ??
            "Unknown";
      if (!grouped[year]) grouped[year] = [];
      grouped[year].push(p);
    }
    for (const year of Object.keys(grouped)) {
      grouped[year].sort((a, b) => quarterSortKey(a.name) - quarterSortKey(b.name));
    }
    return grouped;
  }, [uniquePeriods]);

  const sortedYearKeys = useMemo(() => {
    return Object.keys(quartersByYear).sort((a, b) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      const na = parseInt(a.replace(/\D/g, ""), 10);
      const nb = parseInt(b.replace(/\D/g, ""), 10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na;
      return b.localeCompare(a);
    });
  }, [quartersByYear]);

  const periodIdForFetch = useMemo(() => {
    const ids = Array.from(periodSelection.ids);
    if (ids.length === 0) return "";
    if (ids.length === 1) return ids[0];
    // TODO: merge multi-period rows / QoQ side-by-side; for now fetch only the most recently toggled period.
    if (periodSelection.ids.has(periodSelection.lastId)) return periodSelection.lastId;
    return ids[0];
  }, [periodSelection]);

  const previewRef = useRef<HTMLDivElement>(null);

  async function downloadPreviewPng() {
    if (!previewRef.current) return;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(previewRef.current, {
      backgroundColor: "#1a1a2e",
      scale: 2,
      useCORS: true,
    });
    const link = document.createElement("a");
    link.download = "report.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  useEffect(() => {
    setRepRowsLocal(props.repRows || []);
  }, [props.repRows]);

  useEffect(() => {
    setPeriodLabelDisplay(props.periodLabel);
  }, [props.periodLabel]);

  useEffect(() => {
    const pid = props.initialSelectedPeriodId ?? "";
    if (pid) {
      dispatchPeriodSelection({ type: "syncFromServer", initialId: pid });
    }
  }, [props.initialSelectedPeriodId]);

  useEffect(() => {
    if (!orgIdForFetch || periodSelection.ids.size === 0) {
      setAllPeriodResults([]);
      return;
    }
    const ids = Array.from(periodSelection.ids);
    let cancelled = false;

    async function fetchAllPeriods() {
      try {
        const results = await Promise.all(
          ids.map(async (periodId) => {
            if (periodId === initialPeriodId && props.repRows?.length) {
              return {
                periodId,
                rows: props.repRows,
                label: quotaPeriods.find((p) => p.id === periodId)?.name ?? periodId,
              };
            }
            const res = await fetch("/api/report-builder/data", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ periodId, orgId: orgIdForFetch }),
            });
            const j = await res.json().catch(() => ({}));
            return {
              periodId,
              rows: Array.isArray(j?.repRows) ? (j.repRows as RepRow[]) : [],
              label: quotaPeriods.find((p) => p.id === periodId)?.name ?? periodId,
            };
          })
        );

        if (cancelled || results.length === 0) return;

        setAllPeriodResults(results);
        setRepRowsLocal(results[results.length - 1].rows);
        setPeriodLabelDisplay(results.map((r) => r.label).join(" vs "));
      } catch {
        /* ignore */
      }
    }

    void fetchAllPeriods();
    return () => {
      cancelled = true;
    };
  }, [periodSelection.ids, initialPeriodId, orgIdForFetch, props.repRows, quotaPeriods]);

  const reps = repRowsLocal;
  const repDirectory = props.repDirectory || [];
  const saved = props.savedReports || [];

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricKey>>(
    () => new Set(["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"])
  );

  const [reportId, setReportId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [savedPickId, setSavedPickId] = useState<string>("");
  const [showReportMeta, setShowReportMeta] = useState<boolean>(false);
  const autoLoadedSavedReportRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [chartType, setChartType] = useState<ChartType>("table");

  const execHeaderName = useMemo(() => {
    const exec = repDirectory.find(
      (r) => isExecManagerLevel(directoryRowLevel(r)) || isChannelExecLevel(directoryRowLevel(r))
    );
    if (exec) {
      const nm = String(exec.name || "").trim();
      return nm || `Executive ${exec.id}`;
    }
    return periodLabelDisplay;
  }, [repDirectory, periodLabelDisplay]);

  const activePeriods = useMemo(
    () => periodsNewestFirst.filter((period) => periodSelection.ids.has(period.id)),
    [periodsNewestFirst, periodSelection.ids]
  );

  const reportPeriodLabel = useMemo(() => {
    if (activePeriods.length === 0) return "";
    if (activePeriods.length === 1) return activePeriods[0].name;
    if (activePeriods.length === 2) return `${activePeriods[0].name} vs ${activePeriods[1].name}`;
    return `${activePeriods.length} Quarters`;
  }, [activePeriods]);

  const reportHeaderLabel = useMemo(() => {
    const reportTitle = name.trim();
    if (reportTitle && reportPeriodLabel) return `${reportTitle} - ${reportPeriodLabel}`;
    if (reportTitle) return reportTitle;
    return reportPeriodLabel;
  }, [name, reportPeriodLabel]);

  const buildPreviewRows = (baseRows: RepRow[]) => {
    const byId = new Map<string, RepRow>();
    for (const r of baseRows) byId.set(String(r.rep_id), r);
    const out: RepRow[] = [];
    for (const d of repDirectory) {
      const sid = String(d.id);
      if (!selectedIds.has(sid)) continue;
      if (isRepRow(d)) {
        const row = byId.get(sid);
        if (row) out.push(row);
        continue;
      }
      if (isLeaderRow(d)) {
        const directDirReps = repDirectory.filter((r) => isRepRow(r) && r.manager_rep_id === d.id);
        const metricRows = directDirReps.map((r) => byId.get(String(r.id))).filter(Boolean) as RepRow[];
        const displayName = String(d.name || "").trim() || `Rep ${d.id}`;
        out.push({
          ...rollupRepRows({
            label: `${displayName}'s Team`,
            execName: execHeaderName,
            managerName: displayName,
            rows: metricRows,
          }),
          rep_id: `mgr:${d.id}`,
        });
      }
    }
    return out;
  };

  const previewRows = useMemo(() => buildPreviewRows(reps), [repDirectory, selectedIds, reps, execHeaderName]);

  const qvqPeriodResults = useMemo(
    () =>
      allPeriodResults.map((pr) => ({
        periodId: pr.periodId,
        label: pr.label,
        rows: buildPreviewRows(pr.rows),
      })),
    [allPeriodResults, repDirectory, selectedIds, execHeaderName]
  );

  const showQvqComparison = allPeriodResults.length > 1;

  const allRepNames = useMemo(
    () =>
      Array.from(new Set(qvqPeriodResults.flatMap((r) => r.rows.map((row) => row.rep_name)))).filter(
        (name): name is string => Boolean(name)
      ),
    [qvqPeriodResults]
  );

  const mergedRows = useMemo(
    () =>
      allRepNames.map((name) => ({
        rep_name: name,
        byPeriod: qvqPeriodResults.map((pr) => ({
          label: pr.label,
          row: pr.rows.find((r) => r.rep_name === name) ?? null,
        })),
      })),
    [allRepNames, qvqPeriodResults]
  );

  const teamTotalRow = useMemo(() => {
    if (!previewRows.length) return null;
    return rollupRepRows({
      label: "Team Total",
      execName: execHeaderName,
      managerName: "",
      rows: previewRows,
    });
  }, [previewRows, execHeaderName]);

  const qvqTeamTotalRow = useMemo(() => {
    if (!showQvqComparison) return null;
    return {
      rep_name: "Team Total",
      byPeriod: qvqPeriodResults.map((pr) => ({
        label: pr.label,
        row: pr.rows.length
          ? rollupRepRows({
              label: "Team Total",
              execName: execHeaderName,
              managerName: "",
              rows: pr.rows,
            })
          : null,
      })),
    };
  }, [showQvqComparison, qvqPeriodResults, execHeaderName]);

  const pickerGroups = useMemo(() => {
    const managers = repDirectory.filter((r) => isLeaderRow(r));
    const dirReps = repDirectory.filter((r) => isRepRow(r));
    const groups = managers.map((mgr) => ({
      manager: mgr,
      reps: dirReps.filter((r) => r.manager_rep_id === mgr.id),
    }));
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
    () => Array.from(selectedMetrics.values()).sort((a, b) => (labelForMetric?.get(a) || String(a)).localeCompare(labelForMetric?.get(b) || String(b))),
    [selectedMetrics, labelForMetric]
  );

  const selectedFields = useMemo(
    () => metricList.map((k) => ({ key: k, label: labelForMetric?.get(k) || String(k) })),
    [metricList, labelForMetric]
  );
  const chartPreviewRows = previewRows;

  const chartData = useMemo(() => {
    if (showQvqComparison) {
      return allRepNames.map((name) => {
        const point: Record<string, any> = { rep: name };
        qvqPeriodResults.forEach((pr) => {
          const row = pr.rows.find((r) => r.rep_name === name);
          selectedFields.forEach((f) => {
            point[`${pr.label} - ${f.label}`] = row ? Number((row as any)[f.key] ?? 0) : 0;
          });
        });
        return point;
      });
    }
    return chartPreviewRows.map((row) => ({
      rep: row.rep_name,
      ...selectedFields.reduce(
        (acc, f) => ({
          ...acc,
          [f.label]: (row as any)[f.key] != null ? Number((row as any)[f.key]) : 0,
        }),
        {} as Record<string, number>
      ),
    }));
  }, [showQvqComparison, allRepNames, qvqPeriodResults, chartPreviewRows, selectedFields]);

  const radarData = useMemo(() => {
    if (showQvqComparison) {
      return selectedFields.map((f) => {
        const point: Record<string, any> = { metric: f.label };
        qvqPeriodResults.forEach((pr) => {
          const vals = pr.rows
            .map((r) => Number((r as any)[f.key] ?? 0))
            .filter((v) => Number.isFinite(v));
          point[pr.label] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        });
        return point;
      });
    }
    return selectedFields.map((f) => {
      const point: Record<string, any> = { metric: f.label };
      chartPreviewRows.forEach((row) => {
        const raw = (row as any)[f.key];
        point[row.rep_name] = raw != null ? Number(raw) : 0;
      });
      return point;
    });
  }, [showQvqComparison, selectedFields, qvqPeriodResults, chartPreviewRows]);

  const barLineSeries = useMemo(
    () =>
      showQvqComparison
        ? qvqPeriodResults.flatMap((pr, pi) =>
            selectedFields.map((f, fi) => ({
              key: `${pr.periodId}-${f.key}`,
              dataKey: `${pr.label} - ${f.label}`,
              name: `${pr.label} - ${f.label}`,
              color: CHART_COLORS[(pi * selectedFields.length + fi) % CHART_COLORS.length],
            }))
          )
        : selectedFields.map((f, i) => ({
            key: f.key,
            dataKey: f.label,
            name: f.label,
            color: CHART_COLORS[i % CHART_COLORS.length],
          })),
    [showQvqComparison, qvqPeriodResults, selectedFields]
  );

  const radarSeries = useMemo(
    () =>
      showQvqComparison
        ? qvqPeriodResults.map((pr, i) => ({
            key: pr.periodId,
            dataKey: pr.label,
            name: pr.label,
            color: CHART_COLORS[i % CHART_COLORS.length],
          }))
        : chartPreviewRows.map((row, i) => ({
            key: row.rep_id || row.rep_name,
            dataKey: row.rep_name,
            name: row.rep_name,
            color: CHART_COLORS[i % CHART_COLORS.length],
          })),
    [showQvqComparison, qvqPeriodResults, chartPreviewRows]
  );

  const chartHasFields = selectedFields.length > 0;
  const chartHasReps = showQvqComparison ? allRepNames.length > 0 : chartPreviewRows.length > 0;
  const showChartPlaceholder = chartType !== "table" && (!chartHasFields || !chartHasReps);
  const showBarLineChart =
    (chartType === "bar" || chartType === "line") && chartHasFields && chartHasReps;
  const showRadarChart = chartType === "radar" && chartHasFields && chartHasReps;

  function renderQvqDelta(
    metricKey: MetricKey,
    metricLabel: string,
    periodRows: Array<{ label: string; row: RepRow | null }>
  ) {
    if (periodRows.length !== 2) return null;
    const v0 = Number(periodRows[0].row?.[metricKey as keyof RepRow] ?? 0);
    const v1 = Number(periodRows[1].row?.[metricKey as keyof RepRow] ?? 0);
    const diff = v1 - v0;
    const isMonetary = metricLabel.includes("$");
    const color = diff >= 0 ? "text-green-400" : "text-red-400";
    const prefix = diff >= 0 ? "+" : "";
    const formatted = isMonetary ? fmtMoney(Math.abs(diff)) : `${Math.abs(Math.round(diff * 100) / 100)}`;
    return (
      <span className={color}>
        {prefix}
        {diff < 0 ? "-" : ""}
        {formatted}
      </span>
    );
  }

  function toggleId(id: string) {
    setSelectedIds((prev) => {
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

  function clearMetricGroup(keys: MetricKey[]) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      keys.forEach((key) => next.delete(key));
      return next;
    });
  }

  function togglePeriod(periodId: string) {
    dispatchPeriodSelection({ type: "toggle", id: periodId });
  }

  function clearSelection() {
    setSelectedIds(new Set());
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
          selectedPeriodIds: Array.from(periodSelection.ids),
          repIds: Array.from(selectedIds.values()),
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
    setSelectedIds(new Set(cfg.repIds));
    setSelectedMetrics(new Set(effectiveMetrics));
    if (Array.isArray(cfg.selectedPeriodIds) && cfg.selectedPeriodIds.length > 0) {
      dispatchPeriodSelection({ type: "replace", ids: cfg.selectedPeriodIds });
    }
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
    const rows: Record<string, any>[] = previewRows.map((r) => {
      const out: Record<string, any> = {
        rep: r.rep_name,
        team: teamStr,
      };
      for (const k of metricList) {
        out[labelForMetric?.get(k) || k] = renderMetricValue(k, r);
      }
      return out;
    });
    if (teamTotalRow && previewRows.length > 0) {
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
  }, [metricList, previewRows, execHeaderName, teamTotalRow, labelForMetric]);

  const allDirectoryIds = useMemo(() => repDirectory.map((r) => String(r.id)), [repDirectory]);

  function quickSelectAll() {
    setSelectedIds(new Set(allDirectoryIds));
  }

  function quickSelectClear() {
    setSelectedIds(new Set());
  }

  function quickSelectRepsOnly() {
    setSelectedIds(new Set(repDirectory.filter((r) => isRepRow(r)).map((r) => String(r.id))));
  }

  function quickSelectLeadersOnly() {
    setSelectedIds(
      new Set(repDirectory.filter((r) => isLeaderRow(r)).map((r) => String(r.id)))
    );
  }

  useEffect(() => {
    if (autoLoadedSavedReportRef.current || saved.length === 0) return;
    autoLoadedSavedReportRef.current = true;
    loadReport(saved[0]);
    setControlsOpen(false);
  }, [saved]);

  const outlineQuickBtn =
    "rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)]";

  const chartToggleActive =
    "rounded-full border px-4 py-2 text-sm font-semibold border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] text-white";
  const chartToggleInactive =
    "rounded-full border px-4 py-2 text-sm font-semibold border-[color:var(--sf-border)] text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]";

  return (
    <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Designer</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Period: {periodLabelDisplay}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowReportMeta((v) => !v)}
            className="h-[40px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
          >
            Title/Description
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
          <button
            type="button"
            disabled={!savedPickId}
            onClick={() => void deleteReport(String(savedPickId))}
            className="rounded-md bg-[#E74C3C]/80 px-3 py-2 text-sm font-medium text-white hover:bg-[#C0392B]/85 disabled:opacity-50"
          >
            Delete Report
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={savedPickId}
          onChange={(e) => {
            const id = String(e.target.value || "");
            setSavedPickId(id);
            if (!id) startNewSavedReport();
          }}
          className="rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] min-w-[220px]"
        >
          <option value="">Select saved report...</option>
          {saved.map((r) => (
            <option key={r.id} value={String(r.id)}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!savedPickId}
          onClick={() => {
            const r = saved.find((x) => String(x.id) === String(savedPickId)) || null;
            if (r) loadReport(r);
          }}
          className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Load & Run
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {(["table", "bar", "line", "radar"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setChartType(type);
                setControlsOpen(false);
              }}
              className={chartType === type ? chartToggleActive : chartToggleInactive}
            >
              {type === "table" ? "Table" : type === "bar" ? "Bar" : type === "line" ? "Line" : "Radar"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setControlsOpen((v) => !v)}
          className="rounded-md border border-[color:var(--sf-border)] px-4 py-2 text-sm text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]"
        >
          {controlsOpen ? "Hide Config" : "Configure"}
        </button>
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

      {controlsOpen ? (
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 mb-4 space-y-5">
          <div>
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)] mb-2">Quarter</div>
            <div className="flex flex-wrap gap-6">
              {sortedYearKeys.length === 0 ? (
                <p className="text-xs text-[color:var(--sf-text-secondary)]">No quota periods available.</p>
              ) : null}
              {sortedYearKeys.map((year) => (
                <div key={year} className="min-w-[140px]">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)] mb-2">
                    {year}
                  </div>
                  <div className="space-y-1">
                    {(quartersByYear[year] ?? []).map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={periodSelection.ids.has(p.id)} onChange={() => togglePeriod(p.id)} />
                        <span className="text-sm text-[color:var(--sf-text-primary)]">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">Initial health (at deal open) coming soon</p>
          </div>

      <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
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
          <button type="button" onClick={quickSelectAll} className={outlineQuickBtn}>
            All
          </button>
          <button type="button" onClick={quickSelectClear} className={outlineQuickBtn}>
            Clear
          </button>
          <button type="button" onClick={quickSelectRepsOnly} className={outlineQuickBtn}>
            Reps Only
          </button>
          <button type="button" onClick={quickSelectLeadersOnly} className={outlineQuickBtn}>
            Leaders Only
          </button>
        </div>
        <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
          {pickerGroups.groups.map((group) => {
            const mgr = group.manager;
            const mid = String(mgr.id);
            return (
              <div key={`mgr-grp:${mgr.id}`} className="mt-3 first:mt-0">
                <label className="flex items-center gap-2 cursor-pointer py-0.5 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                  <input type="checkbox" checked={selectedIds.has(mid)} onChange={() => toggleId(mid)} />
                  <span>{mgr.name}</span>
                </label>
                {group.reps.map((rep) => (
                  <label key={rep.id} className="ml-6 flex items-center gap-2 cursor-pointer py-0.5">
                    <input type="checkbox" checked={selectedIds.has(String(rep.id))} onChange={() => toggleId(String(rep.id))} />
                    <span className="text-sm text-[color:var(--sf-text-primary)]">{rep.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {pickerGroups.unassigned.length ? (
            <div className={pickerGroups.groups.length ? "mt-3 border-t border-[color:var(--sf-border)] pt-3" : ""}>
              {pickerGroups.unassigned.map((rep) => (
                <label key={rep.id} className="ml-6 flex items-center gap-2 cursor-pointer py-0.5">
                  <input type="checkbox" checked={selectedIds.has(String(rep.id))} onChange={() => toggleId(String(rep.id))} />
                  <span className="text-sm text-[color:var(--sf-text-primary)]">{rep.name}</span>
                </label>
              ))}
            </div>
          ) : null}
          {!repDirectory.length ? (
            <div className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No reps found.</div>
          ) : null}
        </div>
        <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
          Select sales leaders (team rollup) or individual reps. Export follows your selection.
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Report fields</div>
          <button
            type="button"
            onClick={() => clearMetricGroup(METRICS.map((m) => m.key))}
            className={outlineQuickBtn}
          >
            Clear
          </button>
        </div>
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

      <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC+TB Health</div>
          <button
            type="button"
            onClick={() => clearMetricGroup(MEDDPICC_HEALTH_METRICS.map((m) => m.key))}
            className={outlineQuickBtn}
          >
            Clear
          </button>
        </div>
        <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
          <span className="font-mono">L</span> = Low, <span className="font-mono">M</span> = Medium, and <span className="font-mono">H</span> = Highly Qualified
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
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
          {reportHeaderLabel || periodLabelDisplay}
        </div>
        <button
          type="button"
          onClick={() => void downloadPreviewPng()}
          className="rounded-md border border-[color:var(--sf-border)] px-3 py-1 text-xs text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]"
        >
          Download PNG
        </button>
      </div>

      <div ref={previewRef}>
        {showChartPlaceholder ? (
          <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-8 text-center text-sm text-[color:var(--sf-text-secondary)]">
            {!chartHasFields
              ? "Select report fields above to visualize data."
              : "Select people or teams above to visualize data."}
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
              {barLineSeries.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.dataKey}
                  fill={series.color}
                  radius={[4, 4, 0, 0]}
                  name={series.name}
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
              {barLineSeries.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.dataKey}
                  stroke={series.color}
                  dot={{ fill: series.color }}
                  name={series.name}
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
              {radarSeries.map((series) => (
                <Radar
                  key={series.key}
                  name={series.name}
                  dataKey={series.dataKey}
                  stroke={series.color}
                  fill={series.color}
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
        {showQvqComparison ? (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
              <tr>
                <th className="px-4 py-3">Rep</th>
                {selectedFields.flatMap((f) =>
                  qvqPeriodResults.map((pr, pi) => (
                    <th key={`${f.key}-${pi}`} className="px-4 py-3 text-right">
                      {pr.label} {f.label}
                    </th>
                  ))
                )}
                {qvqPeriodResults.length === 2
                  ? selectedFields.map((f) => (
                      <th key={`delta-${f.key}`} className="px-4 py-3 text-right">
                        Î” {f.label}
                      </th>
                    ))
                  : null}
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((row) => (
                <tr key={row.rep_name} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{row.rep_name}</td>
                  {selectedFields.flatMap((f) =>
                    row.byPeriod.map((pd, pi) => (
                      <td key={`${row.rep_name}-${f.key}-${pi}`} className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">
                        {renderMetricValue(f.key, pd.row ?? ({} as RepRow))}
                      </td>
                    ))
                  )}
                  {qvqPeriodResults.length === 2
                    ? selectedFields.map((f) => (
                        <td key={`${row.rep_name}-delta-${f.key}`} className="px-4 py-3 text-right font-mono text-xs">
                          {renderQvqDelta(f.key, f.label, row.byPeriod)}
                        </td>
                      ))
                    : null}
                </tr>
              ))}
              {qvqTeamTotalRow ? (
                <tr className="border-t-2 border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                  <td className="px-4 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">{qvqTeamTotalRow.rep_name}</td>
                  {selectedFields.flatMap((f) =>
                    qvqTeamTotalRow.byPeriod.map((pd, pi) => (
                      <td key={`team-total-${f.key}-${pi}`} className="px-4 py-2 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                        {renderMetricValue(f.key, pd.row ?? ({} as RepRow))}
                      </td>
                    ))
                  )}
                  {qvqPeriodResults.length === 2
                    ? selectedFields.map((f) => (
                        <td key={`team-total-delta-${f.key}`} className="px-4 py-2 text-right font-mono text-xs font-semibold">
                          {renderQvqDelta(f.key, f.label, qvqTeamTotalRow.byPeriod)}
                        </td>
                      ))
                    : null}
                </tr>
              ) : null}
              {!mergedRows.length ? (
                <tr>
                  <td
                    colSpan={1 + selectedFields.length * qvqPeriodResults.length + (qvqPeriodResults.length === 2 ? selectedFields.length : 0)}
                    className="px-4 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]"
                  >
                    Nothing selected.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
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
              {previewRows.map((r) => (
                <tr key={`row:${r.rep_id || r.rep_name}`} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{r.rep_name}</td>
                  {metricList.map((k) => (
                    <td key={k} className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">
                      {renderMetricCell(k, r)}
                    </td>
                  ))}
                </tr>
              ))}
              {teamTotalRow && previewRows.length > 0 ? (
                <tr className="border-t-2 border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                  <td className="px-4 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">{teamTotalRow.rep_name}</td>
                  {metricList.map((k) => (
                    <td key={k} className="px-4 py-2 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                      {renderMetricCell(k, teamTotalRow)}
                    </td>
                  ))}
                </tr>
              ) : null}
              {!previewRows.length ? (
                <tr>
                  <td colSpan={1 + metricList.length} className="px-4 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">
                    Nothing selected.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end">
        <ExportToExcelButton fileName={`Custom Report - ${periodLabelDisplay}`} sheets={[{ name: "Report", rows: exportRows }]} />
      </div>
    </section>
  );
}

