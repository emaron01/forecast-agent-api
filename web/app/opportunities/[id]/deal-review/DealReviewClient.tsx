"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpeechRecognition } from "../../../../lib/useSpeechRecognition";
import { MEDDPICC_CANONICAL } from "../../../../lib/meddpiccCanonical";
import { dateOnly } from "../../../../lib/dateOnly";
import { PasteNotesPanel } from "../../../../components/opportunities/PasteNotesPanel";

type HandsFreeStatus = "RUNNING" | "WAITING_FOR_USER" | "DONE" | "ERROR";
type HandsFreeMessage = { role: "assistant" | "user" | "system"; text: string; at: number };
type HandsFreeRun = {
  runId: string;
  sessionId: string;
  status: HandsFreeStatus;
  waitingSeq?: number;
  waitingPrompt?: string;
  error?: string;
  messages: HandsFreeMessage[];
  modelCalls: number;
  updatedAt: number;
};

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

export function DealReviewClient(props: { opportunityId: string; initialCategory?: string; initialPrefill?: string }) {
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

  const [oppState, setOppState] = useState<OppState | null>(null);
  const [run, setRun] = useState<HandsFreeRun | null>(null);
  const [catSessionId, setCatSessionId] = useState("");
  const [catMessages, setCatMessages] = useState<HandsFreeMessage[]>([]);

  const [speak, setSpeak] = useState(true);
  const [voice, setVoice] = useState(true);
  const [keepMicOpen, setKeepMicOpen] = useState(true);
  const [evidenceModal, setEvidenceModal] = useState<{ id: number; raw_text: string; summary: string; risk_flags: unknown[]; next_steps: string[] } | null>(null);

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
  const [ttsError, setTtsError] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

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

  const runRef = useRef<HandsFreeRun | null>(null);
  const catSessionIdRef = useRef<string>("");
  const selectedCategoryRef = useRef<string>("");

  const micLevelRef = useRef(0);
  const micPeakRef = useRef(0);

  const speech = useSpeechRecognition({
    // Kept for browsers where users want WebSpeech; mic+STT is primary path.
    silenceMs: 900,
  });

  const runId = run?.runId || "";
  const status = run?.status || "DONE";
  const isWaiting = status === "WAITING_FOR_USER";
  const isRunning = status === "RUNNING";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    catSessionIdRef.current = catSessionId;
  }, [catSessionId]);
  useEffect(() => {
    selectedCategoryRef.current = selectedCategory;
  }, [selectedCategory]);

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
      const r = byCat.get(c.key) || {};
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
      setOppState(json as OppState);
    } catch (e: any) {
      // Keep UI alive even if state fails.
      setOppState(null);
    }
  }, [opportunityId]);

  useEffect(() => {
    void loadOpportunityState();
  }, [loadOpportunityState]);

  // Full Review: refresh tiles after the agent pauses/completes so saves are visible.
  const lastOppRefreshRunUpdatedAtRef = useRef<number>(0);
  useEffect(() => {
    if (mode !== "FULL_REVIEW") return;
    if (!run?.updatedAt) return;
    if (run.status !== "WAITING_FOR_USER" && run.status !== "DONE") return;
    const u = Number(run.updatedAt) || 0;
    if (u <= (lastOppRefreshRunUpdatedAtRef.current || 0)) return;
    lastOppRefreshRunUpdatedAtRef.current = u;
    void loadOpportunityState();
  }, [loadOpportunityState, mode, run?.status, run?.updatedAt]);

  // Full Review: highlight the inferred active category from the latest waiting prompt.
  useEffect(() => {
    if (mode !== "FULL_REVIEW") return;
    if (!isWaiting) return;
    const prompt = String(run?.waitingPrompt || "").trim();
    const inferred = inferCategoryFromPromptText(prompt) || "";
    if (inferred) setFullReviewHighlightCategory(inferred);
  }, [isWaiting, mode, run?.waitingPrompt]);

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
    } catch {}
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
            if (keepMicOpen) return;
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
    const readSttResponse = async (
      res: Response
    ): Promise<{ ok: boolean; text?: string; error?: string }> => {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          return (await res.json()) as any;
        } catch {
          // fall through to text parsing
        }
      }
      const t = await res.text();
      try {
        return JSON.parse(t) as any;
      } catch {
        return { ok: false, error: t || "Transcription failed" };
      }
    };

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

  const captureOneUtteranceAndRoute = useCallback(async () => {
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

      const routeTranscript = async (text: string) => {
        setLastTranscript(text);
        const now = Date.now();
        const msg: HandsFreeMessage = { role: "user", text, at: now };

        if (mode === "FULL_REVIEW") {
          const r = runRef.current;
          const rid = r?.runId || "";
          if (!rid) return;
          const waitingSeq = r?.waitingSeq;
          setRun((prev) => (prev ? { ...prev, messages: [...(prev.messages || []), msg] } : prev));
          await fetch(`/api/deal-review/${encodeURIComponent(rid)}/input`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, waitingSeq }),
          }).then(async (res) => {
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.ok) throw new Error(json?.error || "Send failed");
          });
          return;
        }

        if (mode === "CATEGORY_UPDATE") {
          const cat = String(selectedCategoryRef.current || "").trim();
          if (!cat) return;
          const sid = String(catSessionIdRef.current || "").trim();
          setCatMessages((prev) => [...prev, msg]);
          const res = await fetch(`/api/deal-review/opportunities/${encodeURIComponent(opportunityId)}/update-category`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: cat, text, sessionId: sid || undefined }),
          });
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("text/event-stream")) {
            // Latency-layer: SSE streaming with sentence chunking. Play sentences sequentially.
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
                await playTts(sentence);
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
            return;
          }
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json?.ok) throw new Error(json?.error || "Update failed");
          if (json?.sessionId) setCatSessionId(String(json.sessionId));
          const assistantText = String(json?.assistantText || "").trim();
          if (assistantText) {
            setCatMessages((prev) => [...prev, { role: "assistant", text: assistantText, at: Date.now() }]);
            void playTts(assistantText);
          }
          void loadOpportunityState();
        }
      };

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
          const transcript = await sendToStt(rec.blob);
          if (!transcript) {
            setSttError("Empty transcript (check mic/tune and try again)");
            maybeCloseMicForPrivacy();
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
          return;
        }

        // Keep segment bounded even if someone talks forever.
        if (now - started >= MAX_SEGMENT_MS) {
          const rec = await stopAll();
          voiceActiveRef.current = false;
          setListening(false);
          if (!rec) return;
          const transcript = await sendToStt(rec.blob);
          if (!transcript) {
            setSttError("Empty transcript (max segment reached)");
            maybeCloseMicForPrivacy();
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
        });
      }, Math.max(2000, Number(micMaxSegmentMs) || 12000));

      await loop().catch(failCapture);
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      setSttError(msg);
      voiceActiveRef.current = false;
      setListening(false);
      maybeCloseMicForPrivacy();
    }
  }, [
    ensureMic,
    loadOpportunityState,
    maybeCloseMicForPrivacy,
    micMaxSegmentMs,
    micMinSpeechMs,
    micNoSpeechRestartMs,
    micVadSilenceMs,
    mode,
    opportunityId,
    playTts,
    sendToStt,
    startMicMeter,
    startRecorder,
    stopRecorder,
    voice,
  ]);

  // Poll run status while active.
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/deal-review/${encodeURIComponent(runId)}/status`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok && json?.ok && json?.run) setRun(json.run);
      } catch {}
    };
    const t = window.setInterval(poll, 900);
    void poll();
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [runId]);

  // Speak assistant updates + capture voice when waiting.
  const lastSpokenAssistantAtRef = useRef<number>(0);
  useEffect(() => {
    if (!runId || !run) return;
    const msgs = Array.isArray(run.messages) ? run.messages : [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && speak) {
      const at = Number(lastAssistant.at || 0) || 0;
      if (at && at > (lastSpokenAssistantAtRef.current || 0)) {
        lastSpokenAssistantAtRef.current = at;
        void playTts(lastAssistant.text);
      }
    }
    if (run.status === "WAITING_FOR_USER" && voice && !speakingRef.current) {
      void captureOneUtteranceAndRoute();
    }
    if (run.status === "DONE" || run.status === "ERROR") {
      voiceActiveRef.current = false;
      setListening(false);
      if (!keepMicOpen) closeMicStreamOnly();
    }
  }, [captureOneUtteranceAndRoute, closeMicStreamOnly, keepMicOpen, playTts, run, runId, speak, voice]);

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
    setBusy(true);
    setMode("FULL_REVIEW");
    setCatMessages([]);
    setCatSessionId("");
    setSelectedCategory("");
    setQaPaneOpen(false);
    setCategoryInputMode("VOICE");
    setSttError("");
    setTtsError("");
    try {
      await primeMicPermissionFromGesture("full_review");
      const res = await fetch("/api/deal-review/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Full deal review failed");
      setRun(json.run as HandsFreeRun);
    } catch (e: any) {
      setRun({ runId: "", sessionId: "", status: "ERROR", error: String(e?.message || e), messages: [], modelCalls: 0, updatedAt: Date.now() } as any);
    } finally {
      setBusy(false);
    }
  }, [opportunityId, primeMicPermissionFromGesture]);

  const stopNow = useCallback(async () => {
    const rid = String(runRef.current?.runId || "").trim();
    setBusy(true);
    try {
      if (rid) {
        await fetch(`/api/deal-review/${encodeURIComponent(rid)}/stop`, { method: "POST" }).catch(() => null);
      }
    } finally {
      setRun(null);
      setMode("FULL_REVIEW");
      setSelectedCategory("");
      setCatSessionId("");
      setCatMessages([]);
      setQaPaneOpen(false);
      setCategoryInputMode("VOICE");
      setFullReviewHighlightCategory("");
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
      setRun(null);
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
      if (mode === "FULL_REVIEW") {
        const rid = String(runRef.current?.runId || "").trim();
        if (!rid) return;
        const waitingSeq = runRef.current?.waitingSeq;
        const res = await fetch(`/api/deal-review/${encodeURIComponent(rid)}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, waitingSeq }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Send failed");
        return;
      }

      if (mode === "CATEGORY_UPDATE") {
        if (!selectedCategory) return;
        const res = await fetch(`/api/deal-review/opportunities/${encodeURIComponent(opportunityId)}/update-category`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: selectedCategory, text, sessionId: catSessionId || undefined }),
        });
        setCatMessages((prev) => [...prev, { role: "user", text, at: Date.now() }]);
        const contentType = res.headers.get("content-type") || "";
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
              await playTts(sentence);
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
        } else {
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json?.ok) throw new Error(json?.error || "Update failed");
          if (json?.sessionId) setCatSessionId(String(json.sessionId));
          const rawAssistantText = String(json?.assistantText || "").trim();
          const assistantText =
            categoryInputMode === "TEXT" ? stripPercentCalloutsForTypedUpdate(rawAssistantText) : rawAssistantText;
          if (assistantText) {
            setCatMessages((prev) => [...prev, { role: "assistant", text: assistantText, at: Date.now() }]);
            if (categoryInputMode === "VOICE") void playTts(assistantText);
          }
        }
        void loadOpportunityState();
        return;
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (mode === "FULL_REVIEW") {
        setRun((prev) =>
          prev ? { ...prev, messages: [...(prev.messages || []), { role: "system", text: msg, at: Date.now() }] } : prev
        );
      } else {
        setCatMessages((prev) => [...prev, { role: "system", text: msg, at: Date.now() }]);
      }
    } finally {
      setBusy(false);
    }
  }, [answer, catSessionId, loadOpportunityState, mode, opportunityId, playTts, selectedCategory]);

  const resetUi = useCallback(() => {
    setRun(null);
    setMode("FULL_REVIEW");
    setSelectedCategory("");
    setCatSessionId("");
    setCatMessages([]);
    setAnswer("");
    setQaPaneOpen(false);
    setCategoryInputMode("VOICE");
    setFullReviewHighlightCategory("");
    setSttError("");
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
  const aiForecast = String(opportunity?.ai_verdict || opportunity?.ai_forecast || "");

  const activeMessages = mode === "FULL_REVIEW" ? run?.messages || [] : catMessages;
  const highlightCategoryKey = (mode === "CATEGORY_UPDATE" ? selectedCategory : fullReviewHighlightCategory) as CategoryKey | "";
  const qaDrawerOpen = mode === "CATEGORY_UPDATE" && qaPaneOpen;
  const qaCanonical = selectedCategory ? (MEDDPICC_CANONICAL as any)[selectedCategory] : null;

  return (
    <main className="wrap">
      {/* Slide-out drawer for Text/Voice category updates */}
      {qaDrawerOpen ? (
        <div
          className={`qaOverlay ${qaDrawerOpen ? "open" : ""}`}
          onClick={() => {
            // Click outside closes the drawer (keeps the deal review page).
            setQaPaneOpen(false);
          }}
        />
      ) : null}
      <aside className={`qaDrawer ${qaDrawerOpen ? "open" : ""}`} aria-hidden={!qaDrawerOpen}>
        <div className="qaHdr">
          <div className="qaTitleBlock">
            <div className="qaTitleLine">{String(qaCanonical?.titleLine || "").trim() || "Category Update"}</div>
            <div className="qaMeaningLine">{String(qaCanonical?.meaningLine || "").trim() || ""}</div>
          </div>
          <div className="qaMeta">
            <span className="pill">{categoryInputMode === "TEXT" ? "TEXT (silent)" : "VOICE"}</span>
            <button
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
              activeMessages.map((m, i) => (
                <div key={`${m.at}-${i}`} className="msg">
                  <div className="msgMeta">
                    <strong className={`role ${m.role}`}>{m.role.toUpperCase()}</strong> · {new Date(m.at).toLocaleTimeString()}
                  </div>
                  <div className="msgBody">{m.text}</div>
                </div>
              ))
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

              <div className="row" style={{ marginTop: 10, width: "100%" }}>
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer…"
                  style={{ flex: 1, minWidth: 220 }}
                  disabled={busy || !selectedCategory}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendAnswer();
                  }}
                />
                <button type="button" onClick={() => void sendAnswer()} disabled={busy || !answer.trim()}>
                  Send
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="top">
        <div>
          <h1>Deal Review</h1>
          <div className="sub" />
        </div>

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
          <button onClick={stopNow} disabled={busy && !runId}>
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
      </div>

      <div className="status">
        <div className="row">
          <span className={`pill ${run?.error ? "err" : runId ? "ok" : "warn"}`}>{run?.error ? "ERROR" : runId ? "OK" : "IDLE"}</span>
          <span className="pill">
            Mode: <b>{mode === "FULL_REVIEW" ? "Full Deal Review" : "Category Update"}</b>
          </span>
          <span className="pill">
            Status: <b>{run?.status || (mode === "CATEGORY_UPDATE" ? (selectedCategory ? "ACTIVE" : "—") : "—")}</b>
          </span>
          <span className="pill">
            Listening: <b>{listening || speech.listening ? "ON" : "OFF"}</b>
          </span>
          <span className={`pill ${micOpen ? "ok" : "warn"}`}>
            Microphone: <b>{micOpen ? "ON" : "OFF"}</b>
          </span>
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
        </div>
        <div className="small">
          {run?.error ? `Error: ${run.error}` : isWaiting ? "Waiting for your answer." : isRunning ? "Running…" : "Ready."}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="hdr">
            <div>
              <div className="title">
                {accountName || "Opportunity"} <span style={{ color: "var(--muted)" }}>· {oppName || ""}</span>
              </div>
              <div className="kv">
                <b>Rep:</b> {repName || "—"} · <b>Forecast:</b> {forecastStage || "—"} · <b>Close:</b>{" "}
                {closeDateStr || "—"} · <b>Updated:</b> {safeDate(opportunity?.updated_at)} · <b>Partner:</b>{" "}
                {partnerName || "—"} · <b>Deal Reg:</b>{" "}
                <span className="font-mono text-xs">{dealRegistration === true ? "true" : dealRegistration === false ? "false" : "—"}</span>
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
            <div className="meta">
              {mounted ? (speech.supported ? <span className="pill ok">Speech OK</span> : <span className="pill warn">Speech N/A</span>) : <span className="pill">Speech</span>}
              {micError ? <span className="pill err">Mic error</span> : null}
              {ttsError ? <span className="pill err">TTS error</span> : null}
              {sttError ? <span className="pill err">STT error</span> : null}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <button className="btnPrimary" onClick={startFullDealReview} disabled={busy || !opportunityId}>
              Full Deal Review
            </button>
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
              <p className="small" style={{ textTransform: "capitalize" }}>
                <b>{scoring.confidence_band}</b> · Scored by: {scoring.score_source === "rep_review" ? "Rep Review" : scoring.score_source === "ai_notes" ? "AI Notes" : scoring.score_source === "manager_override" ? "Manager Override" : "System"}
              </p>
              <p className="small">{scoring.confidence_summary}</p>
              {scoring.evidence?.comment_ingestion_id ? (
                <button
                  type="button"
                  className="small"
                  style={{ marginTop: 4, padding: "4px 8px", cursor: "pointer" }}
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/comment-ingestions/${scoring.evidence.comment_ingestion_id}`);
                      const json = await res.json().catch(() => ({}));
                      if (json?.ok) {
                        setEvidenceModal({
                          id: json.id,
                          raw_text: json.raw_text || "",
                          summary: json.summary || "",
                          risk_flags: json.risk_flags || [],
                          next_steps: json.next_steps || [],
                        });
                      }
                    } catch {}
                  }}
                >
                  View Evidence
                </button>
              ) : null}
            </div>
          ) : null}

          {evidenceModal ? (
            <div
              className="qaOverlay"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
              onClick={() => setEvidenceModal(null)}
            >
              <div
                className="card"
                style={{ maxWidth: 480, maxHeight: "80vh", overflow: "auto" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="hdr">
                  <div className="title">Evidence</div>
                  <button onClick={() => setEvidenceModal(null)}>Close</button>
                </div>
                <div style={{ padding: 12 }}>
                  {evidenceModal.summary ? (
                    <div style={{ marginBottom: 12 }}>
                      <b>Summary:</b> {evidenceModal.summary}
                    </div>
                  ) : null}
                  {evidenceModal.raw_text ? (
                    <div style={{ marginBottom: 12 }}>
                      <b>Raw notes:</b>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 4 }}>{evidenceModal.raw_text}</pre>
                    </div>
                  ) : null}
                  {(evidenceModal.risk_flags as any[])?.length ? (
                    <div style={{ marginBottom: 12 }}>
                      <b>Risk flags:</b>
                      <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                        {(evidenceModal.risk_flags as any[]).map((r, i) => (
                          <li key={i}>{typeof r === "object" && r?.type ? `${r.type} (${r.severity}): ${r.why}` : String(r)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {evidenceModal.next_steps?.length ? (
                    <div>
                      <b>Next steps:</b>
                      <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                        {evidenceModal.next_steps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <PasteNotesPanel opportunityId={opportunityId} onApplied={loadOpportunityState} />
          </div>

          <div className="med">
            {tileRows.map((c) => (
              <div
                key={c.key}
                className={`cat ${highlightCategoryKey === c.key ? "active" : ""}`}
                style={{ borderTop: `3px solid ${scoreColor(c.score)}` }}
              >
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
                <div className="catBtnRow">
                  <button type="button" onClick={() => void startCategoryUpdate(c.key, false)} disabled={busy || !opportunityId}>
                    Text Update
                  </button>
                  <button type="button" onClick={() => void startCategoryUpdate(c.key, true)} disabled={busy || !opportunityId}>
                    Voice Update
                  </button>
                </div>
              </div>
            ))}
          </div>

          {mode === "FULL_REVIEW" || mode === "CATEGORY_UPDATE" ? (
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
                    {mode === "FULL_REVIEW"
                      ? isWaiting
                        ? "Full review paused — answer to continue."
                        : "Full review will pause when input is needed."
                      : categoryWaitingForUser
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
                    disabled={
                      busy ||
                      (mode === "FULL_REVIEW" ? !runId : mode === "CATEGORY_UPDATE" ? !selectedCategory : true)
                    }
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

