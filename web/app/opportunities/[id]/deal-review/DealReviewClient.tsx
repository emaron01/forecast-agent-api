"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MEDDPICC_CANONICAL } from "../../../../lib/meddpiccCanonical";
import { dateOnly } from "../../../../lib/dateOnly";
import { PasteNotesPanel } from "../../../../components/opportunities/PasteNotesPanel";
import { confidencePillClassFromBand } from "../../../../lib/confidenceUi";

type HandsFreeMessage = { role: "assistant" | "user" | "system"; text: string; at: number };

type CategoryKey =
  | "metrics"
  | "economic_buyer"
  | "criteria"
  | "process"
  | "paper"
  | "pain"
  | "champion"
  | "competition"
  | "timing"
  | "budget";

type CategoryInputMode = "TEXT" | "VOICE";

type Scoring = {
  confidence_score: number;
  confidence_band: string;
  confidence_summary: string;
  score_source: string;
  evidence: { comment_ingestion_id: number | null };
  computed_at: string;
};

type OppState = {
  opportunity: any;
  rollup: { summary?: string; next_steps?: string; risks?: string; updated_at?: any } | null;
  categories: Array<{ category: CategoryKey; score: number; label: string; tip: string; evidence: string; updated_at?: any }>;
  healthPercent?: number | null;
  scoring?: Scoring | null;
};

type ConfidenceEvidencePanel = {
  source: "comment_ingestion" | "deal_review";
  summary: string;
  raw_text: string;
  risk_flags: unknown[];
  next_steps: string[];
  categories: Array<{ category: string; score: number; evidence: string; tip: string; evidenceStrength: string }>;
};

type OrgStageMapping = { stage_value: string; bucket: string };

function resolveOpenBucketFromStages(
  forecastStage: string,
  salesStage: string,
  orgStageMappings?: OrgStageMapping[] | null
): "commit" | "best_case" | "pipeline" | null {
  if (orgStageMappings?.length) {
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const fs = norm(forecastStage);
    const ss = norm(salesStage);
    const match = orgStageMappings.find((m) => {
      const v = norm(m.stage_value);
      return v && (v === fs || v === ss);
    });
    const b = match ? norm(match.bucket).replace(/\s+/g, "_") : "";
    if (b === "commit" || b === "best_case" || b === "pipeline") return b;
    if (b === "won" || b === "lost" || b === "excluded") return null;
  }

  const stage = String(forecastStage || "").trim().toLowerCase();
  if (!stage) return "pipeline";
  if (stage.includes("won") || stage.includes("lost") || stage.includes("loss") || stage.includes("closed")) return null;
  if (stage.includes("commit")) return "commit";
  if (stage.includes("best case") || stage.includes("bestcase") || stage.includes("best")) return "best_case";
  return "pipeline";
}

function b64ToBlob(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

function safeDate(d: any) {
  const s = dateOnly(d);
  return s || "—";
}

function scoreColor(score: number) {
  const s = Number(score || 0) || 0;
  return s >= 3 ? "var(--good)" : s >= 2 ? "var(--accent)" : "var(--bad)";
}

function healthPillClass(p: number | null | undefined) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "";
  if (n >= 80) return "ok";
  if (n >= 60) return "warn";
  return "err";
}

function displayCategoryLabel(category: string) {
  const key = String(category || "").trim();
  if (!key) return "Category";
  const row = (MEDDPICC_CANONICAL as any)?.[key] || null;
  return String(row?.titleLine || key.replace(/_/g, " ")).trim();
}

function evidenceStrengthLabel(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "missing" || normalized === "null" || normalized === "unscored") {
    return "No Evidence Present";
  }
  if (normalized === "explicit_verified") return "Explicit Verified";
  if (normalized === "credible_indirect") return "Credible Indirect";
  if (normalized === "vague_rep_assertion") return "Vague Rep Assertion";
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function evidenceBandFromScore(score: number | null | undefined) {
  const s = Number(score);
  if (!Number.isFinite(s) || s <= 1) return { label: "Low", className: "err" };
  if (s >= 3) return { label: "High", className: "ok" };
  return { label: "Med", className: "warn" };
}

function evidenceStrengthFieldName(category: CategoryKey) {
  return `${category === "economic_buyer" ? "eb" : category}_evidence_strength`;
}

function inferCategoryFromPromptText(text: string): CategoryKey | "" {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return "";
  if (/\bpain\b|\bproblem\b|\bdo nothing\b/.test(t)) return "pain";
  if (/\bmetrics?\b|\bbaseline\b|\btarget\b|\bmeasurable\b/.test(t)) return "metrics";
  if (/\binternal sponsor\b|\bsponsor\/coach\b|\bcoach\b|\binfluence\b/.test(t)) return "champion";
  if (/\beconomic buyer\b|\beb\b|\bapprover\b|\bdirect access\b/.test(t)) return "economic_buyer";
  if (/\bdecision criteria\b|\bcriteria\b|\bweighted\b/.test(t)) return "criteria";
  if (/\bdecision process\b|\bprocess step\b|\bowners\b|\bblock progress\b/.test(t)) return "process";
  if (/\bpaper process\b|\blegal\b|\bprocurement\b|\bsecurity\b|\bsignature\b/.test(t)) return "paper";
  if (/\bcompetition\b|\bcompetitive\b|\balternative\b|\bwhy you win\b/.test(t)) return "competition";
  if (/\btiming\b|\bmilestones\b|\bcritical path\b|\bclose\b/.test(t)) return "timing";
  if (/\bbudget\b|\bfunding\b|\bapproval\b|\bamount\b/.test(t)) return "budget";
  return "";
}

function stripPercentCalloutsForTypedUpdate(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const lines = raw.split("\n");
  const kept = lines.filter((l) => {
    const s = String(l || "").trim();
    if (!s) return true;
    if (/^overall\s*:\s*\d+\s*%/i.test(s)) return false;
    if (/%\s*$/.test(s) && /^overall/i.test(s)) return false;
    if (/overall score reflects/i.test(s)) return false;
    return true;
  });
  return kept.join("\n").trim();
}

function pickRecorderMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const t of candidates) {
    try {
      if ((window as any).MediaRecorder?.isTypeSupported?.(t)) return t;
    } catch {}
  }
  return "";
}

const VALID_CATEGORIES: CategoryKey[] = ["metrics", "economic_buyer", "criteria", "process", "paper", "pain", "champion", "competition", "timing", "budget"];

/** Pipeline: matches prompt category order. Best Case / Commit: full prompt order (eb = economic_buyer, paper_process = paper). */
const CHAIN_ORDER_PIPELINE: CategoryKey[] = ["pain", "metrics", "champion", "competition", "budget"];
const CHAIN_ORDER_BEST_CASE_COMMIT: CategoryKey[] = [
  "pain",
  "metrics",
  "champion",
  "criteria",
  "competition",
  "timing",
  "budget",
  "economic_buyer",
  "process",
  "paper",
];

function buildInitialChain(
  forecastStage: string,
  salesStage: string,
  orgStageMappings?: OrgStageMapping[]
): CategoryKey[] {
  const bucket = resolveOpenBucketFromStages(forecastStage, salesStage, orgStageMappings || null);
  if (bucket === "commit" || bucket === "best_case") return [...CHAIN_ORDER_BEST_CASE_COMMIT];
  return [...CHAIN_ORDER_PIPELINE];
}

const DEBUG_SSE = false;

function parseSSE(buffer: string): { messages: any[]; remaining: string } {
  const messages: any[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const delim = "\n\n";
  const lastIdx = normalized.lastIndexOf(delim);
  const complete = lastIdx === -1 ? "" : normalized.slice(0, lastIdx);
  const remaining = lastIdx === -1 ? normalized : normalized.slice(lastIdx + delim.length);

  const eventBlocks = complete ? complete.split(delim) : [];
  for (const block of eventBlocks) {
    const dataLines = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""));
    const joined = dataLines.join("\n");
    if (joined.trim() === "" || joined === "[DONE]") continue;
    try {
      const data = JSON.parse(joined);
      messages.push(data);
    } catch (e) {
      if (DEBUG_SSE && typeof console !== "undefined") {
        console.warn("[SSE] Parse failure", { offendingBlock: block.slice(-512), bufferTail: buffer.slice(-2048) });
      }
    }
  }
  return { messages, remaining };
}

const UPDATE_CATEGORY_RETRY_MS = 1000;

/** One silent HTTP retry before surfacing save failure (same init body). */
async function fetchUpdateCategoryWithSilentRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init);
  if (res.ok) return res;
  await new Promise((r) => setTimeout(r, UPDATE_CATEGORY_RETRY_MS));
  return fetch(url, init);
}

