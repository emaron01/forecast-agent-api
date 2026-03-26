"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

export type RevenueIntelligenceProps = {
  orgId: number;
  quotaPeriods: { id: string; name: string }[];
  repDirectory: Array<{
    id: number;
    name: string;
    role: string;
    manager_rep_id: number | null;
  }>;
};

type BucketRow = { id: string; label: string; min: number; max: number | null };
type ReportType = "deal_volume" | "meddpicc_health" | "product_mix";

const CHART_COLORS = [
  "#00BCD4",
  "#2ECC71",
  "#F1C40F",
  "#E74C3C",
  "#9B59B6",
  "#FF9800",
  "#00BFA5",
  "#FF5722",
];

const WON_SHADES = ["#16A34A", "#2ECC71", "#22C55E", "#4ADE80"];
const LOST_SHADES = ["#DC2626", "#E74C3C", "#F87171", "#FB923C"];
const PIPE_SHADES = ["#2563EB", "#3B82F6", "#00BCD4", "#60A5FA"];

const outlineQuickBtn =
  "rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)]";

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function fmtMoney(n: number | null | undefined) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct01(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtHealthPct(score: number | null | undefined) {
  if (score == null || !Number.isFinite(Number(score))) return "—";
  const pct = Math.round((Number(score) / 30) * 100);
  return `${Math.max(0, Math.min(100, pct))}%`;
}

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function escapeCsvCell(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadSvgAsPng(svgEl: SVGElement, filename: string) {
  const clone = svgEl.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const xml = new XMLSerializer().serializeToString(clone);
  const svg64 = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  const img = new Image();
  const w = Number(svgEl.getAttribute("width")) || svgEl.getBoundingClientRect().width || 800;
  const h = Number(svgEl.getAttribute("height")) || svgEl.getBoundingClientRect().height || 320;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = svg64;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(w * 2));
  canvas.height = Math.max(1, Math.floor(h * 2));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

type AggRow = {
  bucket_id: string;
  quarter_id: string;
  quarter_name: string;
  won_count: number;
  lost_count: number;
  pipeline_count: number;
  won_amount: number;
  lost_amount: number;
  pipeline_amount: number;
  win_rate: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_pipeline: number | null;
  avg_health_won: number | null;
  avg_health_lost: number | null;
  avg_health_pipeline: number | null;
  avg_pain: number | null;
  avg_metrics: number | null;
  avg_champion: number | null;
  avg_eb: number | null;
  avg_criteria: number | null;
  avg_process: number | null;
  avg_competition: number | null;
  avg_paper: number | null;
  avg_timing: number | null;
  avg_budget: number | null;
  products: Record<string, number>;
};

type RepSelectionState = { managers: Set<string>; reps: Set<string> };

type RepDir = RevenueIntelligenceProps["repDirectory"][number];

type RepSelectionAction =
  | { type: "toggleManager"; managerId: string; repIds: string[] }
  | { type: "toggleRep"; repId: string }
  | { type: "quickAll"; repDirectory: RepDir[] }
  | { type: "quickClear" }
  | { type: "quickRepsOnly"; repDirectory: RepDir[] }
  | { type: "quickLeadersOnly"; repDirectory: RepDir[] }
  | { type: "replace"; managers: string[]; reps: string[] };

function repSelectionReducer(state: RepSelectionState, action: RepSelectionAction): RepSelectionState {
  switch (action.type) {
    case "toggleManager": {
      const { managerId, repIds } = action;
      const nextM = new Set(state.managers);
      const nextR = new Set(state.reps);
      const allOn =
        nextM.has(managerId) && repIds.length > 0 && repIds.every((id) => nextR.has(id));
      if (allOn) {
        nextM.delete(managerId);
        repIds.forEach((id) => nextR.delete(id));
      } else {
        nextM.add(managerId);
        repIds.forEach((id) => nextR.add(id));
      }
      return { managers: nextM, reps: nextR };
    }
    case "toggleRep": {
      const nextR = new Set(state.reps);
      if (nextR.has(action.repId)) nextR.delete(action.repId);
      else nextR.add(action.repId);
      return { managers: new Set(state.managers), reps: nextR };
    }
    case "quickAll":
      return {
        managers: new Set(
          action.repDirectory.filter((r) => r.role === "MANAGER" || r.role === "EXEC_MANAGER").map((r) => String(r.id))
        ),
        reps: new Set(action.repDirectory.filter((r) => r.role === "REP").map((r) => String(r.id))),
      };
    case "quickClear":
      return { managers: new Set(), reps: new Set() };
    case "quickRepsOnly":
      return {
        managers: new Set(),
        reps: new Set(action.repDirectory.filter((r) => r.role === "REP").map((r) => String(r.id))),
      };
    case "quickLeadersOnly":
      return {
        managers: new Set(
          action.repDirectory.filter((r) => r.role === "MANAGER" || r.role === "EXEC_MANAGER").map((r) => String(r.id))
        ),
        reps: new Set(),
      };
    case "replace":
      return { managers: new Set(action.managers), reps: new Set(action.reps) };
    default:
      return state;
  }
}

function managerGroupState(
  managerId: string,
  repIds: string[],
  managers: Set<string>,
  reps: Set<string>
): "none" | "partial" | "all" {
  if (repIds.length === 0) return managers.has(managerId) ? "all" : "none";
  const n = repIds.filter((id) => reps.has(id)).length;
  const m = managers.has(managerId);
  if (n === 0 && !m) return "none";
  if (n === repIds.length && m) return "all";
  return "partial";
}

const MEDDPICC_SPOKES: Array<{ key: keyof AggRow; label: string }> = [
  { key: "avg_pain", label: "Pain" },
  { key: "avg_metrics", label: "Metrics" },
  { key: "avg_champion", label: "Champion" },
  { key: "avg_eb", label: "EB" },
  { key: "avg_criteria", label: "Criteria" },
  { key: "avg_process", label: "Process" },
  { key: "avg_competition", label: "Competition" },
  { key: "avg_paper", label: "Paper" },
  { key: "avg_timing", label: "Timing" },
  { key: "avg_budget", label: "Budget" },
];

function healthPctNum(score: number | null | undefined): number {
  if (score == null || !Number.isFinite(Number(score))) return 0;
  return Math.max(0, Math.min(100, (Number(score) / 30) * 100));
}

export function RevenueIntelligenceClient(props: RevenueIntelligenceProps) {
  const { orgId, quotaPeriods, repDirectory } = props;

  const [buckets, setBuckets] = useState<BucketRow[]>([
    { id: newId(), label: "SMB", min: 0, max: 50000 },
    { id: newId(), label: "Mid-Market", min: 50000, max: 250000 },
    { id: newId(), label: "Enterprise", min: 250000, max: null },
  ]);
  const [bucketSetName, setBucketSetName] = useState("");
  const [savedBucketSets, setSavedBucketSets] = useState<any[]>([]);
  const [loadBucketSetId, setLoadBucketSetId] = useState("");

  /** Newest first; labels are full `name` from quotaPeriods (org quota_periods). */
  const periodsNewestFirst = useMemo(() => [...quotaPeriods].reverse(), [quotaPeriods]);

  const [selectedQuarterIds, setSelectedQuarterIds] = useState<Set<string>>(() => new Set());

  const [repSelection, dispatchRep] = useReducer(repSelectionReducer, { managers: new Set<string>(), reps: new Set<string>() });
  const selectedManagerIds = repSelection.managers;
  const selectedRepIds = repSelection.reps;

  const [reportType, setReportType] = useState<ReportType>("deal_volume");

  const [reportData, setReportData] = useState<{
    quarters: { id: string; name: string }[];
    buckets: BucketRow[];
    rows: AggRow[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [reportName, setReportName] = useState("");
  const [loadReportId, setLoadReportId] = useState("");
  const [bucketSetIdRef, setBucketSetIdRef] = useState<string | null>(null);

  /** MEDDPICC radar: which quarter polygon (radio when multiple). */
  const [meddpiccQuarterId, setMeddpiccQuarterId] = useState<string>("");

  const [controlsOpen, setControlsOpen] = useState(true);

  const panel1Ref = useRef<HTMLDivElement>(null);
  const panel2Ref = useRef<HTMLDivElement>(null);
  const panel3Ref = useRef<HTMLDivElement>(null);
  const panelMeddpiccRef = useRef<HTMLDivElement>(null);
  const panelProductRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [rb, ri] = await Promise.all([fetch("/api/revenue-buckets"), fetch("/api/revenue-intelligence")]);
        const jb = await rb.json().catch(() => ({}));
        const ji = await ri.json().catch(() => ({}));
        if (jb?.ok && Array.isArray(jb.bucketSets)) setSavedBucketSets(jb.bucketSets);
        if (ji?.ok && Array.isArray(ji.reports)) setSavedReports(ji.reports);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const managerGroups = useMemo(() => {
    const managers = repDirectory.filter((r) => r.role === "MANAGER" || r.role === "EXEC_MANAGER");
    const dirReps = repDirectory.filter((r) => r.role === "REP");
    const groups = managers.map((mgr) => ({
      manager: mgr,
      reps: dirReps.filter((r) => r.manager_rep_id === mgr.id),
    }));
    const managedRepIds = new Set(groups.flatMap((g) => g.reps.map((r) => r.id)));
    const unassigned = dirReps.filter((r) => !managedRepIds.has(r.id));
    return { groups, unassigned };
  }, [repDirectory]);

  function toggleManagerReps(managerId: string, repIds: string[]) {
    dispatchRep({ type: "toggleManager", managerId, repIds });
  }

  function toggleRepId(repId: string) {
    dispatchRep({ type: "toggleRep", repId });
  }

  const quickSelectAll = () => dispatchRep({ type: "quickAll", repDirectory });
  const quickSelectClear = () => dispatchRep({ type: "quickClear" });
  const quickSelectRepsOnly = () => dispatchRep({ type: "quickRepsOnly", repDirectory });
  const quickSelectLeadersOnly = () => dispatchRep({ type: "quickLeadersOnly", repDirectory });

  const resolveRepIdsForApi = useCallback((): string[] | null => {
    const out = new Set<number>();
    for (const id of selectedRepIds) {
      const r = repDirectory.find((x) => String(x.id) === id);
      if (r?.role === "REP") out.add(r.id);
    }
    for (const mid of selectedManagerIds) {
      const m = repDirectory.find((x) => String(x.id) === mid);
      if (!m) continue;
      for (const r of repDirectory) {
        if (r.role === "REP" && r.manager_rep_id === m.id) out.add(r.id);
      }
    }
    if (out.size === 0) return null;
    return Array.from(out).map(String);
  }, [repDirectory, selectedRepIds, selectedManagerIds]);

  /** Display order by min $; does not reorder stored `buckets` array. */
  const sortedBuckets = useMemo(() => [...buckets].sort((a, b) => Number(a.min) - Number(b.min)), [buckets]);

  const addBucket = () => {
    setBuckets((prev) => [...prev, { id: newId(), label: "New", min: 0, max: null }]);
  };

  const removeBucket = (id: string) => {
    setBuckets((prev) => prev.filter((b) => b.id !== id));
  };

  const updateBucket = (id: string, patch: Partial<BucketRow>) => {
    setBuckets((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  /** Selected quarters in UI order (newest first), full `name` from quotaPeriods. */
  const selectedQuartersOrdered = useMemo(() => {
    const sel = selectedQuarterIds;
    return periodsNewestFirst.filter((p) => sel.has(p.id));
  }, [selectedQuarterIds, periodsNewestFirst]);

  useEffect(() => {
    if (reportType === "meddpicc_health" && reportData?.quarters?.length) {
      const ids = reportData.quarters.map((q) => q.id);
      if (!meddpiccQuarterId || !ids.includes(meddpiccQuarterId)) {
        setMeddpiccQuarterId(ids[0]!);
      }
    }
  }, [reportType, reportData, meddpiccQuarterId]);

  const allProductNames = useMemo(() => {
    if (!reportData?.rows?.length) return [];
    const s = new Set<string>();
    for (const r of reportData.rows) {
      for (const k of Object.keys(r.products || {})) {
        if (k) s.add(k);
      }
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [reportData]);

  /**
   * Panel 1 — Win/Loss Volume chartData: one row per bucket; keys `${quarter.name} Won|Lost|Pipeline`.
   * Quarters use full `name` from quotaPeriods (via selectedQuartersOrdered).
   */
  const panel1ChartData = useMemo(() => {
    if (!reportData?.rows?.length || !reportData.buckets.length) return [];
    const rows = reportData.rows;
    return reportData.buckets.map((b) => {
      const entries = selectedQuartersOrdered.flatMap((q) => {
        const row = rows.find((r) => r.bucket_id === b.id && r.quarter_id === q.id);
        return [
          [`${q.name} Won`, row?.won_count ?? 0],
          [`${q.name} Lost`, row?.lost_count ?? 0],
          [`${q.name} Pipeline`, row?.pipeline_count ?? 0],
        ] as [string, number][];
      });
      const fromPairs = entries.reduce<Record<string, number>>((acc, [k, v]) => ({ ...acc, [k]: v }), {});
      return { bucket: b.label, ...fromPairs };
    });
  }, [reportData, selectedQuartersOrdered]);

  const panel1SeriesKeys = useMemo(() => {
    const keys: string[] = [];
    for (const q of selectedQuartersOrdered) {
      keys.push(`${q.name} Won`, `${q.name} Lost`, `${q.name} Pipeline`);
    }
    return keys;
  }, [selectedQuartersOrdered]);

  const panel2ChartData = useMemo(() => {
    if (!reportData?.rows?.length || !reportData.buckets.length) return [];
    const rows = reportData.rows;
    return reportData.buckets.map((b) => {
      const entries = selectedQuartersOrdered.flatMap((q) => {
        const row = rows.find((r) => r.bucket_id === b.id && r.quarter_id === q.id);
        return [
          [`${q.name} Avg Days Won`, row?.avg_days_won ?? 0],
          [`${q.name} Avg Days Lost`, row?.avg_days_lost ?? 0],
        ] as [string, number][];
      });
      const fromPairs = entries.reduce<Record<string, number>>((acc, [k, v]) => ({ ...acc, [k]: v }), {});
      return { bucket: b.label, ...fromPairs };
    });
  }, [reportData, selectedQuartersOrdered]);

  const panel2SeriesKeys = useMemo(() => {
    const keys: string[] = [];
    for (const q of selectedQuartersOrdered) {
      keys.push(`${q.name} Avg Days Won`, `${q.name} Avg Days Lost`);
    }
    return keys;
  }, [selectedQuartersOrdered]);

  const panel3ChartData = useMemo(() => {
    if (!reportData?.rows?.length || !reportData.buckets.length) return [];
    const rows = reportData.rows;
    return reportData.buckets.map((b) => {
      const entries = selectedQuartersOrdered.flatMap((q) => {
        const row = rows.find((r) => r.bucket_id === b.id && r.quarter_id === q.id);
        return [
          [`${q.name} Health Won`, healthPctNum(row?.avg_health_won ?? null)],
          [`${q.name} Health Lost`, healthPctNum(row?.avg_health_lost ?? null)],
          [`${q.name} Health Pipeline`, healthPctNum(row?.avg_health_pipeline ?? null)],
        ] as [string, number][];
      });
      const fromPairs = entries.reduce<Record<string, number>>((acc, [k, v]) => ({ ...acc, [k]: v }), {});
      return { bucket: b.label, ...fromPairs };
    });
  }, [reportData, selectedQuartersOrdered]);

  const panel3SeriesKeys = useMemo(() => {
    const keys: string[] = [];
    for (const q of selectedQuartersOrdered) {
      keys.push(`${q.name} Health Won`, `${q.name} Health Lost`, `${q.name} Health Pipeline`);
    }
    return keys;
  }, [selectedQuartersOrdered]);

  const meddpiccRadarRows = useMemo(() => {
    if (!reportData?.rows?.length || !reportData.buckets.length || !meddpiccQuarterId) return [];
    const rows = reportData.rows;
    return MEDDPICC_SPOKES.map((spoke) => {
      const pt: Record<string, string | number> = { spoke: spoke.label };
      for (const b of reportData.buckets) {
        const cell = rows.find((r) => r.bucket_id === b.id && r.quarter_id === meddpiccQuarterId);
        const raw = cell ? (cell[spoke.key] as number | null | undefined) : null;
        pt[`bk_${b.id}`] = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : 0;
      }
      return pt;
    });
  }, [reportData, meddpiccQuarterId]);

  const productMixChartData = useMemo(() => {
    if (!reportData?.rows?.length || !reportData.buckets.length || !allProductNames.length) return [];
    const rows = reportData.rows;
    return reportData.buckets.map((b) => {
      const pt: Record<string, string | number> = { bucket: b.label };
      for (const prod of allProductNames) {
        let sum = 0;
        for (const q of selectedQuartersOrdered) {
          const cell = rows.find((r) => r.bucket_id === b.id && r.quarter_id === q.id);
          sum += cell?.products?.[prod] ? Number(cell.products[prod]) : 0;
        }
        pt[prod] = sum;
      }
      return pt;
    });
  }, [reportData, allProductNames, selectedQuartersOrdered]);

  const runReport = async () => {
    setError(null);
    if (!sortedBuckets.length) {
      setError("Add at least one revenue bucket.");
      return;
    }
    if (!selectedQuarterIds.size) {
      setError("Select at least one quarter.");
      return;
    }
    setLoading(true);
    try {
      const repIds = resolveRepIdsForApi();
      const res = await fetch("/api/revenue-intelligence/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buckets: sortedBuckets.map((b) => ({
            id: b.id,
            label: b.label,
            min: b.min,
            max: b.max,
          })),
          quarterIds: Array.from(selectedQuarterIds),
          repIds,
          reportType,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setError(String(j?.error || `Request failed (${res.status})`));
        setReportData(null);
        return;
      }
      setReportData({
        quarters: j.quarters || [],
        buckets: j.buckets || sortedBuckets,
        rows: j.rows || [],
      });
      setControlsOpen(false);
    } catch (e: any) {
      setError(String(e?.message || e));
      setReportData(null);
    } finally {
      setLoading(false);
    }
  };

  const saveBuckets = async () => {
    if (!bucketSetName.trim()) {
      setError("Enter a name to save bucket sets.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/revenue-buckets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bucketSetName.trim(),
          buckets: sortedBuckets.map((b) => ({ id: b.id, label: b.label, min: b.min, max: b.max })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
      setBucketSetIdRef(j?.bucketSet?.id ? String(j.bucketSet.id) : null);
      const list = await fetch("/api/revenue-buckets");
      const jl = await list.json().catch(() => ({}));
      if (jl?.ok && Array.isArray(jl.bucketSets)) setSavedBucketSets(jl.bucketSets);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const loadBucketSet = () => {
    const row = savedBucketSets.find((x) => String(x.id) === loadBucketSetId);
    if (!row?.buckets) return;
    const arr = Array.isArray(row.buckets) ? row.buckets : [];
    setBuckets(
      arr.map((b: any) => ({
        id: String(b.id || newId()),
        label: String(b.label || "Bucket"),
        min: Number(b.min) || 0,
        max: b.max == null ? null : Number(b.max),
      }))
    );
    setBucketSetIdRef(String(row.id));
  };

  const deleteBucketSet = async () => {
    if (!loadBucketSetId) return;
    if (!window.confirm("Delete this saved bucket set?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/revenue-buckets?id=${encodeURIComponent(loadBucketSetId)}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Delete failed");
      setLoadBucketSetId("");
      const list = await fetch("/api/revenue-buckets");
      const jl = await list.json().catch(() => ({}));
      if (jl?.ok && Array.isArray(jl.bucketSets)) setSavedBucketSets(jl.bucketSets);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const saveReportConfig = async () => {
    if (!reportName.trim()) {
      setError("Enter a name to save this report.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const config = {
        version: 2,
        buckets: sortedBuckets.map((b) => ({ id: b.id, label: b.label, min: b.min, max: b.max })),
        bucketSetId: bucketSetIdRef,
        selectedQuarterIds: Array.from(selectedQuarterIds),
        selectedRepIds: Array.from(selectedRepIds),
        selectedManagerIds: Array.from(selectedManagerIds),
        reportType,
        meddpiccQuarterId: meddpiccQuarterId || null,
      };
      const res = await fetch("/api/revenue-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: reportName.trim(), config }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
      const list = await fetch("/api/revenue-intelligence");
      const jl = await list.json().catch(() => ({}));
      if (jl?.ok && Array.isArray(jl.reports)) setSavedReports(jl.reports);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const loadSavedReport = () => {
    const r = savedReports.find((x) => String(x.id) === loadReportId);
    if (!r?.config) return;
    const c = r.config;
    if (Array.isArray(c.buckets)) {
      setBuckets(
        c.buckets.map((b: any) => ({
          id: String(b.id || newId()),
          label: String(b.label || "Bucket"),
          min: Number(b.min) || 0,
          max: b.max == null ? null : Number(b.max),
        }))
      );
    }
    if (c.bucketSetId != null) setBucketSetIdRef(String(c.bucketSetId));
    if (Array.isArray(c.selectedQuarterIds)) setSelectedQuarterIds(new Set(c.selectedQuarterIds.map(String)));
    if (Array.isArray(c.selectedRepIds) || Array.isArray(c.selectedManagerIds)) {
      dispatchRep({
        type: "replace",
        managers: Array.isArray(c.selectedManagerIds) ? c.selectedManagerIds.map(String) : [],
        reps: Array.isArray(c.selectedRepIds) ? c.selectedRepIds.map(String) : [],
      });
    }
    if (c.reportType === "deal_volume" || c.reportType === "meddpicc_health" || c.reportType === "product_mix") {
      setReportType(c.reportType);
    }
    if (typeof c.meddpiccQuarterId === "string") setMeddpiccQuarterId(c.meddpiccQuarterId);
    setReportName(String(r.name || ""));
  };

  const deleteSavedReport = async () => {
    if (!loadReportId) return;
    if (!window.confirm("Delete this saved report?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/revenue-intelligence?id=${encodeURIComponent(loadReportId)}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Delete failed");
      setLoadReportId("");
      const list = await fetch("/api/revenue-intelligence");
      const jl = await list.json().catch(() => ({}));
      if (jl?.ok && Array.isArray(jl.reports)) setSavedReports(jl.reports);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  async function downloadPanelPng(container: HTMLDivElement | null, filename: string) {
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;
    await downloadSvgAsPng(svg, filename);
  }

  const exportCsv = () => {
    if (!reportData) return;
    const lines: string[][] = [];
    const bOrder = reportData.buckets.length ? reportData.buckets : sortedBuckets;
    const rows = reportData.rows;

    if (reportType === "deal_volume") {
      lines.push(["=== Win / Loss by Revenue Segment ==="]);
      lines.push(["Bucket", ...selectedQuartersOrdered.flatMap((q) => [`${q.name} Won`, `${q.name} Lost`, `${q.name} Pipeline`, `${q.name} Win Rate`, `${q.name} Won $`, `${q.name} Lost $`])]);
      for (const b of bOrder) {
        const byQ = new Map<string, AggRow>();
        for (const r of rows) if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
        const cells: string[] = [b.label];
        for (const q of selectedQuartersOrdered) {
          const rr = byQ.get(q.id);
          if (!rr) {
            cells.push("", "", "", "", "", "");
            continue;
          }
          cells.push(
            String(rr.won_count),
            String(rr.lost_count),
            String(rr.pipeline_count),
            fmtPct01(rr.win_rate),
            String(rr.won_amount),
            String(rr.lost_amount)
          );
        }
        lines.push(cells);
      }
      lines.push([]);
      lines.push(["=== Avg Days to Close ==="]);
      lines.push(["Bucket", ...selectedQuartersOrdered.flatMap((q) => [`${q.name} Avg Days Won`, `${q.name} Avg Days Lost`, `${q.name} Avg Days Pipeline`])]);
      for (const b of bOrder) {
        const byQ = new Map<string, AggRow>();
        for (const r of rows) if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
        const cells: string[] = [b.label];
        for (const q of selectedQuartersOrdered) {
          const rr = byQ.get(q.id);
          if (!rr) {
            cells.push("", "", "");
            continue;
          }
          cells.push(fmtNum(rr.avg_days_won), fmtNum(rr.avg_days_lost), fmtNum(rr.avg_days_pipeline));
        }
        lines.push(cells);
      }
      lines.push([]);
      lines.push(["=== Avg Health Score (% of 30) ==="]);
      lines.push(["Bucket", ...selectedQuartersOrdered.flatMap((q) => [`${q.name} Health Won`, `${q.name} Health Lost`, `${q.name} Health Pipeline`])]);
      for (const b of bOrder) {
        const byQ = new Map<string, AggRow>();
        for (const r of rows) if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
        const cells: string[] = [b.label];
        for (const q of selectedQuartersOrdered) {
          const rr = byQ.get(q.id);
          if (!rr) {
            cells.push("", "", "");
            continue;
          }
          cells.push(fmtHealthPct(rr.avg_health_won), fmtHealthPct(rr.avg_health_lost), fmtHealthPct(rr.avg_health_pipeline));
        }
        lines.push(cells);
      }
    } else if (reportType === "meddpicc_health") {
      lines.push(["=== MEDDPICC+TB Scores ==="]);
      const qid = meddpiccQuarterId || reportData.quarters[0]?.id || "";
      lines.push([`Quarter id: ${qid}`]);
      const header = ["Bucket", ...MEDDPICC_SPOKES.map((s) => s.label)];
      lines.push(header);
      for (const b of bOrder) {
        const rr = rows.find((r) => r.bucket_id === b.id && r.quarter_id === qid);
        const cells: string[] = [b.label];
        for (const sp of MEDDPICC_SPOKES) {
          const v = rr ? rr[sp.key] : null;
          cells.push(v == null ? "" : fmtNum(v as number));
        }
        lines.push(cells);
      }
    } else {
      lines.push(["=== Product Revenue by Segment ==="]);
      lines.push(["Bucket", ...allProductNames.map((p) => `${p} ($)`), "Total ($)"]);
      for (const b of bOrder) {
        const byQ = new Map<string, AggRow>();
        for (const r of rows) if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
        let total = 0;
        const cells: string[] = [b.label];
        for (const p of allProductNames) {
          let sum = 0;
          for (const q of selectedQuartersOrdered) {
            const rr = byQ.get(q.id);
            sum += rr?.products?.[p] ? Number(rr.products[p]) : 0;
          }
          total += sum;
          cells.push(String(sum));
        }
        cells.push(String(total));
        lines.push(cells);
      }
    }
    const csv = lines.map((row) => row.map((c) => escapeCsvCell(String(c))).join(",")).join("\n");
    downloadTextFile("revenue-intelligence.csv", csv, "text/csv;charset=utf-8");
  };

  function findAgg(bid: string, qid: string): AggRow | undefined {
    return reportData?.rows.find((r) => r.bucket_id === bid && r.quarter_id === qid);
  }

  const bOrder = useMemo(() => {
    if (!reportData?.buckets?.length) return sortedBuckets;
    return reportData.buckets;
  }, [reportData, sortedBuckets]);

  return (
    <div className="text-[color:var(--sf-text-primary)]" data-org-id={orgId}>
      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setControlsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
        >
          <span>⚙ Report Configuration</span>
          <span className="text-xs text-[color:var(--sf-text-secondary)]">{controlsOpen ? "▲ Hide" : "▼ Configure"}</span>
        </button>
        {controlsOpen && (
          <div className="border-t border-[color:var(--sf-border)] p-5 space-y-5">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold">Revenue Buckets</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Rows below are sorted by minimum $ for editing. New buckets are appended to the end of the list.
        </p>
        <div className="mt-4 space-y-2">
          {sortedBuckets.map((b) => (
            <div key={b.id} className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-[140px] flex-1 gap-1">
                <label className="text-xs text-[color:var(--sf-text-secondary)]">Label</label>
                <input
                  value={b.label}
                  onChange={(e) => updateBucket(b.id, { label: e.target.value })}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
                />
              </div>
              <div className="grid w-[120px] gap-1">
                <label className="text-xs text-[color:var(--sf-text-secondary)]">Min $</label>
                <input
                  type="number"
                  value={b.min}
                  onChange={(e) => updateBucket(b.id, { min: Number(e.target.value) })}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
                />
              </div>
              <div className="grid w-[120px] gap-1">
                <label className="text-xs text-[color:var(--sf-text-secondary)]">Max $</label>
                <input
                  type="number"
                  value={b.max ?? ""}
                  placeholder="∞"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    updateBucket(b.id, { max: v === "" ? null : Number(v) });
                  }}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => removeBucket(b.id)}
                className="mb-0.5 rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-sm text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)]"
                aria-label="Remove bucket"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addBucket}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm"
          >
            Add Bucket
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[color:var(--sf-border)] pt-4">
          <div className="grid gap-1">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Save as</label>
            <input
              value={bucketSetName}
              onChange={(e) => setBucketSetName(e.target.value)}
              placeholder="My bucket set"
              className="min-w-[200px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void saveBuckets()}
            disabled={loading}
            className="rounded-md bg-[color:var(--sf-accent-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Save Buckets
          </button>
          <select
            value={loadBucketSetId}
            onChange={(e) => setLoadBucketSetId(e.target.value)}
            className="min-w-[200px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
          >
            <option value="">Load saved set…</option>
            {savedBucketSets.map((s: any) => (
              <option key={String(s.id)} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={loadBucketSet} className={outlineQuickBtn}>
            Load
          </button>
          <button type="button" onClick={() => void deleteBucketSet()} className={outlineQuickBtn}>
            Delete
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold">Select Quarters to Compare</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedQuarterIds(new Set(periodsNewestFirst.map((p) => p.id)))}
            className={outlineQuickBtn}
          >
            Select All
          </button>
          <button type="button" onClick={() => setSelectedQuarterIds(new Set())} className={outlineQuickBtn}>
            Clear
          </button>
        </div>
        {selectedQuarterIds.size > 4 ? (
          <p className="mt-2 text-xs text-amber-700">Charts work best with 4 or fewer quarters</p>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
          {periodsNewestFirst.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={selectedQuarterIds.has(p.id)}
                onChange={() =>
                  setSelectedQuarterIds((prev) => {
                    const n = new Set(prev);
                    if (n.has(p.id)) n.delete(p.id);
                    else n.add(p.id);
                    return n;
                  })
                }
              />
              <span className="min-w-0 break-words">{p.name}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold">Team Scope</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Empty scope includes all reps in the org. Manager row toggles all direct reports; symbols: ☐ none · ⊟ partial · ☑ all.
        </p>
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
        <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
          {managerGroups.groups.map((group) => {
            const mgr = group.manager;
            const mid = String(mgr.id);
            const repIds = group.reps.map((r) => String(r.id));
            const st = managerGroupState(mid, repIds, selectedManagerIds, selectedRepIds);
            const glyph = st === "all" ? "☑" : st === "partial" ? "⊟" : "☐";
            return (
              <div key={`mgr-grp:${mgr.id}`} className="mt-3 first:mt-0">
                <button
                  type="button"
                  onClick={() => toggleManagerReps(mid, repIds)}
                  className="flex w-full items-center gap-2 py-0.5 text-left text-sm font-semibold text-[color:var(--sf-text-primary)]"
                >
                  <span className="w-5 shrink-0 font-mono text-xs" aria-hidden>
                    {glyph}
                  </span>
                  <span>{mgr.name}</span>
                </button>
                {group.reps.map((rep) => (
                  <label key={rep.id} className="ml-8 flex cursor-pointer items-center gap-2 py-0.5">
                    <input type="checkbox" checked={selectedRepIds.has(String(rep.id))} onChange={() => toggleRepId(String(rep.id))} />
                    <span className="text-sm">{rep.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {managerGroups.unassigned.length ? (
            <div className={managerGroups.groups.length ? "mt-3 border-t border-[color:var(--sf-border)] pt-3" : ""}>
              {managerGroups.unassigned.map((rep) => (
                <label key={rep.id} className="ml-8 flex cursor-pointer items-center gap-2 py-0.5">
                  <input type="checkbox" checked={selectedRepIds.has(String(rep.id))} onChange={() => toggleRepId(String(rep.id))} />
                  <span className="text-sm">{rep.name}</span>
                </label>
              ))}
            </div>
          ) : null}
          {!repDirectory.length ? (
            <div className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No reps found.</div>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold">Report Type</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              { k: "deal_volume" as const, label: "Deal Volume" },
              { k: "meddpicc_health" as const, label: "MEDDPICC Health" },
              { k: "product_mix" as const, label: "Product Mix" },
            ] as const
          ).map((x) => (
            <button
              key={x.k}
              type="button"
              onClick={() => setReportType(x.k)}
              className={
                reportType === x.k
                  ? "rounded-full border px-3 py-1.5 text-xs font-semibold border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] text-white"
                  : "rounded-full border px-3 py-1.5 text-xs font-semibold border-[color:var(--sf-border)] text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]"
              }
            >
              {x.label}
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runReport()}
          disabled={loading}
          className="rounded-lg bg-[color:var(--sf-accent-primary)] px-6 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {loading ? "Running report..." : "Run Report"}
        </button>
        {reportData ? (
          <button type="button" onClick={exportCsv} className={outlineQuickBtn}>
            Export CSV
          </button>
        ) : null}
        {error ? <span className="text-sm text-[#E74C3C]">{error}</span> : null}
      </div>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h3 className="text-sm font-semibold">Save / load report</h3>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Report name</label>
            <input
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              className="min-w-[220px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void saveReportConfig()}
            disabled={loading}
            className="rounded-md bg-[color:var(--sf-accent-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Save Report
          </button>
          <select
            value={loadReportId}
            onChange={(e) => setLoadReportId(e.target.value)}
            className="min-w-[220px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
          >
            <option value="">Load saved…</option>
            {savedReports.map((r: any) => (
              <option key={String(r.id)} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={loadSavedReport} className={outlineQuickBtn}>
            Load
          </button>
          <button type="button" onClick={() => void deleteSavedReport()} className={outlineQuickBtn}>
            Delete
          </button>
        </div>
      </section>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-5">
        {reportData ? (
          <>
      {reportType === "deal_volume" ? (
        <>
          <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Win / Loss by Revenue Segment</h3>
              <button
                type="button"
                onClick={() => void downloadPanelPng(panel1Ref.current, "revenue-intel-win-loss.png")}
                className={outlineQuickBtn}
              >
                Download chart PNG
              </button>
            </div>
            <div ref={panel1Ref}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={panel1ChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
                  <XAxis dataKey="bucket" tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                  <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--sf-surface)",
                      border: "1px solid var(--sf-border)",
                      color: "var(--sf-text-primary)",
                    }}
                  />
                  <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 11 }} />
                  {selectedQuartersOrdered.map((q, qi) => (
                    <Bar
                      key={`${q.id}-won`}
                      dataKey={`${q.name} Won`}
                      fill={WON_SHADES[qi % WON_SHADES.length]}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                  {selectedQuartersOrdered.map((q, qi) => (
                    <Bar
                      key={`${q.id}-lost`}
                      dataKey={`${q.name} Lost`}
                      fill={LOST_SHADES[qi % LOST_SHADES.length]}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                  {selectedQuartersOrdered.map((q, qi) => (
                    <Bar
                      key={`${q.id}-pipe`}
                      dataKey={`${q.name} Pipeline`}
                      fill={PIPE_SHADES[qi % PIPE_SHADES.length]}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 overflow-x-auto space-y-6">
              {selectedQuartersOrdered.map((q) => (
                <div key={q.id}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">{q.name}</div>
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                      <tr>
                        <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Bucket</th>
                        <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Won</th>
                        <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Lost</th>
                        <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Pipeline</th>
                        <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Win Rate</th>
                        <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Won $</th>
                        <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Lost $</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bOrder.map((b) => {
                        const rr = findAgg(b.id, q.id);
                        return (
                          <tr key={`${b.id}-${q.id}-p1`} className="border-t border-[color:var(--sf-border)]">
                            <td className="px-3 py-2 font-medium">{b.label}</td>
                            <td className="px-2 py-2 text-right">{rr ? rr.won_count : "—"}</td>
                            <td className="px-2 py-2 text-right">{rr ? rr.lost_count : "—"}</td>
                            <td className="px-2 py-2 text-right">{rr ? rr.pipeline_count : "—"}</td>
                            <td className="px-2 py-2 text-right">{rr ? fmtPct01(rr.win_rate) : "—"}</td>
                            <td className="px-2 py-2 text-right font-mono text-xs">{rr ? fmtMoney(rr.won_amount) : "—"}</td>
                            <td className="px-2 py-2 text-right font-mono text-xs">{rr ? fmtMoney(rr.lost_amount) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Avg Days to Close by Revenue Segment</h3>
              <button
                type="button"
                onClick={() => void downloadPanelPng(panel2Ref.current, "revenue-intel-velocity.png")}
                className={outlineQuickBtn}
              >
                Download chart PNG
              </button>
            </div>
            <div ref={panel2Ref}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={panel2ChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
                  <XAxis dataKey="bucket" tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                  <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--sf-surface)",
                      border: "1px solid var(--sf-border)",
                      color: "var(--sf-text-primary)",
                    }}
                  />
                  <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 11 }} />
                  {selectedQuartersOrdered.map((q) => (
                    <Bar
                      key={`${q.id}-dw`}
                      dataKey={`${q.name} Avg Days Won`}
                      fill="#14B8A6"
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                  {selectedQuartersOrdered.map((q) => (
                    <Bar
                      key={`${q.id}-dl`}
                      dataKey={`${q.name} Avg Days Lost`}
                      fill="#E74C3C"
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Bucket</th>
                    {selectedQuartersOrdered.flatMap((q) => (
                      <th key={q.id} colSpan={3} className="border-b border-l border-[color:var(--sf-border)] px-2 py-2 text-center">
                        {q.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th />
                    {selectedQuartersOrdered.map((q) => (
                      <th key={`${q.id}-sub`} colSpan={3} className="border-b border-l border-[color:var(--sf-border)] px-0">
                        <div className="grid grid-cols-3 gap-0 text-[10px] font-normal">
                          <span className="border-r px-1 py-1 text-center">Days Won</span>
                          <span className="border-r px-1 py-1 text-center">Days Lost</span>
                          <span className="px-1 py-1 text-center">Days Pipeline</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bOrder.map((b) => (
                    <tr key={b.id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 font-medium">{b.label}</td>
                      {selectedQuartersOrdered.map((q) => {
                        const rr = findAgg(b.id, q.id);
                        return (
                          <td key={q.id} colSpan={3} className="border-l border-[color:var(--sf-border)] px-0">
                            {rr ? (
                              <div className="grid grid-cols-3 gap-0 text-xs">
                                <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_days_won)}</span>
                                <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_days_lost)}</span>
                                <span className="px-1 py-2 text-right">{fmtNum(rr.avg_days_pipeline)}</span>
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 text-xs text-[color:var(--sf-text-disabled)]">
                                <span className="px-1 py-2 text-center">—</span>
                                <span className="px-1 py-2 text-center">—</span>
                                <span className="px-1 py-2 text-center">—</span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Avg Health Score by Revenue Segment</h3>
              <button
                type="button"
                onClick={() => void downloadPanelPng(panel3Ref.current, "revenue-intel-health.png")}
                className={outlineQuickBtn}
              >
                Download chart PNG
              </button>
            </div>
            <div ref={panel3Ref}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={panel3ChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
                  <XAxis dataKey="bucket" tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                  <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--sf-surface)",
                      border: "1px solid var(--sf-border)",
                      color: "var(--sf-text-primary)",
                    }}
                    formatter={(v: number) => [`${Number(v).toFixed(0)}%`, ""]}
                  />
                  <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 11 }} />
                  {selectedQuartersOrdered.map((q) => (
                    <Bar key={`${q.id}-hw`} dataKey={`${q.name} Health Won`} fill="#16A34A" radius={[2, 2, 0, 0]} />
                  ))}
                  {selectedQuartersOrdered.map((q) => (
                    <Bar key={`${q.id}-hl`} dataKey={`${q.name} Health Lost`} fill="#E74C3C" radius={[2, 2, 0, 0]} />
                  ))}
                  {selectedQuartersOrdered.map((q) => (
                    <Bar key={`${q.id}-hp`} dataKey={`${q.name} Health Pipeline`} fill="#F1C40F" radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Bucket</th>
                    {selectedQuartersOrdered.flatMap((q) => (
                      <th key={q.id} colSpan={3} className="border-b border-l border-[color:var(--sf-border)] px-2 py-2 text-center">
                        {q.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th />
                    {selectedQuartersOrdered.map((q) => (
                      <th key={`${q.id}-hsub`} colSpan={3} className="border-b border-l border-[color:var(--sf-border)] px-0">
                        <div className="grid grid-cols-3 gap-0 text-[10px] font-normal">
                          <span className="border-r px-1 py-1 text-center">Health Won</span>
                          <span className="border-r px-1 py-1 text-center">Health Lost</span>
                          <span className="px-1 py-1 text-center">Health Pipeline</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bOrder.map((b) => (
                    <tr key={`${b.id}-h`} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 font-medium">{b.label}</td>
                      {selectedQuartersOrdered.map((q) => {
                        const rr = findAgg(b.id, q.id);
                        return (
                          <td key={q.id} colSpan={3} className="border-l border-[color:var(--sf-border)] px-0">
                            {rr ? (
                              <div className="grid grid-cols-3 gap-0 text-xs">
                                <span className="border-r px-1 py-2 text-right">{fmtHealthPct(rr.avg_health_won)}</span>
                                <span className="border-r px-1 py-2 text-right">{fmtHealthPct(rr.avg_health_lost)}</span>
                                <span className="px-1 py-2 text-right">{fmtHealthPct(rr.avg_health_pipeline)}</span>
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 text-xs">—</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {reportType === "meddpicc_health" ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC+TB Scores by Revenue Segment</h3>
            <button
              type="button"
              onClick={() => void downloadPanelPng(panelMeddpiccRef.current, "revenue-intel-meddpicc.png")}
              className={outlineQuickBtn}
            >
              Download chart PNG
            </button>
          </div>
          {reportData.quarters.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-3">
              {reportData.quarters.map((q) => (
                <label key={q.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="meddpicc-quarter"
                    checked={meddpiccQuarterId === q.id}
                    onChange={() => setMeddpiccQuarterId(q.id)}
                  />
                  <span className="min-w-0 break-words">{quotaPeriods.find((p) => p.id === q.id)?.name ?? q.name}</span>
                </label>
              ))}
            </div>
          ) : null}
          <div ref={panelMeddpiccRef}>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={meddpiccRadarRows}>
                <PolarGrid stroke="var(--sf-border)" />
                <PolarAngleAxis dataKey="spoke" tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                <PolarRadiusAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 9 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--sf-surface)",
                    border: "1px solid var(--sf-border)",
                    color: "var(--sf-text-primary)",
                  }}
                />
                <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 11 }} />
                {reportData.buckets.map((b, i) => (
                  <Radar
                    key={b.id}
                    name={b.label}
                    dataKey={`bk_${b.id}`}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    fillOpacity={0.2}
                  />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Bucket</th>
                  {MEDDPICC_SPOKES.map((s) => (
                    <th key={s.key} className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bOrder.map((b) => {
                  const rr = reportData.rows.find((r) => r.bucket_id === b.id && r.quarter_id === meddpiccQuarterId);
                  return (
                    <tr key={b.id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 font-medium">{b.label}</td>
                      {MEDDPICC_SPOKES.map((s) => (
                        <td key={s.key} className="px-2 py-2 text-right">
                          {rr ? fmtNum(rr[s.key] as number) : "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reportType === "product_mix" ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Product Revenue by Segment</h3>
            <button
              type="button"
              onClick={() => void downloadPanelPng(panelProductRef.current, "revenue-intel-product-mix.png")}
              className={outlineQuickBtn}
            >
              Download chart PNG
            </button>
          </div>
          <div ref={panelProductRef}>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={productMixChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
                <XAxis dataKey="bucket" tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--sf-surface)",
                    border: "1px solid var(--sf-border)",
                    color: "var(--sf-text-primary)",
                  }}
                  formatter={(v: number) => fmtMoney(v)}
                />
                <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 11 }} />
                {allProductNames.map((p, i) => (
                  <Bar key={p} dataKey={p} stackId="mix" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Bucket</th>
                  {allProductNames.map((p) => (
                    <th key={p} className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">
                      {p}
                    </th>
                  ))}
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {bOrder.map((b) => {
                  const byQ = new Map<string, AggRow>();
                  for (const r of reportData.rows) if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
                  let total = 0;
                  return (
                    <tr key={b.id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 font-medium">{b.label}</td>
                      {allProductNames.map((p) => {
                        let sum = 0;
                        for (const q of selectedQuartersOrdered) {
                          const rr = byQ.get(q.id);
                          sum += rr?.products?.[p] ? Number(rr.products[p]) : 0;
                        }
                        total += sum;
                        return (
                          <td key={p} className="px-2 py-2 text-right font-mono text-xs">
                            {fmtMoney(sum)}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right font-mono text-xs font-semibold">{fmtMoney(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
          </>
        ) : (
          <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-12 text-center text-sm text-[color:var(--sf-text-secondary)]">
            Configure your report above and click Run Report to see results.
          </div>
        )}
      </div>
    </div>
  );
}
