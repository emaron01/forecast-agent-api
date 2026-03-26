"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
type ChartType = "table" | "bar" | "line" | "radar" | "pie";

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
  const h = Number(svgEl.getAttribute("height")) || svgEl.getBoundingClientRect().height || 380;
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
  ctx.fillStyle = "var(--sf-surface)";
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

type DealVolumeMetric =
  | "won_count"
  | "lost_count"
  | "pipeline_count"
  | "win_rate"
  | "won_amount"
  | "lost_amount"
  | "avg_days_won"
  | "avg_days_lost"
  | "avg_health_won"
  | "avg_health_lost"
  | "avg_health_pipeline";

type MeddpiccMetric =
  | "avg_health"
  | "avg_pain"
  | "avg_metrics"
  | "avg_champion"
  | "avg_eb"
  | "avg_process"
  | "avg_paper"
  | "avg_timing"
  | "avg_budget"
  | "avg_criteria"
  | "avg_competition";

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

  const sortedQuotaPeriods = useMemo(() => {
    return [...quotaPeriods].sort((a, b) => {
      const ai = quotaPeriods.findIndex((x) => x.id === a.id);
      const bi = quotaPeriods.findIndex((x) => x.id === b.id);
      return ai - bi;
    });
  }, [quotaPeriods]);

  const periodsNewestFirst = useMemo(() => [...sortedQuotaPeriods].reverse(), [sortedQuotaPeriods]);

  const [selectedQuarterIds, setSelectedQuarterIds] = useState<Set<string>>(() => new Set());

  const [selectedRepIds, setSelectedRepIds] = useState<Set<string>>(new Set());
  const [selectedManagerIds, setSelectedManagerIds] = useState<Set<string>>(new Set());

  const [reportType, setReportType] = useState<ReportType>("deal_volume");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [chartMetric, setChartMetric] = useState<string>("won_count");
  const [productMixProduct, setProductMixProduct] = useState<string>("");

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

  const chartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [rb, ri] = await Promise.all([
          fetch("/api/revenue-buckets"),
          fetch("/api/revenue-intelligence"),
        ]);
        const jb = await rb.json().catch(() => ({}));
        const ji = await ri.json().catch(() => ({}));
        if (jb?.ok && Array.isArray(jb.bucketSets)) setSavedBucketSets(jb.bucketSets);
        if (ji?.ok && Array.isArray(ji.reports)) setSavedReports(ji.reports);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const pickerGroups = useMemo(() => {
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

  const allRepDirectoryIds = useMemo(() => repDirectory.map((r) => String(r.id)), [repDirectory]);

  const toggleRep = (id: string) => {
    setSelectedRepIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleManager = (id: string) => {
    setSelectedManagerIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const quickSelectAll = () => {
    setSelectedRepIds(new Set(repDirectory.filter((r) => r.role === "REP").map((r) => String(r.id))));
    setSelectedManagerIds(new Set(repDirectory.filter((r) => r.role === "MANAGER" || r.role === "EXEC_MANAGER").map((r) => String(r.id))));
  };

  const quickSelectClear = () => {
    setSelectedRepIds(new Set());
    setSelectedManagerIds(new Set());
  };

  const quickSelectRepsOnly = () => {
    setSelectedRepIds(new Set(repDirectory.filter((r) => r.role === "REP").map((r) => String(r.id))));
    setSelectedManagerIds(new Set());
  };

  const quickSelectLeadersOnly = () => {
    setSelectedManagerIds(
      new Set(repDirectory.filter((r) => r.role === "MANAGER" || r.role === "EXEC_MANAGER").map((r) => String(r.id)))
    );
    setSelectedRepIds(new Set());
  };

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

  const sortedBuckets = useMemo(() => {
    return [...buckets].sort((a, b) => Number(a.min) - Number(b.min));
  }, [buckets]);

  const addBucket = () => {
    setBuckets((prev) => [...prev, { id: newId(), label: "New", min: 0, max: null }]);
  };

  const removeBucket = (id: string) => {
    setBuckets((prev) => prev.filter((b) => b.id !== id));
  };

  const updateBucket = (id: string, patch: Partial<BucketRow>) => {
    setBuckets((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const selectedQuartersOrdered = useMemo(() => {
    const sel = Array.from(selectedQuarterIds);
    return periodsNewestFirst.filter((p) => sel.includes(p.id));
  }, [selectedQuarterIds, periodsNewestFirst]);

  const getMetricValue = useCallback(
    (row: AggRow, metric: string): number | null => {
      if (reportType === "deal_volume") {
        const m = metric as DealVolumeMetric;
        switch (m) {
          case "won_count":
            return row.won_count;
          case "lost_count":
            return row.lost_count;
          case "pipeline_count":
            return row.pipeline_count;
          case "win_rate":
            return row.win_rate;
          case "won_amount":
            return row.won_amount;
          case "lost_amount":
            return row.lost_amount;
          case "avg_days_won":
            return row.avg_days_won;
          case "avg_days_lost":
            return row.avg_days_lost;
          case "avg_health_won":
            return row.avg_health_won;
          case "avg_health_lost":
            return row.avg_health_lost;
          case "avg_health_pipeline":
            return row.avg_health_pipeline;
          default:
            return row.won_count;
        }
      }
      if (reportType === "meddpicc_health") {
        const m = metric as MeddpiccMetric;
        switch (m) {
          case "avg_health": {
            const vals = [row.avg_health_won, row.avg_health_lost, row.avg_health_pipeline].filter((x) => x != null) as number[];
            if (!vals.length) return null;
            return vals.reduce((a, b) => a + b, 0) / vals.length;
          }
          case "avg_pain":
            return row.avg_pain;
          case "avg_metrics":
            return row.avg_metrics;
          case "avg_champion":
            return row.avg_champion;
          case "avg_eb":
            return row.avg_eb;
          case "avg_process":
            return row.avg_process;
          case "avg_paper":
            return row.avg_paper;
          case "avg_timing":
            return row.avg_timing;
          case "avg_budget":
            return row.avg_budget;
          case "avg_criteria":
            return row.avg_criteria;
          case "avg_competition":
            return row.avg_competition;
          default:
            return row.avg_pain;
        }
      }
      if (reportType === "product_mix") {
        const p = metric || productMixProduct;
        if (!p) return null;
        return row.products[p] ?? 0;
      }
      return null;
    },
    [reportType, productMixProduct]
  );

  const chartData = useMemo(() => {
    if (!reportData?.rows?.length) return [];
    const bucketOrder = reportData.buckets.length ? reportData.buckets : sortedBuckets;
    const rows = reportData.rows;
    const metricKey = reportType === "product_mix" ? productMixProduct || chartMetric : chartMetric;
    const out: Record<string, string | number>[] = [];
    for (const b of bucketOrder) {
      const pt: Record<string, string | number> = { bucket: b.label };
      for (const q of selectedQuartersOrdered) {
        const cell = rows.find((r) => r.bucket_id === b.id && r.quarter_id === q.id);
        const v = cell ? getMetricValue(cell, metricKey) : null;
        pt[q.name] = v == null || !Number.isFinite(v) ? 0 : Number(v);
      }
      out.push(pt);
    }
    return out;
  }, [reportData, sortedBuckets, selectedQuartersOrdered, chartMetric, getMetricValue, reportType, productMixProduct]);

  const pieData = useMemo(() => {
    if (selectedQuartersOrdered.length !== 1 || !chartData.length) return [];
    const q = selectedQuartersOrdered[0]!;
    return chartData.map((row) => ({
      bucket: String(row.bucket),
      value: Number(row[q.name] ?? 0),
    }));
  }, [chartData, selectedQuartersOrdered]);

  /** One row per bucket; each quarter is a numeric field (Recharts radar: angle = bucket, series = quarter). */
  const radarData = useMemo(() => {
    return chartData.map((row) => {
      const o: Record<string, string | number> = { bucket: String(row.bucket) };
      for (const q of selectedQuartersOrdered) {
        o[q.name] = Number(row[q.name] ?? 0);
      }
      return o;
    });
  }, [chartData, selectedQuartersOrdered]);

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

  useEffect(() => {
    if (reportType === "product_mix" && allProductNames.length && !productMixProduct) {
      setProductMixProduct(allProductNames[0]!);
    }
  }, [reportType, allProductNames, productMixProduct]);

  useEffect(() => {
    if (reportType === "deal_volume") {
      const allowed = new Set([
        "won_count",
        "lost_count",
        "pipeline_count",
        "win_rate",
        "won_amount",
        "lost_amount",
        "avg_days_won",
        "avg_days_lost",
        "avg_health_won",
        "avg_health_lost",
        "avg_health_pipeline",
      ]);
      if (!allowed.has(chartMetric)) setChartMetric("won_count");
    } else if (reportType === "meddpicc_health") {
      const allowed = new Set([
        "avg_health",
        "avg_pain",
        "avg_metrics",
        "avg_champion",
        "avg_eb",
        "avg_process",
        "avg_paper",
        "avg_timing",
        "avg_budget",
        "avg_criteria",
        "avg_competition",
      ]);
      if (!allowed.has(chartMetric)) setChartMetric("avg_health");
    } else if (reportType === "product_mix") {
      if (productMixProduct) setChartMetric(productMixProduct);
    }
  }, [reportType, chartMetric, productMixProduct]);

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
      const effectiveMetric =
        reportType === "product_mix" ? (productMixProduct || allProductNames[0] || "") : chartMetric;
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
      if (reportType === "product_mix") {
        const names = new Set<string>();
        for (const r of j.rows || []) {
          for (const k of Object.keys(r.products || {})) if (k) names.add(k);
        }
        const arr = Array.from(names).sort((a, b) => a.localeCompare(b));
        if (arr.length && !arr.includes(productMixProduct)) setProductMixProduct(arr[0]!);
      }
      if (reportType === "product_mix" && effectiveMetric) setChartMetric(effectiveMetric);
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
        version: 1,
        buckets: sortedBuckets.map((b) => ({ id: b.id, label: b.label, min: b.min, max: b.max })),
        bucketSetId: bucketSetIdRef,
        selectedQuarterIds: Array.from(selectedQuarterIds),
        selectedRepIds: Array.from(selectedRepIds),
        selectedManagerIds: Array.from(selectedManagerIds),
        reportType,
        chartType,
        chartMetric: reportType === "product_mix" ? productMixProduct || chartMetric : chartMetric,
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
    if (Array.isArray(c.selectedRepIds)) setSelectedRepIds(new Set(c.selectedRepIds.map(String)));
    if (Array.isArray(c.selectedManagerIds)) setSelectedManagerIds(new Set(c.selectedManagerIds.map(String)));
    if (c.reportType === "deal_volume" || c.reportType === "meddpicc_health" || c.reportType === "product_mix") {
      setReportType(c.reportType);
    }
    if (c.chartType === "table" || c.chartType === "bar" || c.chartType === "line" || c.chartType === "radar" || c.chartType === "pie") {
      setChartType(c.chartType);
    }
    if (typeof c.chartMetric === "string") {
      setChartMetric(c.chartMetric);
      if (c.reportType === "product_mix") setProductMixProduct(c.chartMetric);
    }
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

  const exportCsv = () => {
    const lines: string[][] = [];
    if (reportType === "deal_volume") {
      const qCols = selectedQuartersOrdered;
      const base = [
        "Bucket",
        ...qCols.flatMap((q) => [
          `${q.name} Won`,
          `${q.name} Lost`,
          `${q.name} Pipeline`,
          `${q.name} Win Rate`,
          `${q.name} Avg Days Won`,
          `${q.name} Avg Days Lost`,
          `${q.name} Avg Health Won`,
          `${q.name} Avg Health Lost`,
          `${q.name} Avg Health Pipeline`,
          `${q.name} Won $`,
          `${q.name} Lost $`,
        ]),
      ];
      if (selectedQuartersOrdered.length === 2) {
        base.push("Δ Won", "Δ Win Rate");
      }
      lines.push(base);
      const bOrder = reportData?.buckets?.length ? reportData.buckets : sortedBuckets;
      const rows = reportData?.rows || [];
      for (const b of bOrder) {
        const rowCells: string[] = [b.label];
        const byQ = new Map<string, AggRow>();
        for (const r of rows) {
          if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
        }
        for (const q of qCols) {
          const rr = byQ.get(q.id);
          if (!rr) {
            rowCells.push("", "", "", "", "", "", "", "", "", "", "");
            continue;
          }
          rowCells.push(
            String(rr.won_count),
            String(rr.lost_count),
            String(rr.pipeline_count),
            fmtPct01(rr.win_rate),
            fmtNum(rr.avg_days_won),
            fmtNum(rr.avg_days_lost),
            fmtHealthPct(rr.avg_health_won),
            fmtHealthPct(rr.avg_health_lost),
            fmtHealthPct(rr.avg_health_pipeline),
            String(rr.won_amount),
            String(rr.lost_amount)
          );
        }
        if (selectedQuartersOrdered.length === 2) {
          const a = byQ.get(selectedQuartersOrdered[0]!.id);
          const c = byQ.get(selectedQuartersOrdered[1]!.id);
          const dWon = a && c ? a.won_count - c.won_count : "";
          const dWr = a && c ? a.win_rate - c.win_rate : "";
          rowCells.push(dWon === "" ? "" : String(dWon), dWr === "" ? "" : String(dWr));
        }
        lines.push(rowCells);
      }
    } else if (reportType === "meddpicc_health") {
      const qCols = selectedQuartersOrdered;
      const header = [
        "Bucket",
        ...qCols.flatMap((q) => [
          `${q.name} Avg Health`,
          `${q.name} Pain`,
          `${q.name} Metrics`,
          `${q.name} Champion`,
          `${q.name} EB`,
          `${q.name} Process`,
          `${q.name} Paper`,
          `${q.name} Timing`,
          `${q.name} Budget`,
          `${q.name} Criteria`,
          `${q.name} Competition`,
        ]),
      ];
      lines.push(header);
      const bOrder = reportData?.buckets?.length ? reportData.buckets : sortedBuckets;
      const rows = reportData?.rows || [];
      for (const b of bOrder) {
        const rowCells: string[] = [b.label];
        const byQ = new Map<string, AggRow>();
        for (const r of rows) {
          if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
        }
        for (const q of qCols) {
          const rr = byQ.get(q.id);
          if (!rr) {
            rowCells.push("", "", "", "", "", "", "", "", "", "", "");
            continue;
          }
          const hAvg = getMetricValue(rr, "avg_health");
          rowCells.push(
            hAvg == null ? "" : fmtNum(hAvg),
            fmtNum(rr.avg_pain),
            fmtNum(rr.avg_metrics),
            fmtNum(rr.avg_champion),
            fmtNum(rr.avg_eb),
            fmtNum(rr.avg_process),
            fmtNum(rr.avg_paper),
            fmtNum(rr.avg_timing),
            fmtNum(rr.avg_budget),
            fmtNum(rr.avg_criteria),
            fmtNum(rr.avg_competition)
          );
        }
        lines.push(rowCells);
      }
    } else {
      const products = allProductNames;
      lines.push(["Bucket", ...products.map((p) => `${p} ($)`), "Total ($)"]);
      const bOrder = reportData?.buckets?.length ? reportData.buckets : sortedBuckets;
      const rows = reportData?.rows || [];
      for (const b of bOrder) {
        const byQ = new Map<string, AggRow>();
        for (const r of rows) {
          if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
        }
        let total = 0;
        const cells: string[] = [b.label];
        for (const p of products) {
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

  const downloadChart = async () => {
    const root = chartWrapRef.current;
    if (!root) return;
    const svg = root.querySelector("svg");
    if (!svg) return;
    await downloadSvgAsPng(svg, "revenue-intelligence-chart.png");
  };

  const showPie = chartType === "pie" && selectedQuartersOrdered.length === 1;
  const showPieMsg = chartType === "pie" && selectedQuartersOrdered.length !== 1;
  const showBarLine = (chartType === "bar" || chartType === "line") && chartData.length && selectedQuartersOrdered.length > 0;
  const showRadar = chartType === "radar" && radarData.length && chartData.length > 0;
  const showTableOnlyChart = chartType === "table";

  const dealVolumeMetricOptions: { value: DealVolumeMetric; label: string }[] = [
    { value: "won_count", label: "Won Count" },
    { value: "lost_count", label: "Lost Count" },
    { value: "pipeline_count", label: "Pipeline Count" },
    { value: "win_rate", label: "Win Rate" },
    { value: "won_amount", label: "Won $" },
    { value: "lost_amount", label: "Lost $" },
    { value: "avg_days_won", label: "Avg Days Won" },
    { value: "avg_days_lost", label: "Avg Days Lost" },
    { value: "avg_health_won", label: "Avg Health Won" },
    { value: "avg_health_lost", label: "Avg Health Lost" },
    { value: "avg_health_pipeline", label: "Avg Health Pipeline" },
  ];

  const meddpiccMetricOptions: { value: MeddpiccMetric; label: string }[] = [
    { value: "avg_health", label: "Health" },
    { value: "avg_pain", label: "Pain" },
    { value: "avg_metrics", label: "Metrics" },
    { value: "avg_champion", label: "Champion" },
    { value: "avg_eb", label: "EB" },
    { value: "avg_process", label: "Process" },
    { value: "avg_paper", label: "Paper" },
    { value: "avg_timing", label: "Timing" },
    { value: "avg_budget", label: "Budget" },
    { value: "avg_criteria", label: "Criteria" },
    { value: "avg_competition", label: "Competition" },
  ];

  const twoQuarterDelta =
    selectedQuartersOrdered.length === 2 ? { qA: selectedQuartersOrdered[0]!, qB: selectedQuartersOrdered[1]! } : null;

  return (
    <div className="space-y-6 text-[color:var(--sf-text-primary)]" data-org-id={orgId}>
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold">Revenue Buckets</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Define amount ranges. Rows are sorted by minimum $ automatically.
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
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {periodsNewestFirst.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
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
              <span>{p.name}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold">Team Scope</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Select leaders (direct team) and/or individual reps. Empty scope runs across all reps in the org.
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
        <div className="mt-2 max-h-[320px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
          {pickerGroups.groups.map((group) => {
            const mgr = group.manager;
            const mid = String(mgr.id);
            return (
              <div key={`ri-mgr:${mgr.id}`} className="mt-3 first:mt-0">
                <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm font-semibold">
                  <input type="checkbox" checked={selectedManagerIds.has(mid)} onChange={() => toggleManager(mid)} />
                  <span>{mgr.name}</span>
                </label>
                {group.reps.map((rep) => (
                  <label key={rep.id} className="ml-6 flex cursor-pointer items-center gap-2 py-0.5">
                    <input type="checkbox" checked={selectedRepIds.has(String(rep.id))} onChange={() => toggleRep(String(rep.id))} />
                    <span className="text-sm">{rep.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {pickerGroups.unassigned.length ? (
            <div className={pickerGroups.groups.length ? "mt-3 border-t border-[color:var(--sf-border)] pt-3" : ""}>
              {pickerGroups.unassigned.map((rep) => (
                <label key={rep.id} className="ml-6 flex cursor-pointer items-center gap-2 py-0.5">
                  <input type="checkbox" checked={selectedRepIds.has(String(rep.id))} onChange={() => toggleRep(String(rep.id))} />
                  <span className="text-sm">{rep.name}</span>
                </label>
              ))}
            </div>
          ) : null}
          {!allRepDirectoryIds.length ? (
            <div className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No directory rows.</div>
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

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold">Chart Type</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["table", "bar", "line", "radar", "pie"] as const).map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => setChartType(ct)}
              className={
                chartType === ct
                  ? "rounded-full border px-3 py-1.5 text-xs font-semibold border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] text-white"
                  : "rounded-full border px-3 py-1.5 text-xs font-semibold border-[color:var(--sf-border)] text-[color:var(--sf-text-secondary)] capitalize hover:text-[color:var(--sf-text-primary)]"
              }
            >
              {ct}
            </button>
          ))}
        </div>
        {reportType === "deal_volume" ? (
          <div className="mt-3">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Metric</label>
            <select
              value={chartMetric}
              onChange={(e) => setChartMetric(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
            >
              {dealVolumeMetricOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {reportType === "meddpicc_health" ? (
          <div className="mt-3">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Metric</label>
            <select
              value={chartMetric}
              onChange={(e) => setChartMetric(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
            >
              {meddpiccMetricOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {reportType === "product_mix" ? (
          <div className="mt-3">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Product</label>
            <select
              value={productMixProduct}
              onChange={(e) => {
                setProductMixProduct(e.target.value);
                setChartMetric(e.target.value);
              }}
              className="mt-1 block w-full max-w-md rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm"
            >
              {allProductNames.length ? (
                allProductNames.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))
              ) : (
                <option value="">Run report to load products</option>
              )}
            </select>
          </div>
        ) : null}
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
        {error ? <span className="text-sm text-[#E74C3C]">{error}</span> : null}
      </div>

      {reportData && !showTableOnlyChart ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Chart</h3>
            <button type="button" onClick={() => void downloadChart()} className={outlineQuickBtn}>
              Download Chart
            </button>
          </div>
          <div ref={chartWrapRef} className="mt-3 w-full">
            {showPieMsg ? (
              <p className="text-sm text-[color:var(--sf-text-secondary)]">Pie chart uses a single selected quarter. Pick one quarter or switch chart type.</p>
            ) : null}
            {showPie ? (
              <ResponsiveContainer width="100%" height={380}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    outerRadius={140}
                    label={({ bucket, percent }: any) => `${bucket} ${(percent * 100).toFixed(0)}%`}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--sf-surface)",
                      border: "1px solid var(--sf-border)",
                      color: "var(--sf-text-primary)",
                    }}
                  />
                  <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : null}
            {showBarLine ? (
              <ResponsiveContainer width="100%" height={380}>
                {chartType === "bar" ? (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
                    <XAxis dataKey="bucket" tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--sf-surface)",
                        border: "1px solid var(--sf-border)",
                        color: "var(--sf-text-primary)",
                      }}
                    />
                    <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 12 }} />
                    {selectedQuartersOrdered.map((q, i) => (
                      <Bar key={q.id} dataKey={q.name} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                    ))}
                  </BarChart>
                ) : (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-border)" />
                    <XAxis dataKey="bucket" tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--sf-surface)",
                        border: "1px solid var(--sf-border)",
                        color: "var(--sf-text-primary)",
                      }}
                    />
                    <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 12 }} />
                    {selectedQuartersOrdered.map((q, i) => (
                      <Line
                        key={q.id}
                        type="monotone"
                        dataKey={q.name}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            ) : null}
            {showRadar ? (
              <ResponsiveContainer width="100%" height={380}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="var(--sf-border)" />
                  <PolarAngleAxis dataKey="bucket" tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
                  <PolarRadiusAxis tick={{ fill: "var(--sf-text-secondary)", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--sf-surface)",
                      border: "1px solid var(--sf-border)",
                      color: "var(--sf-text-primary)",
                    }}
                  />
                  <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 12 }} />
                  {selectedQuartersOrdered.map((q, i) => (
                    <Radar
                      key={q.id}
                      name={q.name}
                      dataKey={q.name}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.18}
                    />
                  ))}
                </RadarChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </section>
      ) : null}

      {reportData ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Table</h3>
            <button type="button" onClick={exportCsv} className={outlineQuickBtn}>
              Export CSV
            </button>
          </div>
          <div className="mt-3 overflow-x-auto">
            {reportType === "deal_volume" ? (
              <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Bucket</th>
                    {selectedQuartersOrdered.map((q) => (
                      <th key={q.id} colSpan={11} className="border-b border-l border-[color:var(--sf-border)] px-3 py-2 text-center">
                        {q.name}
                      </th>
                    ))}
                    {twoQuarterDelta ? (
                      <>
                        <th className="border-b border-l border-[color:var(--sf-border)] px-2 py-2 text-right">Δ Won</th>
                        <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Δ Win Rate</th>
                      </>
                    ) : null}
                  </tr>
                  <tr>
                    <th className="border-b border-[color:var(--sf-border)] px-2 py-1" />
                    {selectedQuartersOrdered.map((q) => (
                      <th key={`${q.id}-sub`} colSpan={11} className="border-b border-l border-[color:var(--sf-border)] px-0">
                        <div className="grid grid-cols-11 gap-0 text-[10px] font-normal">
                          {["Won", "Lost", "Pipe", "WR%", "Days W", "Days L", "HW", "HL", "HP", "Won$", "Lost$"].map((h) => (
                            <span key={h + q.id} className="border-r border-[color:var(--sf-border)] px-1 py-1 text-center last:border-r-0">
                              {h}
                            </span>
                          ))}
                        </div>
                      </th>
                    ))}
                    {twoQuarterDelta ? (
                      <>
                        <th className="border-b border-l border-[color:var(--sf-border)]" />
                        <th className="border-b border-[color:var(--sf-border)]" />
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {(reportData.buckets.length ? reportData.buckets : sortedBuckets).map((b) => {
                    const byQ = new Map<string, AggRow>();
                    for (const r of reportData.rows) {
                      if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
                    }
                    return (
                      <tr key={b.id} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-3 py-2 font-medium">{b.label}</td>
                        {selectedQuartersOrdered.map((q) => {
                          const rr = byQ.get(q.id);
                          return (
                            <td key={q.id} colSpan={11} className="border-l border-[color:var(--sf-border)] px-0">
                              {rr ? (
                                <div className="grid grid-cols-11 gap-0 text-xs">
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{rr.won_count}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{rr.lost_count}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{rr.pipeline_count}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{fmtPct01(rr.win_rate)}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{fmtNum(rr.avg_days_won)}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{fmtNum(rr.avg_days_lost)}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{fmtHealthPct(rr.avg_health_won)}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{fmtHealthPct(rr.avg_health_lost)}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right">{fmtHealthPct(rr.avg_health_pipeline)}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right font-mono">{fmtMoney(rr.won_amount)}</span>
                                  <span className="border-r border-[color:var(--sf-border)] px-1 py-2 text-right font-mono">{fmtMoney(rr.lost_amount)}</span>
                                </div>
                              ) : (
                                <div className="grid grid-cols-11 gap-0 text-xs text-[color:var(--sf-text-disabled)]">
                                  {Array.from({ length: 11 }).map((_, i) => (
                                    <span key={i} className="border-r px-1 py-2 text-center">
                                      —
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        {twoQuarterDelta ? (() => {
                          const a = byQ.get(twoQuarterDelta.qA.id);
                          const c = byQ.get(twoQuarterDelta.qB.id);
                          const dWon = a && c ? a.won_count - c.won_count : null;
                          const dWr = a && c ? a.win_rate - c.win_rate : null;
                          return (
                            <>
                              <td className="border-l border-[color:var(--sf-border)] px-2 py-2 text-right text-xs">{dWon == null ? "—" : dWon}</td>
                              <td className="px-2 py-2 text-right text-xs">{dWr == null ? "—" : fmtPct01(dWr)}</td>
                            </>
                          );
                        })() : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : reportType === "meddpicc_health" ? (
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Bucket</th>
                    {selectedQuartersOrdered.map((q) => (
                      <th key={q.id} colSpan={11} className="border-b border-l border-[color:var(--sf-border)] px-3 py-2 text-center">
                        {q.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th />
                    {selectedQuartersOrdered.map((q) => (
                      <th key={`${q.id}-m`} colSpan={11} className="border-b border-l border-[color:var(--sf-border)] px-0">
                        <div className="grid grid-cols-11 gap-0 text-[10px] font-normal">
                          {["Health", "Pain", "Met", "Champ", "EB", "Proc", "Paper", "Time", "Budg", "Crit", "Comp"].map((h) => (
                            <span key={h + q.id} className="border-r border-[color:var(--sf-border)] px-1 py-1 text-center">
                              {h}
                            </span>
                          ))}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reportData.buckets.length ? reportData.buckets : sortedBuckets).map((b) => {
                    const byQ = new Map<string, AggRow>();
                    for (const r of reportData.rows) {
                      if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
                    }
                    return (
                      <tr key={b.id} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-3 py-2 font-medium">{b.label}</td>
                        {selectedQuartersOrdered.map((q) => {
                          const rr = byQ.get(q.id);
                          const hAvg = rr ? getMetricValue(rr, "avg_health") : null;
                          return (
                            <td key={q.id} colSpan={11} className="border-l border-[color:var(--sf-border)] px-0">
                              {rr ? (
                                <div className="grid grid-cols-11 gap-0 text-xs">
                                  <span className="border-r px-1 py-2 text-right">{hAvg == null ? "—" : fmtNum(hAvg)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_pain)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_metrics)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_champion)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_eb)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_process)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_paper)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_timing)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_budget)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_criteria)}</span>
                                  <span className="border-r px-1 py-2 text-right">{fmtNum(rr.avg_competition)}</span>
                                </div>
                              ) : (
                                <div className="grid grid-cols-11 gap-0 text-xs">—</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
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
                  {(reportData.buckets.length ? reportData.buckets : sortedBuckets).map((b) => {
                    const byQ = new Map<string, AggRow>();
                    for (const r of reportData.rows) {
                      if (r.bucket_id === b.id) byQ.set(r.quarter_id, r);
                    }
                    let total = 0;
                    const cells = allProductNames.map((p) => {
                      let sum = 0;
                      for (const q of selectedQuartersOrdered) {
                        const rr = byQ.get(q.id);
                        sum += rr?.products?.[p] ? Number(rr.products[p]) : 0;
                      }
                      total += sum;
                      return (
                        <td key={p} className="border-t border-[color:var(--sf-border)] px-2 py-2 text-right font-mono text-xs">
                          {fmtMoney(sum)}
                        </td>
                      );
                    });
                    return (
                      <tr key={b.id} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-3 py-2 font-medium">{b.label}</td>
                        {cells}
                        <td className="border-t border-[color:var(--sf-border)] px-2 py-2 text-right font-mono text-xs font-semibold">
                          {fmtMoney(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : null}

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
          <button type="button" onClick={() => void saveReportConfig()} disabled={loading} className="rounded-md bg-[color:var(--sf-accent-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
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
  );
}