export function DealReviewClient(props: {
  opportunityId: string;
  initialCategory?: string;
  initialPrefill?: string;
  /** When true (e.g. channel roles 6/7/8): show deal summary and scoring only; hide voice, paste, review actions, and chat. */
  readOnly?: boolean;
}) {
  const readOnly = !!props.readOnly;
  const opportunityId = String(props.opportunityId || "").trim();
  const initialCategory = String(props.initialCategory || "").trim() || undefined;
  const initialPrefill = String(props.initialPrefill || "").trim() || undefined;

  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"FULL_REVIEW" | "CATEGORY_UPDATE">("FULL_REVIEW");
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | "">("");
  const [answer, setAnswer] = useState("");
  const [categoryInputMode, setCategoryInputMode] = useState<CategoryInputMode>("VOICE");
  const [qaPaneOpen, setQaPaneOpen] = useState(false);
  const [fullReviewHighlightCategory, setFullReviewHighlightCategory] = useState<CategoryKey | "">("");
  const [completedCategoryKey, setCompletedCategoryKey] = useState<CategoryKey | "">("");
  const [completedCategoryFadeOut, setCompletedCategoryFadeOut] = useState(false);
  const prevHighlightCategoryKeyRef = useRef<CategoryKey | "">("");
  const prevSessionHasActiveCategoryRef = useRef(false);

  const [oppState, setOppState] = useState<OppState | null>(null);
  const [orgStageMappings, setOrgStageMappings] = useState<OrgStageMapping[] | null>(null);
  const orgStageMappingsRef = useRef<OrgStageMapping[] | null>(null);
  const [catSessionId, setCatSessionId] = useState("");
  const [catMessages, setCatMessages] = useState<HandsFreeMessage[]>([]);
  /** When non-null, Full Review is running as a chain; value is current category index in fullReviewChainOrder. */
  const [fullReviewChainIndex, setFullReviewChainIndex] = useState<number | null>(null);
  /** Current category order for this chain run (gated by forecast stage; can change via promotion/demotion). */
  const [fullReviewChainOrder, setFullReviewChainOrder] = useState<CategoryKey[]>([]);
  const [speak, setSpeak] = useState(true);
  const [voice, setVoice] = useState(true);
  const [keepMicOpen, setKeepMicOpen] = useState(true);
  const [confidenceEvidenceOpen, setConfidenceEvidenceOpen] = useState(false);
  const [confidenceEvidenceLoading, setConfidenceEvidenceLoading] = useState(false);
  const [confidenceEvidencePanel, setConfidenceEvidencePanel] = useState<ConfidenceEvidencePanel | null>(null);

  // Mic tune / capture controls (latest, voice-stable path uses mic+STT).
  const [micVadSilenceMs, setMicVadSilenceMs] = useState(1500);
  const [micMinSpeechMs, setMicMinSpeechMs] = useState(350);
  const [micNoSpeechRestartMs, setMicNoSpeechRestartMs] = useState(6000);
  const [micMaxSegmentMs, setMicMaxSegmentMs] = useState(70000);
  const [micRawMode, setMicRawMode] = useState(true);
  const [micGain, setMicGain] = useState(2.5);
  const [autoMicNormalize, setAutoMicNormalize] = useState(true);
  const [micDevices, setMicDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState<string>("");
  const [micOpen, setMicOpen] = useState(false);
  const [micTrackLabel, setMicTrackLabel] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [micPeak, setMicPeak] = useState(0);
  const [micTuneStatus, setMicTuneStatus] = useState("");
  const [micError, setMicError] = useState("");
  const [sttError, setSttError] = useState("");
  const [categorySaveFailed, setCategorySaveFailed] = useState(false);
  const [ttsError, setTtsError] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [sttInFlight, setSttInFlight] = useState(false);
  const [inputInFlight, setInputInFlight] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAudioUrlRef = useRef<string>("");
  const speakingRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const meterRafRef = useRef<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>("");
  const recordStartedAtRef = useRef<number>(0);
  const segmentTimeoutRef = useRef<number | null>(null);

  const lastVoiceAtRef = useRef<number>(0);
  const firstVoiceAtRef = useRef<number>(0);
  const heardVoiceRef = useRef(false);
  const voiceActiveRef = useRef(false);

  const catSessionIdRef = useRef<string>("");
  const selectedCategoryRef = useRef<string>("");
  const isStartingRef = useRef(false);
  const fullReviewChainIndexRef = useRef<number | null>(null);
  const fullReviewChainOrderRef = useRef<CategoryKey[]>([]);
  const fullReviewForecastStageRef = useRef<string>("");
  const fullReviewSalesStageRef = useRef<string>("");
  /** Scores for completed categories in this chain (0–3); used for promotion/demotion. */
  const chainScoresRef = useRef<Record<string, number>>({});
  /** When champion completes with champion_name in response, store for economic_buyer cross-category prompt. */
  const lastChampionFromChainRef = useRef<{ champion_name: string; champion_title?: string } | null>(null);
  /** Accumulated deal signals from completed categories in this chain; passed into Budget and EB as context. */
  const dealContextRef = useRef<{
    pricing_discussed?: boolean;
    po_submitted?: boolean;
    is_also_eb?: boolean;
    champion_name?: string;
    champion_title?: string;
    sole_vendor?: boolean;
    contract_in_place?: boolean;
    existing_customer?: boolean;
    po_process_described?: boolean;
  }>({});

  const micLevelRef = useRef(0);
  const micPeakRef = useRef(0);
  const keepMicOpenRef = useRef(keepMicOpen);
  const categoryWaitingForUserRef = useRef(false);
  const inputInFlightRef = useRef(false);
  const sttInFlightRef = useRef(false);
  /** Last update-category POST body for manual retry after save failure (voice/typed category update). */
  const lastCategoryUpdatePayloadRef = useRef<{
    category: string;
    text: string;
    sessionId?: string;
    deal_context?: typeof dealContextRef.current;
  } | null>(null);
  const routeTranscriptRef = useRef<((text: string, opts?: { skipUserMsg?: boolean }) => Promise<void>) | null>(null);
  const sentenceQueueRef = useRef<string[]>([]);
  const isPlayingSentenceRef = useRef(false);

  useEffect(() => {
    keepMicOpenRef.current = keepMicOpen;
  }, [keepMicOpen]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    catSessionIdRef.current = catSessionId;
  }, [catSessionId]);
  useEffect(() => {
    selectedCategoryRef.current = selectedCategory;
  }, [selectedCategory]);
  useEffect(() => {
    fullReviewChainIndexRef.current = fullReviewChainIndex;
  }, [fullReviewChainIndex]);
  useEffect(() => {
    fullReviewChainOrderRef.current = fullReviewChainOrder;
  }, [fullReviewChainOrder]);

  const categories = useMemo(
    () => [
      // STRICT Master Prompt order (Best Case / Commit)
      { key: "pain" as const },
      { key: "metrics" as const },
      { key: "champion" as const },
      { key: "criteria" as const },
      { key: "competition" as const },
      { key: "timing" as const },
      { key: "budget" as const },
      { key: "economic_buyer" as const },
      { key: "process" as const },
      { key: "paper" as const },
    ],
    []
  );

  const tileRows = useMemo(() => {
    const byCat = new Map<string, any>();
    for (const row of oppState?.categories || []) byCat.set(String(row.category), row);
    return categories.map((c) => {
      const r = byCat?.get(c.key) || {};
      const canonical = (MEDDPICC_CANONICAL as any)[c.key] || { titleLine: c.key, meaningLine: "" };
      return {
        key: c.key,
        catLabel: String(canonical.titleLine || c.key),
        catMeaning: String(canonical.meaningLine || ""),
        score: Number(r.score || 0) || 0,
        scoreLabel: String(r.label || ""),
        tip: String(r.tip || ""),
        evidence: String(r.evidence || ""),
      };
    });
  }, [categories, oppState?.categories]);

  const loadOpportunityState = useCallback(async () => {
    if (!opportunityId) return;
    try {
      const res = await fetch(`/api/deal-review/opportunities/${encodeURIComponent(opportunityId)}/state`, {
        method: "GET",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "State load failed");
      const nextState = json as OppState;
      setOppState(nextState);
      const maybeMappings = (json as any)?.orgStageMappings ?? (json as any)?.org_stage_mappings ?? null;
      if (Array.isArray(maybeMappings)) {
        setOrgStageMappings(
          maybeMappings
            .map((m: any) => ({
              stage_value: String(m?.stage_value ?? "").trim(),
              bucket: String(m?.bucket ?? "").trim(),
            }))
            .filter((m: OrgStageMapping) => m.stage_value && m.bucket)
        );
      }
      return nextState;
    } catch (e: any) {
      // Keep UI alive even if state fails.
      setOppState(null);
      return null;
    }
  }, [opportunityId]);

  const buildCurrentDealReviewEvidence = useCallback((state: OppState | null): ConfidenceEvidencePanel => {
    const categories = (state?.categories || []).map((c) => ({
        category: displayCategoryLabel(c.category),
        score: Number(c.score || 0) || 0,
        evidence: String(c.evidence || "").trim(),
        tip: String(c.tip || "").trim(),
        evidenceStrength: evidenceStrengthLabel((state?.opportunity as any)?.[evidenceStrengthFieldName(c.category)]),
      }));

    return {
      source: "deal_review",
      summary: String(state?.rollup?.risks || "").trim(),
      raw_text: "",
      risk_flags: [],
      next_steps: String(state?.rollup?.next_steps || "")
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
      categories,
    };
  }, []);

  const toggleConfidenceEvidence = useCallback(async () => {
    if (confidenceEvidenceOpen) {
      setConfidenceEvidenceOpen(false);
      return;
    }

    setConfidenceEvidenceLoading(true);
    try {
      const freshState = await loadOpportunityState();
      const liveState = freshState || oppState;
      const commentIngestionId = Number(liveState?.scoring?.evidence?.comment_ingestion_id);

      if (Number.isFinite(commentIngestionId) && commentIngestionId > 0) {
        try {
          const res = await fetch(`/api/comment-ingestions/${commentIngestionId}`, { cache: "no-store" });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.ok) {
            setConfidenceEvidencePanel({
              source: "comment_ingestion",
              summary: String(json.summary || "").trim(),
              raw_text: String(json.raw_text || "").trim(),
              risk_flags: Array.isArray(json.risk_flags) ? json.risk_flags : [],
              next_steps: Array.isArray(json.next_steps) ? json.next_steps.map((s: any) => String(s || "").trim()).filter(Boolean) : [],
              categories: [],
            });
            setConfidenceEvidenceOpen(true);
            return;
          }
        } catch {}
      }

      setConfidenceEvidencePanel(buildCurrentDealReviewEvidence(liveState || null));
      setConfidenceEvidenceOpen(true);
    } finally {
      setConfidenceEvidenceLoading(false);
    }
  }, [buildCurrentDealReviewEvidence, confidenceEvidenceOpen, loadOpportunityState, oppState]);

  useEffect(() => {
    void loadOpportunityState();
  }, [loadOpportunityState]);

  useEffect(() => {
    orgStageMappingsRef.current = orgStageMappings;
  }, [orgStageMappings]);

  const refreshMicDevices = useCallback(async () => {
    try {
      if (!navigator?.mediaDevices?.enumerateDevices) return;
      const ds = await navigator.mediaDevices.enumerateDevices();
      const inputs = ds
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "(microphone)" }));
      setMicDevices(inputs);
      if (!selectedMicDeviceId) {
        const first = inputs[0];
        if (first?.deviceId) setSelectedMicDeviceId(first.deviceId);
      }
    } catch {}
  }, [selectedMicDeviceId]);

  useEffect(() => {
    void refreshMicDevices();
  }, [refreshMicDevices]);

  const closeMicStreamOnly = useCallback(() => {
    console.log(JSON.stringify({ event: "close_mic", keepMicOpen: keepMicOpenRef.current }));
    try {
      if (segmentTimeoutRef.current) {
        window.clearTimeout(segmentTimeoutRef.current);
        segmentTimeoutRef.current = null;
      }
      if (meterRafRef.current) {
        cancelAnimationFrame(meterRafRef.current);
        meterRafRef.current = null;
      }

      // Stop recorder.
      try {
        mediaRecorderRef.current?.stop();
      } catch {}
      mediaRecorderRef.current = null;
      chunksRef.current = [];

      // Stop tracks.
      for (const t of streamRef.current?.getTracks?.() || []) {
        try {
          t.stop();
        } catch {}
      }
      for (const t of processedStreamRef.current?.getTracks?.() || []) {
        try {
          t.stop();
        } catch {}
      }
      streamRef.current = null;
      processedStreamRef.current = null;
      destRef.current = null;
      analyserRef.current = null;
      gainNodeRef.current = null;
      compressorRef.current = null;

      try {
        audioCtxRef.current?.close();
      } catch {}
      audioCtxRef.current = null;

      setMicOpen(false);
      setMicTrackLabel("");
      setMicLevel(0);
      setMicPeak(0);
      micLevelRef.current = 0;
      micPeakRef.current = 0;
      setListening(false);
      voiceActiveRef.current = false;
      heardVoiceRef.current = false;
      firstVoiceAtRef.current = 0;
      lastVoiceAtRef.current = 0;
    } catch (e) {
      console.log(JSON.stringify({ event: "close_mic_error", error: String(e) }));
    }
  }, []);

  const ensureMic = useCallback(async () => {
    const deviceId = selectedMicDeviceId ? { exact: selectedMicDeviceId } : undefined;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: micRawMode
        ? { deviceId, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    } as any);

    streamRef.current = stream;
    const track = stream.getAudioTracks()?.[0] || null;
    const label = String(track?.label || "").trim();
    setMicTrackLabel(label);
    setMicOpen(true);

    // Build processing chain.
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0.5, Math.min(8, Number(micGain) || 2.5));
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const dest = ctx.createMediaStreamDestination();

    src.connect(gain);
    gain.connect(compressor);
    compressor.connect(analyser);
    compressor.connect(dest);

    gainNodeRef.current = gain;
    compressorRef.current = compressor;
    analyserRef.current = analyser;
    destRef.current = dest;
    processedStreamRef.current = dest.stream;

    await refreshMicDevices();
    return { stream, processedStream: dest.stream };
  }, [micGain, micRawMode, refreshMicDevices, selectedMicDeviceId]);

  const startMicMeter = useCallback(() => {
    const a = analyserRef.current;
    const ctx = audioCtxRef.current;
    if (!a || !ctx) return;

    const buf = new Uint8Array(a.fftSize);
    let lastUiAt = 0;

    const tick = () => {
      meterRafRef.current = requestAnimationFrame(tick);
      if (!micOpen || !analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(buf);
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
        const abs = Math.abs(buf[i] - 128);
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      micLevelRef.current = rms;
      micPeakRef.current = peak;

      const now = Date.now();
      if (now - lastUiAt > 90) {
        lastUiAt = now;
        setMicLevel(rms);
        setMicPeak(peak);
      }
    };

    if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
    meterRafRef.current = requestAnimationFrame(tick);
  }, [micOpen]);

  const runMicTune = useCallback(
    async (reason: string) => {
      setMicTuneStatus(`Mic Tune: listening (${reason}) — speak normally for ~2s…`);
      try {
        if (!streamRef.current) await ensureMic();
        startMicMeter();

        const samples: number[] = [];
        const started = Date.now();
        while (Date.now() - started < 2000) {
          samples.push(Number(micPeakRef.current) || 0);
          await new Promise((r) => setTimeout(r, 100));
        }
        const maxPeak = samples.length ? Math.max(...samples) : Number(micPeakRef.current) || 0;
        // Simple heuristic: aim peak ~30-80.
        let next = Number(micGain) || 2.5;
        if (maxPeak < 12) next = Math.min(8, next * 1.6);
        else if (maxPeak < 22) next = Math.min(8, next * 1.25);
        else if (maxPeak > 110) next = Math.max(0.5, next * 0.6);
        else if (maxPeak > 90) next = Math.max(0.5, next * 0.8);
        setMicGain(Number(next.toFixed(1)));
        setMicTuneStatus(`Mic Tune: peak=${maxPeak} → gain=${next.toFixed(1)}x`);
      } catch (e: any) {
        setMicTuneStatus(`Mic Tune failed: ${String(e?.message || e)}`.slice(0, 180));
      }
    },
    [ensureMic, micGain, startMicMeter]
  );

  const primeMicPermissionFromGesture = useCallback(
    async (reason: string) => {
      if (!voice) return;
      setMicError("");
      try {
        if (!streamRef.current) {
          await ensureMic();
        }
        startMicMeter();
        if (autoMicNormalize) void runMicTune(`auto_${reason}`);
      } catch (e: any) {
        setMicError(String(e?.message || e || "Microphone permission error"));
      } finally {
        if (!keepMicOpen) {
          // Close shortly after priming in privacy mode.
          window.setTimeout(() => {
            if (keepMicOpenRef.current) return;
            if (voiceActiveRef.current) return;
            closeMicStreamOnly();
          }, 1200);
        }
      }
    },
    [autoMicNormalize, closeMicStreamOnly, ensureMic, keepMicOpen, runMicTune, startMicMeter, voice]
  );

  const playTts = useCallback(
    async (text: string): Promise<void> => {
      if (!speak) return;
      const t = String(text || "").trim();
      if (!t) return;
      try {
        setTtsError("");
        speakingRef.current = true;
        setSpeaking(true);
        // Stop speech capture while TTS plays.
        voiceActiveRef.current = false;
        setListening(false);

        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: t }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "TTS failed");
        const blob = b64ToBlob(String(json.audio_base64 || ""), String(json.mime || "audio/mpeg"));
        const url = URL.createObjectURL(blob);
        if (lastAudioUrlRef.current) URL.revokeObjectURL(lastAudioUrlRef.current);
        lastAudioUrlRef.current = url;
        const el = audioRef.current;
        if (!el) return;
        el.src = url;
        await new Promise<void>((resolve, reject) => {
          const onEnded = () => {
            el.removeEventListener("ended", onEnded);
            resolve();
          };
          el.addEventListener("ended", onEnded);
          el.play().catch((err) => {
            el.removeEventListener("ended", onEnded);
            reject(err);
          });
        });
      } catch (e: any) {
        setTtsError(String(e?.message || e).slice(0, 220));
        speakingRef.current = false;
        setSpeaking(false);
        throw e;
      } finally {
        speakingRef.current = false;
        setSpeaking(false);
      }
    },
    [speak]
  );

  const drainSentenceQueue = useCallback(async () => {
    if (isPlayingSentenceRef.current) return;
    isPlayingSentenceRef.current = true;
    while (sentenceQueueRef.current.length > 0) {
      const sentence = sentenceQueueRef.current.shift()!;
      try {
        await playTts(sentence);
      } catch {
        /* playTts sets error state */
      }
    }
    isPlayingSentenceRef.current = false;
  }, [playTts]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, []);

  const sendToStt = useCallback(async (blob: Blob) => {
    // STT response already read as res.text() then JSON.parse() here (no res.json()).
    // Previous hardening: body read once, parse failures return stable error; raw SyntaxError never surfaces to UI.
    const readSttResponse = async (
      res: Response
    ): Promise<{ ok: boolean; text?: string; error?: string }> => {
      const t = await res.text();
      const trimmed = (t || "").trim();

      if (!trimmed) {
        return { ok: false, error: "Transcription failed" };
      }

      try {
        return JSON.parse(trimmed) as any;
      } catch {
        // Never surface raw upstream parser errors to UI.
        // Include small safe snippet for diagnostics.
        const head = trimmed.slice(0, 120);
        return {
          ok: false,
          error: "Transcription failed",
        };
      }
    };

    try {
      const mime = blob.type || "audio/webm";
      const ext = mime.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `audio.${ext}`, { type: mime });
      const form = new FormData();
      form.set("file", file, file.name);
      const res = await fetch("/api/stt", { method: "POST", body: form });
      const payload = await readSttResponse(res);
      if (!payload?.ok) {
        throw new Error(`STT: ${payload?.error || "Transcription failed"}`);
      }
      const text = String(payload?.text || "").trim();
      return text;
    } catch (e) {
      console.error("[STT sendToStt] Raw caught error:", e);
      throw e;
    }
  }, []);

  const stopRecorder = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return null;
    return await new Promise<{ blob: Blob; segMs: number; mime: string } | null>((resolve) => {
      const startedAt = recordStartedAtRef.current || Date.now();
      const mime = recorderMimeRef.current || mr.mimeType || "";
      const finalize = () => {
        const segMs = Math.max(0, Date.now() - startedAt);
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        resolve({ blob, segMs, mime });
      };
      mr.onstop = finalize;
      try {
        mr.stop();
      } catch {
        finalize();
      }
    });
  }, []);

  const startRecorder = useCallback(async () => {
    if (mediaRecorderRef.current) return;
    const processed = processedStreamRef.current;
    const raw = streamRef.current;
    const streamToUse = processed || raw;
    if (!streamToUse) throw new Error("No mic stream");

    const mime = pickRecorderMime();
    recorderMimeRef.current = mime;
    const mr = new MediaRecorder(streamToUse, mime ? { mimeType: mime } : undefined);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    recordStartedAtRef.current = Date.now();
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.start();
  }, []);

  const maybeCloseMicForPrivacy = useCallback(() => {
    if (keepMicOpen) return;
    // In privacy mode, close when not actively expecting rep audio.
    if (voiceActiveRef.current) return;
    closeMicStreamOnly();
  }, [closeMicStreamOnly, keepMicOpen]);

  /** When a category completes with a score: if in Full Review chain, advance to next (one TTS from update-category) or finish; else clear chip after 2300ms. */
  const extractDealSignals = useCallback(
    (finalizeJson: any, categoryName: CategoryKey) => {
      switch (categoryName) {
        case "champion":
          return {
            pricing_discussed: finalizeJson?.pricing_discussed ?? false,
            po_submitted: finalizeJson?.po_submitted ?? false,
            is_also_eb: finalizeJson?.is_also_eb ?? false,
            champion_name: finalizeJson?.champion_name,
            champion_title: finalizeJson?.champion_title,
          };
        case "competition":
          return {
            sole_vendor: finalizeJson?.sole_vendor ?? false,
            contract_in_place: finalizeJson?.contract_in_place ?? false,
          };
        case "criteria":
          return {
            existing_customer: finalizeJson?.existing_customer ?? false,
          };
        case "process":
          return {
            po_process_described: finalizeJson?.po_process_described ?? false,
          };
        default:
          return {};
      }
    },
    []
  );

  const onCategoryCompleteInChain = useCallback(
    async (savedCategory: CategoryKey, scoreFromResponse?: number, resultFromResponse?: { champion_name?: string; champion_title?: string } & Record<string, any>) => {
      const idx = fullReviewChainIndexRef.current;
      if (idx === null) {
        setTimeout(() => {
          setCompletedCategoryKey("");
          setSelectedCategory("");
        }, 2300);
        return;
      }
      if (savedCategory === "champion" && resultFromResponse?.champion_name) {
        lastChampionFromChainRef.current = {
          champion_name: String(resultFromResponse.champion_name).trim(),
          champion_title: resultFromResponse.champion_title ? String(resultFromResponse.champion_title).trim() : undefined,
        };
        console.log("cross_category_debug", {
          savedCategory,
          champion_name: lastChampionFromChainRef.current,
          nextCat: fullReviewChainOrderRef.current[fullReviewChainIndexRef.current !== null ? fullReviewChainIndexRef.current + 1 : -1],
        });
      }

      if (resultFromResponse) {
        const mergedSignals = {
          ...dealContextRef.current,
          ...extractDealSignals(resultFromResponse, savedCategory),
        };
        dealContextRef.current = mergedSignals;
      }
      const score = Number(scoreFromResponse);
      if (Number.isFinite(score)) {
        chainScoresRef.current[savedCategory] = Math.max(0, Math.min(3, score));
      }
      let order = [...fullReviewChainOrderRef.current];
      const forecastStage = fullReviewForecastStageRef.current;
      const salesStage = fullReviewSalesStageRef.current;
      const bucket = resolveOpenBucketFromStages(forecastStage, salesStage, orgStageMappingsRef.current);
      const isPipeline = bucket === "pipeline";
      const isBestCaseOrCommit = bucket === "commit" || bucket === "best_case";

      // Score-driven promotion: Pipeline deal, after competition, pain AND metrics both > 50% (score >= 2) → add criteria, process
      if (isPipeline && savedCategory === "competition") {
        const pain = chainScoresRef.current["pain"];
        const metrics = chainScoresRef.current["metrics"];
        if (Number.isFinite(pain) && Number.isFinite(metrics) && pain >= 2 && metrics >= 2) {
          const remaining = order.slice(idx + 1);
          if (!remaining.includes("criteria")) {
            order = [...order.slice(0, idx + 1), "criteria", "process"];
            setFullReviewChainOrder(order);
          }
        }
      }

      // Score-driven demotion: Best Case/Commit, after pain or metrics, pain OR metrics < 30% (score < 1) → remove criteria, process from remaining
      if (isBestCaseOrCommit && (savedCategory === "pain" || savedCategory === "metrics")) {
        const pain = chainScoresRef.current["pain"];
        const metrics = chainScoresRef.current["metrics"];
        if ((Number.isFinite(pain) && pain < 1) || (Number.isFinite(metrics) && metrics < 1)) {
          const before = order.slice(0, idx + 1);
          const remaining = order.slice(idx + 1).filter((c) => c !== "criteria" && c !== "process");
          order = [...before, ...remaining];
          setFullReviewChainOrder(order);
        }
      }

      const nextIdx = idx + 1;
      if (nextIdx >= order.length) {
        try {
          await playTts("That completes this deal review. Please review the risk assessment, next steps, and category tips.");
        } catch {
          /* TTS error already surfaced via setTtsError */
        }
        setFullReviewChainIndex(null);
        setFullReviewChainOrder([]);
        setTimeout(() => {
          setCompletedCategoryKey("");
          setSelectedCategory("");
        }, 2300);
        return;
      }
      setBusy(true);
      try {
        const nextCat = order[nextIdx];
        setFullReviewChainIndex(nextIdx);
        setSelectedCategory(nextCat);
        setCatSessionId("");
        const championCtx = nextCat === "economic_buyer" ? lastChampionFromChainRef.current : null;
        const postBody: {
          category: string;
          sessionId: undefined;
          text: string;
          cross_category_context?: { champion_name: string; champion_title?: string };
          deal_context?: typeof dealContextRef.current;
        } = {
          category: nextCat,
          sessionId: undefined,
          text: "",
        };
        if (championCtx?.champion_name) {
          postBody.cross_category_context = {
            champion_name: championCtx.champion_name,
            ...(championCtx.champion_title ? { champion_title: championCtx.champion_title } : {}),
          };
        }
        if ((nextCat === "budget" || nextCat === "economic_buyer") && dealContextRef.current) {
          postBody.deal_context = dealContextRef.current;
        }
        console.log("cross_category_debug", {
          savedCategory,
          champion_name: lastChampionFromChainRef.current,
          nextCat,
          requestBody: postBody,
        });
        const res = await fetch(`/api/deal-review/opportunities/${encodeURIComponent(opportunityId!)}/update-category`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postBody),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Next category failed");
        if (json?.sessionId) setCatSessionId(String(json.sessionId));
        const rawAssistantText = String(json?.assistantText ?? "").trim();
        if (rawAssistantText) {
          setCatMessages((prev) => [...prev, { role: "assistant", text: rawAssistantText, at: Date.now() }]);
          if (voice) await playTts(rawAssistantText);
        }
      } catch (e: any) {
        setCatMessages((prev) => [...prev, { role: "system", text: String(e?.message || e), at: Date.now() }]);
        setFullReviewChainIndex(null);
        setFullReviewChainOrder([]);
      } finally {
        setBusy(false);
      }
    },
    [opportunityId, playTts]
  );

  const captureOneUtteranceAndRoute = useCallback(async () => {
    if (inputInFlightRef.current || sttInFlightRef.current) return;
    if (!voice) return;
    if (speakingRef.current) return;
    if (voiceActiveRef.current) return;
    voiceActiveRef.current = true;
    setListening(true);
    setSttError("");

    try {
      if (!streamRef.current) await ensureMic();
      startMicMeter();

      const SILENCE_MS = Math.max(200, Number(micVadSilenceMs) || 650);
      const MIN_SPEECH_MS = Math.max(200, Number(micMinSpeechMs) || 350);
      const NO_SPEECH_RESTART_MS = Math.max(800, Number(micNoSpeechRestartMs) || 3500);
      const MAX_SEGMENT_MS = Math.max(1500, Number(micMaxSegmentMs) || 12000);
      const THRESH = 0.01; // simple RMS threshold; mic tune + gain makes this workable

      heardVoiceRef.current = false;
      lastVoiceAtRef.current = 0;
      firstVoiceAtRef.current = 0;

      const failCapture = (e: any) => {
        try {
          setSttError(String(e?.message || e).slice(0, 300));
        } catch {
          setSttError("STT failed");
        }
        voiceActiveRef.current = false;
        setListening(false);
        maybeCloseMicForPrivacy();
      };

      // VAD loop drives recording start/stop.
      const started = Date.now();
      let recording = false;

      const stopAll = async () => {
        if (segmentTimeoutRef.current) {
          window.clearTimeout(segmentTimeoutRef.current);
          segmentTimeoutRef.current = null;
        }
        if (recording) {
          const rec = await stopRecorder();
          recording = false;
          return rec;
        }
        return null;
      };

      const routeTranscript = async (text: string, opts?: { skipUserMsg?: boolean }) => {
        sttInFlightRef.current = false;
        setSttInFlight(false);
        inputInFlightRef.current = true;
        setInputInFlight(true);
        try {
          setLastTranscript(text);
          const now = Date.now();
          const msg: HandsFreeMessage = { role: "user", text, at: now };

          if (mode === "CATEGORY_UPDATE") {
            const cat = String(selectedCategoryRef.current || "").trim();
            if (!cat) return;
            const sid = String(catSessionIdRef.current || "").trim();
            if (!opts?.skipUserMsg) {
              setCatMessages((prev) => [...prev, msg]);
            }
            const baseBody: {
              category: string;
              text: string;
              sessionId?: string;
              deal_context?: typeof dealContextRef.current;
            } = {
              category: cat,
              text,
              sessionId: sid || undefined,
            };
            if ((cat === "budget" || cat === "economic_buyer") && dealContextRef.current) {
              baseBody.deal_context = dealContextRef.current;
            }
            lastCategoryUpdatePayloadRef.current = {
              category: cat,
              text,
              sessionId: baseBody.sessionId,
              deal_context: baseBody.deal_context,
            };
            const updateCategoryUrl = `/api/deal-review/opportunities/${encodeURIComponent(opportunityId)}/update-category`;
            const updateCategoryInit: RequestInit = {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(baseBody),
            };
            try {
              setCategorySaveFailed(false);
              let res = await fetchUpdateCategoryWithSilentRetry(updateCategoryUrl, updateCategoryInit);
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("text/event-stream")) {
            const runSseOnce = async (resIn: Response) => {
            // Latency-layer: SSE streaming with sentence chunking. Play sentences sequentially.
            const reader = resIn.body?.getReader();
            if (!reader) throw new Error("No response body");
            const decoder = new TextDecoder();
            let buffer = "";
            const sentenceQueue: string[] = [];
            let playing = false;
            const playNext = async () => {
              if (playing || sentenceQueue.length === 0) return;
              playing = true;
              const sentence = sentenceQueue.shift()!;
              try {
                if (voice) {
                  await playTts(sentence);
                }
              } catch {
                /* playTts sets error state */
              }
              playing = false;
              if (sentenceQueue.length > 0) void playNext();
            };
            let donePayload: Record<string, unknown> | null = null;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const { messages: batch, remaining } = parseSSE(buffer);
              buffer = remaining;
              for (const data of batch) {
                if (data?.type === "error") throw new Error((data.error as string) || "Update failed");
                if (data?.type === "sentence" && typeof data.text === "string") {
                  sentenceQueue.push(String(data.text).trim());
                  void playNext();
                } else if (data?.type === "done") {
                  donePayload = data;
                  const rem = String((data as any)?.remainingText || "").trim();
                  if (rem) {
                    sentenceQueue.push(rem);
                    void playNext();
                  }
                }
              }
            }
            const { messages: flush, remaining: tail } = parseSSE(buffer);
            for (const data of flush) {
              if (data?.type === "error") throw new Error((data.error as string) || "Update failed");
              if (data?.type === "done") donePayload = data;
            }
            if (tail.trim() !== "" && DEBUG_SSE && typeof console !== "undefined") {
              console.warn("[SSE] Incomplete tail", tail.slice(-512));
            }
            if (!donePayload?.ok) throw new Error((donePayload as any)?.error || "Update failed");
            if (donePayload?.sessionId) setCatSessionId(String(donePayload.sessionId));
            const assistantText = String((donePayload as any)?.assistantText || "").trim();
            if (assistantText) {
              setCatMessages((prev) => [...prev, { role: "assistant", text: assistantText, at: Date.now() }]);
            }
            void loadOpportunityState();
            if (donePayload?.material_change === undefined && sentenceQueue.length === 0) {
              if (voice) void playTts(assistantText);
            }
            if (donePayload?.material_change !== undefined) {
              const savedCategory = cat as CategoryKey;
              setCompletedCategoryKey(savedCategory);
              const result = (donePayload as any)?.result;
              const score = result?.score;
              // Ensure all TTS sentences have finished playing before advancing to the next category.
              if (sentenceQueue.length > 0 && !playing) {
                void playNext();
              }
              while (sentenceQueue.length > 0 || playing) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              void onCategoryCompleteInChain(savedCategory, Number(score), result);
            }
            };
            try {
              await runSseOnce(res);
            } catch {
              await new Promise((r) => setTimeout(r, UPDATE_CATEGORY_RETRY_MS));
              const res2 = await fetch(updateCategoryUrl, updateCategoryInit);
              if (!res2.ok) throw new Error("Update failed");
              await runSseOnce(res2);
            }
            return;
          }
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json?.ok) {
            if (json?.error === "Unknown sessionId") {
              catSessionIdRef.current = "";
              setCatSessionId("");
              const retryBody: {
                category: string;
                text: string;
                deal_context?: typeof dealContextRef.current;
              } = { category: cat, text };
              if ((cat === "budget" || cat === "economic_buyer") && dealContextRef.current) {
                retryBody.deal_context = dealContextRef.current;
              }
              const retryRes = await fetchUpdateCategoryWithSilentRetry(updateCategoryUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(retryBody),
              });
              const retryJson = await retryRes.json().catch(() => ({}));
              if (!retryRes.ok || !retryJson?.ok) {
                void loadOpportunityState();
                setCategorySaveFailed(true);
                setSttError("");
                setCompletedCategoryKey("");
                return;
              }
              if (retryJson?.sessionId) setCatSessionId(String(retryJson.sessionId));
              const retryAssistantText = String(retryJson?.assistantText || "").trim();
              if (retryAssistantText) {
                setCatMessages((prev) => [...prev, { role: "assistant", text: retryAssistantText, at: Date.now() }]);
                if (voice) void playTts(retryAssistantText);
              }
              void loadOpportunityState();
              return;
            }
            throw new Error(json?.error || "Update failed");
          }
          if (json?.sessionId) setCatSessionId(String(json.sessionId));
          const assistantText = String(json?.assistantText || "").trim();
          if (assistantText) {
            setCatMessages((prev) => [...prev, { role: "assistant", text: assistantText, at: Date.now() }]);
            if (voice) await playTts(assistantText);
          }
          void loadOpportunityState();
          if (json?.material_change !== undefined) {
            const savedCategory = cat as CategoryKey;
            setCompletedCategoryKey(savedCategory);
            const result = (json as any)?.result;
            const score = result?.score;
            void onCategoryCompleteInChain(savedCategory, Number(score), result);
          }
            } catch {
              void loadOpportunityState();
              setCategorySaveFailed(true);
              setSttError("");
              setCompletedCategoryKey("");
              return;
            }
          }
        } finally {
          inputInFlightRef.current = false;
          setInputInFlight(false);
        }
      };

      routeTranscriptRef.current = routeTranscript;

      const loop = async () => {
        if (!voiceActiveRef.current) return;
        if (speakingRef.current) return;

        const now = Date.now();
        const rms = Number(micLevelRef.current) || 0;
        const hasEnergy = rms >= THRESH;
        if (hasEnergy) {
          if (!heardVoiceRef.current) firstVoiceAtRef.current = now;
          heardVoiceRef.current = true;
          lastVoiceAtRef.current = now;
          if (!recording) {
            await startRecorder();
            recording = true;
          }
        }

        const heard = heardVoiceRef.current;
        const first = firstVoiceAtRef.current || 0;
        const last = lastVoiceAtRef.current || 0;

        const durOk = heard && first && now - first >= MIN_SPEECH_MS;
        const silentLongEnough = heard && last && now - last >= SILENCE_MS;

        if (recording && durOk && silentLongEnough) {
          const rec = await stopAll();
          voiceActiveRef.current = false;
          setListening(false);
          if (!rec) return;
          sttInFlightRef.current = true;
          setSttInFlight(true);
          const transcript = await sendToStt(rec.blob);
          if (!transcript) {
            sttInFlightRef.current = false;
            setSttInFlight(false);
            voiceActiveRef.current = false;
            setListening(false);
            setSttError("Empty transcript (check mic/tune and try again)");
            maybeCloseMicForPrivacy();
            window.setTimeout(() => {
              if (categoryWaitingForUserRef.current && !speakingRef.current) {
                void captureOneUtteranceAndRoute();
              }
            }, 500);
            return;
          }
          await routeTranscript(transcript);
          maybeCloseMicForPrivacy();
          return;
        }

        if (!heard && now - started >= NO_SPEECH_RESTART_MS) {
          // No speech detected at all.
          await stopAll();
          voiceActiveRef.current = false;
          setListening(false);
          setSttError("No microphone input detected. Check mic device/permissions or click Prime mic now.");
          maybeCloseMicForPrivacy();
          if (
            voiceActiveRef.current === false &&
            !inputInFlightRef.current &&
            !sttInFlightRef.current &&
            categoryWaitingForUserRef.current
          ) {
            void captureOneUtteranceAndRoute();
          }
          return;
        }

        // Keep segment bounded even if someone talks forever.
        if (now - started >= MAX_SEGMENT_MS) {
          const rec = await stopAll();
          voiceActiveRef.current = false;
          setListening(false);
          if (!rec) return;
          sttInFlightRef.current = true;
          setSttInFlight(true);
          const transcript = await sendToStt(rec.blob);
          if (!transcript) {
            sttInFlightRef.current = false;
            setSttInFlight(false);
            voiceActiveRef.current = false;
            setListening(false);
            setSttError("Empty transcript (max segment reached)");
            maybeCloseMicForPrivacy();
            window.setTimeout(() => {
              if (categoryWaitingForUserRef.current && !speakingRef.current) {
                void captureOneUtteranceAndRoute();
              }
            }, 500);
            return;
          }
          await routeTranscript(transcript);
          maybeCloseMicForPrivacy();
          return;
        }

        // IMPORTANT: loop runs off RAF; catch to avoid unhandled promise rejections.
        meterRafRef.current = requestAnimationFrame(() => {
          void loop().catch(failCapture);
        });
      };

      if (segmentTimeoutRef.current) window.clearTimeout(segmentTimeoutRef.current);
      segmentTimeoutRef.current = window.setTimeout(() => {
        // Hard stop fallback.
        void stopAll().finally(() => {
          voiceActiveRef.current = false;
          setListening(false);
          maybeCloseMicForPrivacy();
          if (
            voiceActiveRef.current === false &&
            !inputInFlightRef.current &&
            !sttInFlightRef.current &&
            categoryWaitingForUserRef.current
          ) {
            void captureOneUtteranceAndRoute();
          }
        });
      }, Number(micMaxSegmentMs) || 70000);

      await loop().catch(failCapture);
    } catch (e: any) {
      inputInFlightRef.current = false;
      sttInFlightRef.current = false;
      setInputInFlight(false);
      setSttInFlight(false);
      const msg = String(e?.message || e).slice(0, 300);
      setSttError(msg);
      voiceActiveRef.current = false;
      setListening(false);
      maybeCloseMicForPrivacy();
    }
  }, [
    drainSentenceQueue,
    ensureMic,
    loadOpportunityState,
    maybeCloseMicForPrivacy,
    micMaxSegmentMs,
    micMinSpeechMs,
    micNoSpeechRestartMs,
    micVadSilenceMs,
    mode,
    onCategoryCompleteInChain,
    opportunityId,
    playTts,
    sendToStt,
    startMicMeter,
    startRecorder,
    stopRecorder,
    voice,
  ]);

  const retryLastCategorySave = useCallback(async () => {
    const p = lastCategoryUpdatePayloadRef.current;
    if (!p?.text) return;
    setCategorySaveFailed(false);
    const rt = routeTranscriptRef.current;
    if (!rt) return;
    await rt(p.text, { skipUserMsg: true });
  }, []);

  // Category update: if waiting (last assistant asked a question), capture voice.
  const categoryWaitingForUser = useMemo(() => {
    if (mode !== "CATEGORY_UPDATE") return false;
    if (!selectedCategory) return false;
    const msgs = Array.isArray(catMessages) ? catMessages : [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return false;
    const lastLine = String(lastAssistant.text || "").trim().split("\n").map((l) => l.trim()).filter(Boolean).at(-1) || "";
    if (!lastLine) return false;
    return lastLine.endsWith("?") || /\b(tell me|walk me through|describe|confirm|what|who|how)\b/i.test(lastLine);
  }, [catMessages, mode, selectedCategory]);

  useEffect(() => {
    categoryWaitingForUserRef.current = categoryWaitingForUser;
  }, [categoryWaitingForUser]);

  const micIndicatorState = useMemo<"matthew_speaking" | "processing" | "your_turn" | "idle">(() => {
    if (speaking) return "matthew_speaking";
    if (sttInFlight || inputInFlight) return "processing";
    if (categoryWaitingForUser && voice) return "your_turn";
    return "idle";
  }, [speaking, sttInFlight, inputInFlight, categoryWaitingForUser, voice]);

  const micIndicatorLabel = useMemo(() => {
    switch (micIndicatorState) {
      case "matthew_speaking":
        return "Matthew is speaking...";
      case "processing":
        return "Analyzing...";
      case "your_turn":
        return "Your turn — speak now";
      case "idle":
      default:
        return "Idle";
    }
  }, [micIndicatorState]);

  const fullReviewButtonLabel = useMemo(() => {
    const stage = String(oppState?.opportunity?.forecast_stage ?? oppState?.opportunity?.forecastStage ?? "").trim();
    const lower = stage.toLowerCase();
    const isBestCaseOrCommit = lower.includes("commit") || lower.includes("best case") || lower.includes("bestcase");
    if (isBestCaseOrCommit) return "Full Review: All MEDDPICC + Timing & Budget Categories";
    if (stage === "") return "Full Review: All MEDDPICC + Timing & Budget Categories";
    return "Quick Review: Pain, Metrics, Champion, Competition & Budget";
  }, [oppState?.opportunity]);

  useEffect(() => {
    // IMPORTANT: Text Update must never auto-open the mic.
    // Depend on speaking (state) so we re-run when TTS finishes and can start listening.
    if (categoryWaitingForUser && voice && categoryInputMode === "VOICE" && !speaking) {
      void captureOneUtteranceAndRoute();
    }
  }, [captureOneUtteranceAndRoute, categoryInputMode, categoryWaitingForUser, voice, speaking]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!voice) {
      closeMicStreamOnly();
    }
  }, [closeMicStreamOnly, voice]);

  const startFullDealReview = useCallback(async () => {
    if (!opportunityId) return;
    if (isStartingRef.current) return;
    const opportunity = oppState?.opportunity ?? null;
    const forecastStage = String(
      (opportunity as any)?.forecast_stage ?? (opportunity as any)?.forecastStage ?? ""
    ).trim();
    const salesStage = String((opportunity as any)?.sales_stage ?? (opportunity as any)?.salesStage ?? "").trim();
    const crmBucket = String((opportunity as any)?.crm_bucket ?? (opportunity as any)?.crmBucket ?? "").trim();
    const effectiveMappings =
      crmBucket && forecastStage
        ? ([{ stage_value: forecastStage, bucket: crmBucket }, ...(orgStageMappingsRef.current || [])] as OrgStageMapping[])
        : (orgStageMappingsRef.current as OrgStageMapping[] | null) || undefined;
    const initialChain = buildInitialChain(forecastStage, salesStage, effectiveMappings);
    console.log(
      JSON.stringify({
        event: "chain_gating",
        forecast_stage: forecastStage || "(unknown)",
        initial_chain: initialChain,
        final_chain: initialChain,
      })
    );
    isStartingRef.current = true;
    setBusy(true);
    chainScoresRef.current = {};
    fullReviewForecastStageRef.current = forecastStage;
    fullReviewSalesStageRef.current = salesStage;
    setFullReviewChainOrder(initialChain);
    setFullReviewChainIndex(0);
    setCatMessages([]);
    setCatSessionId("");
    setSelectedCategory(initialChain[0]);
    setQaPaneOpen(false);
    setCategoryInputMode("VOICE");
    setSttError("");
    setTtsError("");
    try {
      await primeMicPermissionFromGesture("full_review");
      setMode("CATEGORY_UPDATE");
      setVoice(true);
      const repName = (oppState?.opportunity?.rep_name ?? "").trim().split(/\s+/)[0] ?? "";
      const accountName = (oppState?.opportunity?.account_name ?? "").trim();
      const opportunityName = (oppState?.opportunity?.opportunity_name ?? "").trim();
      const healthScore = oppState?.opportunity?.health_score;
      const isReturning = typeof healthScore === "number" && healthScore > 0;
      const dealLabel = [accountName, opportunityName].filter(Boolean).join(" — ");
      let greeting: string;
      if (isReturning) {
        const base = dealLabel
          ? `Let's review ${dealLabel}. I'll walk you through the deal components, please provide any details for each category. One moment.`
          : "I'll walk you through the deal components, please provide any details for each category. One moment.";
        greeting = repName ? `Hi ${repName}, welcome back. ${base}` : `Welcome back. ${base}`;
      } else {
        const base = dealLabel
          ? `let's review ${dealLabel}. I'll walk you through the deal components, please provide any details for each category. One moment.`
          : "Let's review. I'll walk you through the deal components, please provide any details for each category. One moment.";
        greeting = repName ? `Hi ${repName}, ${base}` : base.charAt(0).toUpperCase() + base.slice(1);
      }
      await playTts(greeting);
      const res = await fetch(`/api/deal-review/opportunities/${encodeURIComponent(opportunityId)}/update-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: initialChain[0], sessionId: undefined, text: "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Full deal review failed");
      if (json?.sessionId) setCatSessionId(String(json.sessionId));
      const rawAssistantText = String(json?.assistantText ?? "").trim();
      if (rawAssistantText) {
        setCatMessages([{ role: "assistant", text: rawAssistantText, at: Date.now() }]);
        void playTts(rawAssistantText);
      }
    } catch (e: any) {
      setFullReviewChainIndex(null);
      setFullReviewChainOrder([]);
      setCatMessages([{ role: "system", text: String(e?.message || e), at: Date.now() }]);
    } finally {
      isStartingRef.current = false;
      setBusy(false);
    }
  }, [opportunityId, oppState?.opportunity, playTts, primeMicPermissionFromGesture]);

  const stopNow = useCallback(async () => {
    setBusy(true);
    try {
      setFullReviewChainIndex(null);
      setFullReviewChainOrder([]);
      chainScoresRef.current = {};
      setMode("FULL_REVIEW");
      setSelectedCategory("");
      setCatSessionId("");
      setCatMessages([]);
      setQaPaneOpen(false);
      setCategoryInputMode("VOICE");
      setFullReviewHighlightCategory("");
    } finally {
      setBusy(false);
      closeMicStreamOnly();
    }
  }, [closeMicStreamOnly]);

  const startCategoryUpdate = useCallback(
    async (categoryKey: CategoryKey, wantVoice: boolean) => {
      if (!opportunityId) return;
      setBusy(true);
      setMode("CATEGORY_UPDATE");
      setSelectedCategory(categoryKey);
      setCatSessionId("");
      setCatMessages([]);
      setSttError("");
      setTtsError("");
      // Text update uses the slide-out Q&A drawer. Voice update stays voice-only (no text panel).
      setQaPaneOpen(!wantVoice);
      setCategoryInputMode(wantVoice ? "VOICE" : "TEXT");

      // In Text mode, do not prime/hold the mic open.
      if (!wantVoice) {
        voiceActiveRef.current = false;
        setListening(false);
        closeMicStreamOnly();
        // Typed updates are silent: stop any in-flight audio.
        try {
          const el = audioRef.current;
          if (el) {
            el.pause();
            el.currentTime = 0;
          }
        } catch {}
        speakingRef.current = false;
      }
      if (wantVoice) setVoice(true);
      try {
        if (wantVoice) {
          await primeMicPermissionFromGesture(`category_${categoryKey}`);
        }
        const res = await fetch(`/api/deal-review/opportunities/${encodeURIComponent(opportunityId)}/update-category`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: categoryKey, sessionId: undefined, text: "" }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Update start failed");
        if (json?.sessionId) setCatSessionId(String(json.sessionId));
        const rawAssistantText = String(json?.assistantText || "").trim();
        const assistantText = wantVoice ? rawAssistantText : stripPercentCalloutsForTypedUpdate(rawAssistantText);
        if (assistantText) {
          setCatMessages([{ role: "assistant", text: assistantText, at: Date.now() }]);
          if (wantVoice) void playTts(assistantText);
        }
      } catch (e: any) {
        setCatMessages([{ role: "system", text: String(e?.message || e), at: Date.now() }]);
      } finally {
        setBusy(false);
      }
    },
    [closeMicStreamOnly, opportunityId, playTts, primeMicPermissionFromGesture]
  );

  const initialAppliedRef = useRef(false);
  useEffect(() => {
    if (!mounted || !opportunityId || !initialCategory || initialAppliedRef.current) return;
    const cat = initialCategory as CategoryKey;
    if (!VALID_CATEGORIES.includes(cat)) return;
    initialAppliedRef.current = true;
    if (initialPrefill) setAnswer(initialPrefill);
    void startCategoryUpdate(cat, false);
  }, [mounted, opportunityId, initialCategory, initialPrefill, startCategoryUpdate]);

  const sendAnswer = useCallback(async () => {
    const text = String(answer || "").trim();
    if (!text) return;
    setAnswer("");
    setBusy(true);
    setSttError("");
    try {
      if (mode === "CATEGORY_UPDATE") {
        if (!selectedCategory) return;
        const res = await fetch(`/api/deal-review/opportunities/${encodeURIComponent(opportunityId)}/update-category`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: selectedCategory, text, sessionId: catSessionId || undefined }),
        });
        setCatMessages((prev) => [...prev, { role: "user", text, at: Date.now() }]);
        const contentType = res.headers.get("content-type") || "";
        let responsePayload: Record<string, unknown> | null = null;
        if (contentType.includes("text/event-stream")) {
          const reader = res.body?.getReader();
          if (!reader) throw new Error("No response body");
          const decoder = new TextDecoder();
          let buffer = "";
          const sentenceQueue: string[] = [];
          let playing = false;
          const playNext = async () => {
            if (playing || sentenceQueue.length === 0) return;
            playing = true;
            const sentence = sentenceQueue.shift()!;
            try {
              if (voice) {
                await playTts(sentence);
              }
            } catch {
              /* playTts sets error state */
            }
            playing = false;
            if (sentenceQueue.length > 0) void playNext();
          };
          let donePayload: Record<string, unknown> | null = null;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { messages: batch, remaining } = parseSSE(buffer);
            buffer = remaining;
            for (const data of batch) {
              if (data?.type === "error") throw new Error((data.error as string) || "Update failed");
              if (data?.type === "sentence" && typeof data.text === "string" && categoryInputMode === "VOICE") {
                sentenceQueue.push(String(data.text).trim());
                void playNext();
              } else if (data?.type === "done") {
                donePayload = data;
                const rem = String((data as any)?.remainingText || "").trim();
                if (rem && categoryInputMode === "VOICE") {
                  sentenceQueue.push(rem);
                  void playNext();
                }
              }
            }
          }
          const { messages: flush, remaining: tail } = parseSSE(buffer);
          for (const data of flush) {
            if (data?.type === "error") throw new Error((data.error as string) || "Update failed");
            if (data?.type === "done") donePayload = data;
          }
          if (tail.trim() !== "" && DEBUG_SSE && typeof console !== "undefined") {
            console.warn("[SSE] Incomplete tail", tail.slice(-512));
          }
          if (!donePayload?.ok) throw new Error((donePayload as any)?.error || "Update failed");
          if (donePayload?.sessionId) setCatSessionId(String(donePayload.sessionId));
          const rawAssistantText = String((donePayload as any)?.assistantText || "").trim();
          const assistantText =
            categoryInputMode === "TEXT" ? stripPercentCalloutsForTypedUpdate(rawAssistantText) : rawAssistantText;
          if (assistantText) {
            setCatMessages((prev) => [...prev, { role: "assistant", text: assistantText, at: Date.now() }]);
          }
          if (donePayload?.material_change === undefined && sentenceQueue.length === 0) {
            if (voice && categoryInputMode === "VOICE") void playTts(assistantText);
          }
          responsePayload = donePayload;
        } else {
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json?.ok) throw new Error(json?.error || "Update failed");
          if (json?.sessionId) setCatSessionId(String(json.sessionId));
          const rawAssistantText = String(json?.assistantText || "").trim();
          const assistantText =
            categoryInputMode === "TEXT" ? stripPercentCalloutsForTypedUpdate(rawAssistantText) : rawAssistantText;
          if (assistantText) {
            setCatMessages((prev) => [...prev, { role: "assistant", text: assistantText, at: Date.now() }]);
            if (categoryInputMode === "VOICE" && voice) void playTts(assistantText);
          }
          responsePayload = json;
        }
        void loadOpportunityState();
        if (responsePayload?.material_change !== undefined) {
          const savedCategory = selectedCategory;
          setCompletedCategoryKey(savedCategory);
          const result = (responsePayload as any)?.result;
          const score = result?.score;
          void onCategoryCompleteInChain(savedCategory, Number(score), result);
        }
        return;
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      setCatMessages((prev) => [...prev, { role: "system", text: msg, at: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }, [answer, catSessionId, loadOpportunityState, mode, opportunityId, playTts, selectedCategory]);

  const resetUi = useCallback(() => {
    setFullReviewChainIndex(null);
    setFullReviewChainOrder([]);
    chainScoresRef.current = {};
    setMode("FULL_REVIEW");
    setSelectedCategory("");
    setCatSessionId("");
    setCatMessages([]);
    setAnswer("");
    setQaPaneOpen(false);
    setCategoryInputMode("VOICE");
    setFullReviewHighlightCategory("");
    setSttError("");
    setCategorySaveFailed(false);
    setTtsError("");
    setMicTuneStatus("");
    closeMicStreamOnly();
    void loadOpportunityState();
  }, [closeMicStreamOnly, loadOpportunityState]);

  const opportunity = oppState?.opportunity || null;
  const rollup = oppState?.rollup || null;
  const healthPercent = oppState?.healthPercent ?? null;
  const scoring = oppState?.scoring ?? null;

  const accountName = String(opportunity?.account_name || opportunity?.accountName || "");
  const oppName = String(opportunity?.opportunity_name || opportunity?.opportunityName || "");
  const closeDateStr = dateOnly(opportunity?.close_date || opportunity?.closeDate);
  const forecastStage = String(opportunity?.forecast_stage || opportunity?.forecastStage || "");
  const repName = String(opportunity?.rep_name || opportunity?.repName || "");
  const championName = String(opportunity?.champion_name || "");
  const championTitle = String(opportunity?.champion_title || "");
  const ebName = String(opportunity?.eb_name || "");
  const ebTitle = String(opportunity?.eb_title || "");
  const partnerName = String(opportunity?.partner_name || (opportunity as any)?.partnerName || "");
  const dealRegistrationRaw = (opportunity as any)?.deal_registration ?? (opportunity as any)?.dealRegistration;
  const dealRegistration = dealRegistrationRaw === true || dealRegistrationRaw === false ? dealRegistrationRaw : null;
  const dealRegDateRaw = (opportunity as any)?.deal_reg_date ?? (opportunity as any)?.dealRegDate;
  const dealRegDate = dateOnly(dealRegDateRaw) || null;
  const dealRegId = String((opportunity as any)?.deal_reg_id ?? (opportunity as any)?.dealRegId ?? "").trim() || null;
  const aiForecast = String(opportunity?.ai_verdict || opportunity?.ai_forecast || "");

  // Derived: registered if boolean true OR date present OR ID present
  const isRegistered = dealRegistration === true || !!dealRegDate || !!dealRegId;

  // Display priority: ID > Date > Boolean
  const dealRegDisplay = dealRegId
    ? `Registered — ${dealRegId}`
    : dealRegDate
      ? `Registered — ${dealRegDate}`
      : isRegistered
        ? "Registered"
        : dealRegistration === false
          ? "Not registered"
          : "—";

  const activeMessages = catMessages;
  const highlightCategoryKey = (mode === "CATEGORY_UPDATE" ? selectedCategory : fullReviewHighlightCategory) as CategoryKey | "";
  const sessionHasActiveCategory = mode === "CATEGORY_UPDATE" && !!selectedCategory;

  // Display-only: show "complete" chip on the category that just lost focus for 2s then fade out 300ms.
  // Trigger 1: highlightCategoryKey changed to a different category → show complete on previous.
  // Trigger 2: session ended (sessionHasActiveCategory true → false) with a non-empty highlight → show complete on that category.
  useEffect(() => {
    const prevHighlight = prevHighlightCategoryKeyRef.current;
    const prevSessionActive = prevSessionHasActiveCategoryRef.current;

    const showCompleteOn = (key: CategoryKey) => {
      setCompletedCategoryKey(key);
      setCompletedCategoryFadeOut(false);
      const t1 = window.setTimeout(() => setCompletedCategoryFadeOut(true), 2000);
      const t2 = window.setTimeout(() => {
        setCompletedCategoryKey("");
        setCompletedCategoryFadeOut(false);
      }, 2300);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    };

    if (prevHighlight !== highlightCategoryKey && prevHighlight) {
      const cleanup = showCompleteOn(prevHighlight);
      prevHighlightCategoryKeyRef.current = highlightCategoryKey;
      prevSessionHasActiveCategoryRef.current = sessionHasActiveCategory;
      return cleanup;
    }

    if (prevSessionActive && !sessionHasActiveCategory && highlightCategoryKey) {
      const cleanup = showCompleteOn(highlightCategoryKey);
      prevHighlightCategoryKeyRef.current = highlightCategoryKey;
      prevSessionHasActiveCategoryRef.current = sessionHasActiveCategory;
      return cleanup;
    }

    prevHighlightCategoryKeyRef.current = highlightCategoryKey;
    prevSessionHasActiveCategoryRef.current = sessionHasActiveCategory;
  }, [highlightCategoryKey, sessionHasActiveCategory]);

  const qaDrawerOpen = mode === "CATEGORY_UPDATE" && qaPaneOpen;
  const qaCanonical = selectedCategory ? (MEDDPICC_CANONICAL as any)[selectedCategory] : null;

  return (
    <main className="wrap">
      {/* Slide-out drawer for Text/Voice category updates */}
      {!readOnly && qaDrawerOpen ? (
        <div
          className={`qaOverlay ${qaDrawerOpen ? "open" : ""}`}
          onClick={() => {
            // Click outside closes the drawer (keeps the deal review page).
            setQaPaneOpen(false);
          }}
        />
      ) : null}
      {!readOnly ? (
      <aside className={`qaDrawer ${qaDrawerOpen ? "open" : ""}`} aria-hidden={!qaDrawerOpen}>
        <div className="qaHdr">
          <div className="qaTitleBlock">
            <div className="qaTitleLine">{String(qaCanonical?.titleLine || "").trim() || "Category Update"}</div>
            <div className="qaMeaningLine">{String(qaCanonical?.meaningLine || "").trim() || ""}</div>
          </div>
          <div className="qaMeta">
            <button
              className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
              onClick={() => {
                setQaPaneOpen(false);
                setAnswer("");
                setCatMessages([]);
                setCatSessionId("");
                setSelectedCategory("");
                setMode("FULL_REVIEW");
              }}
              disabled={busy}
            >
              Close
            </button>
          </div>
        </div>

        <div className="qaBody">
          <div className="chat" style={{ marginTop: 0, maxHeight: "none" }}>
            {activeMessages?.length ? (
              activeMessages.map((m, i) => {
                const isLastAssistantFollowUp =
                  i === activeMessages.length - 1 && m.role === "assistant" && activeMessages.length > 1;
                return (
                  <div
                    key={`${m.at}-${i}`}
                    className="msg"
                    style={
                      isLastAssistantFollowUp
                        ? {
                            borderLeft: "3px solid #F1C40F",
                            backgroundColor: "rgba(241, 196, 15, 0.06)",
                            paddingLeft: 10,
                          }
                        : undefined
                    }
                  >
                    <div className="msgMeta">
                      <strong className={`role ${m.role}`}>{m.role.toUpperCase()}</strong> ·{" "}
                      {new Date(m.at).toLocaleTimeString()}
                    </div>
                    {isLastAssistantFollowUp ? (
                      <div className="small" style={{ color: "#F1C40F", fontWeight: 600, marginBottom: 2 }}>
                        Follow-up Question
                      </div>
                    ) : null}
                    <div className="msgBody">{m.text}</div>
                  </div>
                );
              })
            ) : (
              <div className="small">Waiting for the agent prompt…</div>
            )}
          </div>

          {categoryInputMode === "TEXT" ? (
            <div className="inputCard" style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
                <div className="small">
                  {categoryWaitingForUser ? "Paused — answer to continue." : "Active — waiting for next question."}
                </div>
                <span className="small">Typing is silent.</span>
              </div>

              <div className="row" style={{ marginTop: 10, width: "100%", alignItems: "flex-end" }}>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer…"
                  rows={4}
                  style={{
                    flex: 1,
                    minWidth: 220,
                    resize: "vertical",
                    fontSize: "11pt",
                    lineHeight: 1.4,
                  }}
                  disabled={busy || !selectedCategory}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendAnswer();
                  }}
                />
                <button
                  type="button"
                  onClick={() => void sendAnswer()}
                  disabled={busy || !answer.trim()}
                  style={{ marginLeft: 8 }}
                  className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
                >
                  Save Update
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
      ) : null}

      <div className="top">
        <div>
          <h1>Deal Review</h1>
          <div className="sub">{readOnly ? "Read-only — voice, chat, and review actions are hidden." : ""}</div>
        </div>

        {!readOnly ? (
        <div className="row">
          <label className="small">
            <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} disabled={busy} /> Speak
          </label>
          <label className="small">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} disabled={busy} /> Voice
          </label>
          <label className="small" title="Stability mode keeps the mic stream open while a session is active (but only records during rep turns). Turn off for strict privacy.">
            <input type="checkbox" checked={keepMicOpen} onChange={(e) => setKeepMicOpen(e.target.checked)} disabled={busy || !voice} /> Keep mic open
          </label>
          <button onClick={resetUi} disabled={busy}>
            Reset
          </button>
          <button onClick={stopNow} disabled={busy}>
            End Review
          </button>
          <details className="micSettings">
            <summary className="micSettingsBtn">Mic Settings</summary>
            <div className="micSettingsPanel">
              <div className="small" style={{ marginBottom: 8 }}>
                If voice capture feels off (too quiet/loud or cutting off), adjust these.
              </div>

              <div className="row">
                <label className="small">Microphone</label>
                <select
                  value={selectedMicDeviceId}
                  onChange={(e) => setSelectedMicDeviceId(e.target.value)}
                  disabled={busy}
                  style={{ minWidth: 260 }}
                >
                  <option value="">(system default)</option>
                  {micDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <button onClick={() => void refreshMicDevices()} disabled={busy}>
                  Refresh devices
                </button>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <label className="small" title="How loud your microphone input is.">
                  Mic loudness: <b>{(Number(micGain) || 2.5).toFixed(1)}×</b>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={8}
                  step={0.1}
                  value={Number(micGain) || 2.5}
                  onChange={(e) => setMicGain(Number(e.target.value || "2.5") || 2.5)}
                  disabled={busy}
                  style={{ width: 260 }}
                />
                <span className="small">
                  Level:{" "}
                  <b style={{ color: micLevel > 0.02 ? "var(--good)" : micLevel > 0.01 ? "var(--warn)" : "var(--muted)" }}>
                    {micLevel.toFixed(3)}
                  </b>
                  <span style={{ color: "var(--muted)" }}>{` · peak ${micPeak}`}</span>
                </span>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <label className="small" title="How long we wait after you stop speaking before sending for transcription.">
                  Pause after you stop talking: <b>{Math.round((Number(micVadSilenceMs) || 1500) / 100) / 10}s</b>
                </label>
                <input
                  type="range"
                  min={300}
                  max={3000}
                  step={100}
                  value={Number(micVadSilenceMs) || 1500}
                  onChange={(e) => setMicVadSilenceMs(Number(e.target.value || "1500") || 1500)}
                  disabled={busy}
                  style={{ width: 260 }}
                />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <label className="small" title="Ignore very short noises so keyboard clicks don't trigger voice capture.">
                  Ignore very short noises: <b>{Math.round(Number(micMinSpeechMs) || 350)}ms</b>
                </label>
                <input
                  type="range"
                  min={200}
                  max={1200}
                  step={50}
                  value={Number(micMinSpeechMs) || 350}
                  onChange={(e) => setMicMinSpeechMs(Number(e.target.value || "350") || 350)}
                  disabled={busy}
                  style={{ width: 260 }}
                />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <label className="small" title="If we don't detect speech at all, we stop listening and show a message.">
                  Stop listening if you stay silent: <b>{Math.round((Number(micNoSpeechRestartMs) || 6000) / 1000)}s</b>
                </label>
                <input
                  type="range"
                  min={2000}
                  max={15000}
                  step={500}
                  value={Number(micNoSpeechRestartMs) || 6000}
                  onChange={(e) => setMicNoSpeechRestartMs(Number(e.target.value || "6000") || 6000)}
                  disabled={busy}
                  style={{ width: 260 }}
                />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <label className="small" title="Hard limit for one answer segment.">
                  Max answer length: <b>{Math.round((Number(micMaxSegmentMs) || 70000) / 1000)}s</b>
                </label>
                <input
                  type="range"
                  min={5000}
                  max={120000}
                  step={1000}
                  value={Number(micMaxSegmentMs) || 70000}
                  onChange={(e) => setMicMaxSegmentMs(Number(e.target.value || "70000") || 70000)}
                  disabled={busy}
                  style={{ width: 260 }}
                />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <label className="small" title="Turn off if you want browser noise/echo processing.">
                  <input type="checkbox" checked={micRawMode} onChange={(e) => setMicRawMode(e.target.checked)} disabled={busy} />{" "}
                  Studio audio (less processing)
                </label>
                <label className="small" title="Auto tune listens briefly and adjusts mic loudness.">
                  <input
                    type="checkbox"
                    checked={autoMicNormalize}
                    onChange={(e) => setAutoMicNormalize(e.target.checked)}
                    disabled={busy}
                  />{" "}
                  Auto adjust
                </label>
                <button onClick={() => void primeMicPermissionFromGesture("manual_prime")} disabled={busy || !voice}>
                  Prime mic
                </button>
                <button onClick={() => void runMicTune("manual")} disabled={busy || !voice}>
                  Auto tune now
                </button>
              </div>

              {micTuneStatus ? (
                <div className="small" style={{ marginTop: 8 }}>
                  {micTuneStatus}
                </div>
              ) : null}
            </div>
          </details>
        </div>
        ) : null}
      </div>

      <div className="status">
        {readOnly ? (
          <>
            <div className="row">
              {healthPercent != null ? (
                <span className={`pill ${healthPillClass(healthPercent)}`}>
                  Health: <b>{healthPercent}%</b>
                </span>
              ) : null}
              {aiForecast ? (
                <span className="pill blue">
                  AI: <b>{aiForecast}</b>
                </span>
              ) : null}
              {oppState?.scoring?.confidence_band ? (
                <span
                  className={`pill ${confidencePillClassFromBand(oppState.scoring.confidence_band)}`}
                  title={oppState.scoring.confidence_summary || undefined}
                >
                  Confidence: <b style={{ textTransform: "capitalize" }}>{oppState.scoring.confidence_band}</b>
                </span>
              ) : null}
            </div>
            <div className="small">Read-only view</div>
          </>
        ) : (
          <>
            <div className="row">
              <span className="pill warn">IDLE</span>
              <span className="pill">
                Mode: <b>{mode === "FULL_REVIEW" ? "Full Deal Review" : "Category Update"}</b>
              </span>
              <span className="pill">
                Status: <b>{mode === "CATEGORY_UPDATE" ? (selectedCategory ? "ACTIVE" : "—") : "—"}</b>
              </span>
              <span className="pill">
                Listening: <b>{listening ? "ON" : "OFF"}</b>
              </span>
              <span className={`pill ${micOpen ? "ok" : "warn"}`}>
                Microphone: <b>{micOpen ? "ON" : "OFF"}</b>
              </span>
              {voice && mode === "CATEGORY_UPDATE" ? (
                <span className="bg-white text-black text-xs font-medium px-2 py-0.5 rounded-full shadow-sm" title={micIndicatorLabel}>
                  Mic: <b>{micIndicatorLabel}</b>
                </span>
              ) : null}
              {healthPercent != null ? (
                <span className={`pill ${healthPillClass(healthPercent)}`}>
                  Health: <b>{healthPercent}%</b>
                </span>
              ) : null}
              {aiForecast ? (
                <span className="pill blue">
                  AI: <b>{aiForecast}</b>
                </span>
              ) : null}
              {oppState?.scoring?.confidence_band ? (
                <span
                  className={`pill ${confidencePillClassFromBand(oppState.scoring.confidence_band)}`}
                  title={oppState.scoring.confidence_summary || undefined}
                >
                  Confidence: <b style={{ textTransform: "capitalize" }}>{oppState.scoring.confidence_band}</b>
                </span>
              ) : null}
            </div>
            <div className="small">Ready.</div>
          </>
        )}
      </div>

      <div className="grid">
        <div className="card">
          <div className="hdr">
            <div>
              <div className="title">
                {accountName || "Opportunity"} <span style={{ color: "var(--muted)" }}>· {oppName || ""}</span>
              </div>
                  {oppState?.opportunity?.review_request_note?.trim() ? (
                    <div className="mb-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm">
                      <span className="font-semibold text-yellow-500">⚡ Manager note:</span>
                      <span className="ml-2 text-[color:var(--sf-text-primary)]">
                        {oppState?.opportunity?.review_request_note}
                      </span>
                    </div>
                  ) : null}
              <div className="kv">
                <b>Rep:</b> {repName || "—"} · <b>Forecast:</b> {forecastStage || "—"} · <b>Close:</b>{" "}
                {closeDateStr || "—"} · <b>Updated:</b> {safeDate(opportunity?.updated_at)} · <b>Partner:</b>{" "}
                {partnerName || "—"} · <b>Deal Reg:</b>{" "}
                <span className="font-mono text-xs">{dealRegDisplay}</span>
              </div>
              <div className="kv" style={{ marginTop: 8 }}>
                <b>Internal Sponsor:</b>{" "}
                {championName ? (
                  <>
                    {championName}
                    {championTitle ? <span style={{ color: "var(--muted)" }}>{` · ${championTitle}`}</span> : null}
                  </>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}{" "}
                · <b>Economic Buyer:</b>{" "}
                {ebName ? (
                  <>
                    {ebName}
                    {ebTitle ? <span style={{ color: "var(--muted)" }}>{` · ${ebTitle}`}</span> : null}
                  </>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </div>
            </div>
            {!readOnly ? (
              <div className="meta">
                {mounted ? <span className="pill ok">Mic+STT</span> : <span className="pill">Voice</span>}
                {micError ? <span className="pill err">Mic error</span> : null}
                {ttsError ? <span className="pill err">TTS error</span> : null}
                {sttError ? <span className="pill err">STT error</span> : null}
              </div>
            ) : null}
          </div>

          <div className="cols">
            <div className="box">
              <h3>Risk Summary</h3>
              <p>{rollup?.risks || "—"}</p>
            </div>
            <div className="box">
              <h3>Next Steps</h3>
              <p>
                <b>Next steps:</b> {rollup?.next_steps || "—"}
              </p>
            </div>
          </div>

          {scoring ? (
            <div className="box" style={{ marginTop: 12 }}>
              <h3>Confidence</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className={`pill ${confidencePillClassFromBand(scoring.confidence_band)}`}>
                  Confidence: <b style={{ textTransform: "capitalize" }}>{scoring.confidence_band}</b>
                </span>
                <button
                  type="button"
                  className="small"
                  style={{ padding: "4px 8px", cursor: "pointer" }}
                  onClick={() => void toggleConfidenceEvidence()}
                >
                  {confidenceEvidenceLoading ? "Refreshing..." : confidenceEvidenceOpen ? "Hide Evidence" : "View Evidence"}
                </button>
              </div>
              {confidenceEvidenceOpen && confidenceEvidencePanel ? (
                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: 12,
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  {confidenceEvidencePanel.raw_text ? (
                    <div style={{ marginBottom: 12 }}>
                      <b>Raw notes:</b>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 4 }}>{confidenceEvidencePanel.raw_text}</pre>
                    </div>
                  ) : null}
                  {confidenceEvidencePanel.categories.length ? (
                    <div style={{ marginBottom: confidenceEvidencePanel.risk_flags.length ? 12 : 0 }}>
                      <b>Latest review evidence:</b>
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {confidenceEvidencePanel.categories.map((c) => (
                          <div key={c.category} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                              <div className="small">
                                <b>{c.category}</b>
                                <span style={{ color: "var(--muted)" }}> · Evidence Strength: {c.evidenceStrength}</span>
                              </div>
                              <span className={`pill ${evidenceBandFromScore(c.score).className}`}>{evidenceBandFromScore(c.score).label}</span>
                            </div>
                            {c.evidence ? <div className="small"><b>Evidence:</b> {c.evidence}</div> : null}
                            {c.tip ? <div className="small" style={{ marginTop: c.evidence ? 4 : 0 }}><b>Tip:</b> {c.tip}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(confidenceEvidencePanel.risk_flags as any[])?.length ? (
                    <div>
                      <b>Risk flags:</b>
                      <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                        {(confidenceEvidencePanel.risk_flags as any[]).map((r, i) => (
                          <li key={i}>{typeof r === "object" && r?.type ? `${r.type} (${r.severity}): ${r.why}` : String(r)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {!readOnly ? (
            <div style={{ marginTop: 16 }}>
              <PasteNotesPanel opportunityId={opportunityId} onApplied={loadOpportunityState} />
            </div>
          ) : null}

          {!readOnly ? (
            <div style={{ marginBottom: 10 }}>
              <button
                className="btnPrimary"
                onClick={startFullDealReview}
                disabled={busy || !opportunityId || isStartingRef.current || fullReviewChainIndex !== null}
              >
                {fullReviewButtonLabel}
              </button>
            </div>
          ) : null}

          <div className="med">
            {tileRows.map((c) => {
              const isActive = highlightCategoryKey === c.key;
              const isCompleted = completedCategoryKey === c.key;
              const showChipActive = !readOnly && sessionHasActiveCategory && isActive && voice;
              const chipState =
                readOnly
                  ? null
                  : isCompleted
                    ? "complete"
                    : showChipActive
                      ? micIndicatorState
                      : null;
              const mfocusClasses = [
                highlightCategoryKey === c.key ? "active" : "",
                sessionHasActiveCategory && isActive ? "mfocus-active" : "",
                sessionHasActiveCategory && !isActive && !isCompleted ? "mfocus-inactive" : "",
                chipState ? "mfocus-card" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
              <div
                key={c.key}
                className={`cat ${mfocusClasses}`}
                style={{ borderTop: `3px solid ${scoreColor(c.score)}` }}
              >
                {chipState ? (
                  <span
                    className={`mfocus-chip mfocus-${chipState} ${chipState === "complete" && completedCategoryFadeOut ? "mfocus-fadeout" : ""} ${
                      chipState === "matthew_speaking" ? "bg-blue-500 text-white animate-pulse" :
                      chipState === "processing" ? "bg-amber-500 text-white" :
                      chipState === "your_turn" ? "bg-green-600 text-white" :
                      chipState === "idle" ? "bg-gray-400 text-white" : ""
                    }`}
                    aria-hidden
                  >
                    {chipState === "matthew_speaking" ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                    ) : chipState === "processing" ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin flex-shrink-0"><circle cx="12" cy="12" r="10" strokeOpacity={0.25}/><path d="M12 2a10 10 0 0 1 10 10" strokeOpacity={1}/></svg>
                    ) : chipState === "your_turn" ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                    ) : chipState === "idle" ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                    ) : chipState === "complete" ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : null}
                  </span>
                ) : null}
                {chipState && chipState !== "complete" ? (
                  <span className="mfocus-chip-label bg-white text-black text-xs font-medium px-2 py-0.5 rounded-full shadow-sm" style={{ position: "absolute", top: 10, right: 42, whiteSpace: "nowrap" }}>
                    {micIndicatorLabel}
                  </span>
                ) : null}
                <div className="ch">
                  <div>
                    <b>{c.catLabel}</b>
                    {c.catMeaning ? (
                      <div className="small" style={{ marginTop: 2 }}>
                        {c.catMeaning}
                      </div>
                    ) : null}
                  </div>
                  <span className="score" style={{ color: scoreColor(c.score) }}>
                    {Number(c.score || 0)}/3
                  </span>
                </div>
                <div className="small" style={{ color: "var(--accent)", fontWeight: 800 }}>
                  {c.scoreLabel || "—"}
                </div>
                <div className="tip">
                  <b>Tip:</b> {c.tip || "—"}
                </div>
                <div className="evi">
                  <b>Evidence:</b> {c.evidence || "—"}
                </div>
                {!readOnly ? (
                  <div className="catBtnRow">
                    <button type="button" onClick={() => void startCategoryUpdate(c.key, false)} disabled={busy || !opportunityId}>
                      Text Update
                    </button>
                    <button type="button" onClick={() => void startCategoryUpdate(c.key, true)} disabled={busy || !opportunityId}>
                      Voice Update
                    </button>
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>

          {!readOnly && (mode === "FULL_REVIEW" || mode === "CATEGORY_UPDATE") ? (
            <>
              <details style={{ marginTop: 12 }} open={mode === "CATEGORY_UPDATE"}>
                <summary className="small">Conversation &amp; debug</summary>
                <div className="chat">
                  {activeMessages?.length ? (
                    activeMessages.map((m, i) => (
                      <div key={`${m.at}-${i}`} className="msg">
                        <div className="msgMeta">
                          <strong className={`role ${m.role}`}>{m.role.toUpperCase()}</strong> · {new Date(m.at).toLocaleTimeString()}
                        </div>
                        <div className="msgBody">{m.text}</div>
                      </div>
                    ))
                  ) : (
                    <div className="small">Run Full Deal Review or click a category update button.</div>
                  )}
                </div>
              </details>

              <div className="inputCard">
                <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
                  <div className="small">
                    {categoryWaitingForUser
                      ? "Category update paused — answer to continue."
                      : "Category update active."}
                  </div>
                  <span className="small">Voice uses mic+STT (tune below if needed).</span>
                </div>

                {micError ? (
                  <div className="small" style={{ marginTop: 8, color: "var(--bad)" }}>
                    Mic: {micError}
                  </div>
                ) : null}
                {sttError ? (
                  <div className="small" style={{ marginTop: 8, color: "var(--bad)" }}>
                    STT: {sttError}
                  </div>
                ) : null}
                {categorySaveFailed ? (
                  <div
                    className="small"
                    style={{
                      marginTop: 8,
                      padding: 10,
                      borderRadius: 8,
                      border: "1px solid var(--bad)",
                      background: "rgba(231, 76, 60, 0.08)",
                      color: "var(--bad)",
                    }}
                  >
                    <div>We couldn&apos;t save your update. Please try again.</div>
                    <button
                      type="button"
                      onClick={() => void retryLastCategorySave()}
                      disabled={busy || inputInFlight}
                      style={{ marginTop: 8 }}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--sf-text-primary)] disabled:opacity-60"
                    >
                      Try Again
                    </button>
                  </div>
                ) : null}
                {ttsError ? (
                  <div className="small" style={{ marginTop: 8, color: "var(--bad)" }}>
                    TTS: {ttsError}
                  </div>
                ) : null}

                <div className="row" style={{ marginTop: 10, width: "100%" }}>
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Type your answer…"
                    style={{ flex: 1, minWidth: 260 }}
                    disabled={busy || (mode === "CATEGORY_UPDATE" ? !selectedCategory : true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void sendAnswer();
                    }}
                  />
                  <button type="button" onClick={() => void sendAnswer()} disabled={busy || !answer.trim()}>
                    Send
                  </button>
                </div>

                {lastTranscript ? (
                  <div className="small" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                    <b>Last transcript:</b> {lastTranscript}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {!readOnly ? (
        <div className="card">
          <div className="hdr">
            <div className="title">Audio</div>
            <div className="meta">
              <span className="pill">TTS</span>
              <span className="pill">STT</span>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <audio ref={audioRef} controls style={{ width: "100%" }} />
          </div>
        </div>
        ) : null}
      </div>

      <style jsx global>{`
        :root {
          /* Align deal review shell to global palette tokens */
          --bg: var(--sf-background);
          --panel: var(--sf-surface);
          --panel2: var(--sf-surface-alt);
          --border: var(--sf-border);
          --text: var(--sf-text-primary);
          --muted: var(--sf-text-secondary);
          --accent: var(--sf-accent-primary);

          /* Semantic scoring colors — MUST remain hard-coded */
          --good: #2ecc71;
          --warn: #f1c40f;
          --bad: #e74c3c;
        }
        body {
          margin: 0;
          background: var(--bg);
          color: var(--text);
          font-family: Segoe UI, system-ui, -apple-system, Arial, sans-serif;
        }
        code {
          color: var(--text);
        }
        .wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 18px;
        }
        .micSettings {
          position: relative;
        }
        .micSettings summary {
          list-style: none;
        }
        .micSettings summary::-webkit-details-marker {
          display: none;
        }
        .micSettingsBtn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          user-select: none;
        }
        details.micSettings > .micSettingsBtn {
          background: var(--panel);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 13px;
        }
        details.micSettings[open] > .micSettingsBtn {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
        }
        .micSettingsPanel {
          position: absolute;
          right: 0;
          top: calc(100% + 8px);
          width: min(760px, calc(100vw - 24px));
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 12px;
          z-index: 70;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35);
        }
        .top {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          flex-wrap: wrap;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        h1 {
          font-size: 18px;
          margin: 0 0 6px 0;
        }
        .sub {
          color: var(--muted);
          font-size: 12px;
        }
        .row {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        input,
        select,
        button {
          background: var(--panel);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 13px;
          outline: none;
        }
        input:focus,
        select:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
        }
        button {
          cursor: pointer;
        }
        button:hover {
          border-color: var(--accent);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btnPrimary {
          width: 100%;
          padding: 14px 14px;
          font-weight: 800;
          border-radius: 12px;
          border-color: color-mix(in srgb, var(--accent) 45%, transparent);
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent) 18%, transparent),
            color-mix(in srgb, var(--accent) 6%, transparent)
          );
        }
        .status {
          width: 100%;
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 12px;
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .pill {
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .pill.ok {
          color: var(--good);
          border-color: color-mix(in srgb, var(--good) 35%, transparent);
        }
        .pill.err {
          color: var(--bad);
          border-color: color-mix(in srgb, var(--bad) 35%, transparent);
        }
        .pill.warn {
          color: var(--warn);
          border-color: color-mix(in srgb, var(--warn) 35%, transparent);
        }
        .pill.blue {
          color: var(--accent);
          border-color: color-mix(in srgb, var(--accent) 35%, transparent);
        }
        .small {
          font-size: 11px;
          color: var(--muted);
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px;
        }
        .qaOverlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          opacity: 0;
          pointer-events: none;
          transition: opacity 160ms ease;
          z-index: 50;
        }
        .qaOverlay.open {
          opacity: 1;
          pointer-events: auto;
        }
        .qaDrawer {
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          width: min(520px, 92vw);
          background: var(--panel);
          border-right: 1px solid var(--border);
          transform: translateX(-102%);
          transition: transform 220ms ease;
          z-index: 60;
          display: flex;
          flex-direction: column;
          padding: 14px;
        }
        .qaDrawer.open {
          transform: translateX(0);
        }
        .qaHdr {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border);
        }
        .qaTitleBlock {
          min-width: 0;
        }
        .qaTitleLine {
          font-size: 18px;
          font-weight: 900;
          color: var(--text);
          letter-spacing: 0.2px;
        }
        .qaMeaningLine {
          margin-top: 6px;
          font-size: 13px;
          color: var(--text);
          opacity: 0.9;
        }
        .qaMeta {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .qaBody {
          margin-top: 12px;
          overflow: auto;
          padding-right: 2px;
        }
        .hdr {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .title {
          font-size: 18px;
          font-weight: 800;
          margin: 0;
        }
        .meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .kv {
          font-size: 12px;
          color: var(--muted);
        }
        .kv b {
          color: var(--text);
          font-weight: 700;
        }
        .cols {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 12px;
        }
        .box {
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
        }
        .box h3 {
          margin: 0 0 6px 0;
          font-size: 12px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }
        .box p {
          margin: 0;
          font-size: 13px;
          line-height: 1.4;
        }
        .med {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
          gap: 10px;
        }
        .cat {
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
        }
        .cat.active {
          outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
        }

        /* MEDDPICCTB Focus States — UX Enhancement */
        .cat.mfocus-card {
          position: relative;
        }
        .cat.mfocus-active {
          background: #1a2f4a;
          border-left: 4px solid #00BCD4;
          transition: background 300ms ease, border-left 300ms ease, opacity 300ms ease;
        }
        .cat.mfocus-inactive {
          opacity: 0.75;
          transition: opacity 300ms ease;
        }
        .mfocus-chip {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 24px;
          height: 24px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .mfocus-chip.mfocus-listening {
          background: #4CAF50;
          animation: mfocus-pulse 1.4s ease-in-out infinite;
        }
        .mfocus-chip.mfocus-reviewing {
          background: #FFA726;
          animation: mfocus-pulse 1.4s ease-in-out infinite;
        }
        .mfocus-chip.mfocus-complete {
          background: #9C27B0;
          animation: none;
          transition: opacity 300ms ease;
        }
        .mfocus-chip.mfocus-complete.mfocus-fadeout {
          opacity: 0;
        }
        @keyframes mfocus-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        .cat .ch {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .cat .ch b {
          font-size: 13px;
        }
        .score {
          font-weight: 900;
        }
        .tip {
          color: var(--warn);
          font-size: 12px;
          margin-top: 6px;
        }
        .evi {
          color: var(--text);
          font-size: 11px;
          margin-top: 6px;
        }
        .catBtnRow {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }
        .catBtnRow button {
          flex: 1;
        }
        .chat {
          margin-top: 10px;
          max-height: 320px;
          overflow: auto;
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
        }
        .msg {
          margin-bottom: 10px;
        }
        .msgMeta {
          font-size: 11px;
          color: var(--muted);
          margin-bottom: 3px;
        }
        .msgBody {
          font-size: 13px;
          line-height: 1.35;
          white-space: pre-wrap;
        }
        .role.assistant {
          color: var(--accent);
        }
        .role.user {
          color: var(--good);
        }
        .role.system {
          color: var(--warn);
        }
        .inputCard {
          margin-top: 12px;
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px;
        }
        @media (max-width: 860px) {
          .cols {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

