"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSpeechRecognition } from "../lib/useSpeechRecognition";

type HandsFreeStatus = "RUNNING" | "WAITING_FOR_USER" | "DONE" | "ERROR";
type HandsFreeMessage = { role: "assistant" | "user" | "system"; text: string; at: number };
type HandsFreeRun = {
  runId: string;
  sessionId: string;
  status: HandsFreeStatus;
  waitingPrompt?: string;
  error?: string;
  masterPromptSha256?: string;
  masterPromptLoadedAt?: number;
  messages: HandsFreeMessage[];
  modelCalls: number;
  updatedAt: number;
};

function b64ToBlob(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

export default function Home() {
  const BUILD_TAG = "handsfree-v1";

  const [repName, setRepName] = useState("Erik M");
  const [orgId, setOrgId] = useState("1");
  const [opportunityId, setOpportunityId] = useState("");
  const [mode, setMode] = useState<"FULL_REVIEW" | "CATEGORY_UPDATE">("FULL_REVIEW");
  const [selectedCategory, setSelectedCategory] = useState<
    | "metrics"
    | "economic_buyer"
    | "criteria"
    | "process"
    | "paper"
    | "pain"
    | "champion"
    | "competition"
    | "timing"
    | "budget"
    | ""
  >("");
  const [catSessionId, setCatSessionId] = useState<string>("");
  const [catMessages, setCatMessages] = useState<HandsFreeMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<HandsFreeRun | null>(null);
  const [answer, setAnswer] = useState("");
  const [speak, setSpeak] = useState(true);
  const [voice, setVoice] = useState(true);
  const [autoStartTalking, setAutoStartTalking] = useState(true);
  const [submitOnSilenceMs, setSubmitOnSilenceMs] = useState(900);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [ttsError, setTtsError] = useState<string>("");
  const [ttsLastOkAt, setTtsLastOkAt] = useState<number>(0);
  const [micBlocked, setMicBlocked] = useState(false);
  const [micError, setMicError] = useState<string>("");
  const [sttError, setSttError] = useState<string>("");
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [sttLastOkAt, setSttLastOkAt] = useState<number>(0);
  const [perf, setPerf] = useState<{ recordMs?: number; sttMs?: number; agentMs?: number; ttsMs?: number }>({});
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAudioUrlRef = useRef<string>("");
  const speakingRef = useRef(false);
  const lastSpokenAtRef = useRef<number>(0);
  const runRef = useRef<HandsFreeRun | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>("");
  const segmentTimeoutRef = useRef<number | null>(null);
  const recordStartedAtRef = useRef<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const heardVoiceRef = useRef<boolean>(false);
  const firstVoiceAtRef = useRef<number>(0);

  const sttInFlightRef = useRef<boolean>(false);
  const lastSentAtRef = useRef<number>(0);

  const runId = run?.runId || "";
  const status = run?.status || "DONE";

  const canStart = useMemo(() => !busy && !runId, [busy, runId]);
  const isWaiting = status === "WAITING_FOR_USER";
  const isRunning = status === "RUNNING";

  const categories = useMemo(
    () =>
      [
        { key: "metrics" as const, label: "Metrics" },
        { key: "economic_buyer" as const, label: "Economic Buyer" },
        { key: "criteria" as const, label: "Decision Criteria" },
        { key: "process" as const, label: "Decision Process" },
        { key: "paper" as const, label: "Paper Process" },
        { key: "pain" as const, label: "Identify Pain" },
        // UI label must NOT say “Champion”
        { key: "champion" as const, label: "Internal Sponsor" },
        { key: "competition" as const, label: "Competition" },
        { key: "timing" as const, label: "Timing" },
        { key: "budget" as const, label: "Budget" },
      ] as const,
    []
  );

  const appendCat = (role: "assistant" | "user" | "system", text: string) => {
    const t = String(text || "").trim();
    if (!t) return;
    setCatMessages((m) => [...m, { role, text: t, at: Date.now() }]);
  };

  const isCatWaiting = mode === "CATEGORY_UPDATE";

  const speech = useSpeechRecognition({
    autoRestart: true,
    silenceMs: submitOnSilenceMs,
    onUtterance: (finalText) => {
      // Submit only when we are actually waiting for user input.
      if (!voice) return;
      if (!autoStartTalking) return;
      if (mode === "FULL_REVIEW") {
        if (!runId || !isWaiting) return;
      } else {
        if (!selectedCategory || !opportunityId.trim()) return;
      }
      void submitText(finalText);
    },
  });

  const submitText = async (raw: string) => {
    const text = String(raw || "").trim();
    if (!text || busy) return;
    if (speak) await unlockAudio();
    setBusy(true);
    setAnswer("");
    try {
      setPerf((p) => ({ ...p, agentMs: undefined }));
      if (mode === "FULL_REVIEW") {
        if (!runId) throw new Error("No active full-review run");
        const res = await fetch(`/api/handsfree/${runId}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Input failed");
        setRun(json.run as HandsFreeRun);
      } else {
        const oppId = Number(opportunityId);
        if (!oppId) throw new Error("Missing opportunity id");
        if (!selectedCategory) throw new Error("Pick a category first");
        appendCat("user", text);
        const res = await fetch(`/api/opportunities/${oppId}/update-category`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId: Number(orgId),
            sessionId: catSessionId || undefined,
            category: selectedCategory,
            text,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Update failed");
        if (json?.sessionId) setCatSessionId(String(json.sessionId));
        if (json?.assistantText) appendCat("assistant", String(json.assistantText));
      }
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 500);
      if (mode === "FULL_REVIEW") {
        setRun((prev) =>
          prev
            ? { ...prev, status: "ERROR", error: msg }
            : {
                runId,
                sessionId: "",
                status: "ERROR",
                error: msg,
                masterPromptSha256: undefined,
                masterPromptLoadedAt: undefined,
                messages: [],
                modelCalls: 0,
                updatedAt: Date.now(),
              }
        );
      } else {
        appendCat("system", `Error: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const pickRecorderMime = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
    for (const t of candidates) {
      try {
        if ((MediaRecorder as any).isTypeSupported?.(t)) return t;
      } catch {}
    }
    return "";
  };

  const extForMime = (mime: string) => {
    const m = (mime || "").toLowerCase();
    if (m.includes("ogg")) return "ogg";
    if (m.includes("webm")) return "webm";
    return "webm";
  };

  const unlockAudio = async () => {
    try {
      // Best-effort unlock for autoplay policies (must be called from a user gesture).
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return;
      const ctx = new AC();
      await ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0; // silent
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
      setTimeout(() => {
        try {
          ctx.close();
        } catch {}
      }, 50);
    } catch {}
  };

  const playAudio = async (audio_base64: string, mime: string) => {
    const blob = b64ToBlob(audio_base64, mime);
    const url = URL.createObjectURL(blob);
    if (lastAudioUrlRef.current) URL.revokeObjectURL(lastAudioUrlRef.current);
    lastAudioUrlRef.current = url;
    if (!audioRef.current) return;
    audioRef.current.src = url;
    try {
      const a = audioRef.current;
      await a.play();
      setAudioBlocked(false);
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          a.removeEventListener("ended", finish);
          a.removeEventListener("error", finish);
          resolve();
        };
        a.addEventListener("ended", finish);
        a.addEventListener("error", finish);
        // Safety: in case events never fire.
        window.setTimeout(finish, 120000);
      });
    } catch {
      setAudioBlocked(true);
    } finally {
      // After audio finishes, resume hands-free speech capture if enabled.
      window.setTimeout(() => {
        try {
          const r = runRef.current;
          if (!voice || !autoStartTalking || !speech.supported) return;
          if (r?.runId && r.status === "WAITING_FOR_USER") speech.start();
        } catch {}
      }, 200);
    }
  };

  const speakAssistant = async (assistantText: string) => {
    const t = String(assistantText || "").trim();
    if (!speak || !t) return;
    try {
      setTtsError("");
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const rawText = await ttsRes.text();
      let tts: any = {};
      try {
        tts = rawText ? JSON.parse(rawText) : {};
      } catch {
        tts = { ok: false, error: rawText || "TTS returned non-JSON" };
      }

      if (!ttsRes.ok || !tts?.ok || !tts?.audio_base64) {
        const msg =
          String(tts?.error || rawText || "TTS failed").slice(0, 500);
        setTtsError(`TTS error (${ttsRes.status}): ${msg}`);
        return;
      }

      await playAudio(String(tts.audio_base64), String(tts.mime || "audio/mpeg"));
      setTtsLastOkAt(Date.now());
    } catch (e: any) {
      setTtsError(`TTS error: ${String(e?.message || e)}`.slice(0, 500));
    }
  };

  const refresh = async () => {
    if (!runId) return;
    const res = await fetch(`/api/handsfree/${runId}/status`, { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok && json?.run) setRun(json.run);
  };

  useEffect(() => {
    if (!runId) return;
    if (!isRunning) return;
    const id = window.setInterval(() => void refresh(), 750);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, isRunning]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [run?.messages?.length]);

  useEffect(() => {
    if (!speak) return;
    const msgs = run?.messages || [];
    if (!msgs.length) return;
    if (speakingRef.current) return;

    const pending = msgs
      .filter((m) => m.role === "assistant" && Number(m.at) > lastSpokenAtRef.current)
      .sort((a, b) => a.at - b.at);
    if (!pending.length) return;

    speakingRef.current = true;
    (async () => {
      try {
        for (const m of pending) {
          await speakAssistant(m.text);
          lastSpokenAtRef.current = Math.max(lastSpokenAtRef.current, Number(m.at) || 0);
        }
      } finally {
        speakingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.messages?.length, speak]);

  const stopListening = () => {
    setListening(false);
    if (segmentTimeoutRef.current) {
      window.clearTimeout(segmentTimeoutRef.current);
      segmentTimeoutRef.current = null;
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
    } catch {}
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    heardVoiceRef.current = false;
    lastVoiceAtRef.current = 0;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  const stopMic = () => {
    stopListening();
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;
    setMicBlocked(false);
    setMicError("");
  };

  const ensureMic = async () => {
    if (streamRef.current) return streamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia not available");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      setMicBlocked(false);
      setMicError("");
      return stream;
    } catch (e: any) {
      setMicBlocked(true);
      setMicError(String(e?.message || e || "Microphone permission error"));
      throw e;
    }
  };

  const startVADMonitor = () => {
    const stream = streamRef.current;
    if (!stream) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      const src = audioCtxRef.current.createMediaStreamSource(stream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;
    }

    const analyser = analyserRef.current;
    if (!analyser) return;

    const buf = new Uint8Array(analyser.fftSize);
    // Tune for responsiveness while avoiding cutoffs mid-sentence.
    const SILENCE_MS = 500;
    // Slightly more sensitive than before to avoid missing quiet mics.
    const THRESH = 0.012;
    const MIN_SPEECH_MS = 650;

    const tick = () => {
      if (!listening) return;
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      const now = Date.now();
      if (rms > THRESH) {
        if (!heardVoiceRef.current) {
          firstVoiceAtRef.current = now;
        }
        heardVoiceRef.current = true;
        lastVoiceAtRef.current = now;
      }
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === "recording" &&
        heardVoiceRef.current &&
        lastVoiceAtRef.current &&
        firstVoiceAtRef.current &&
        now - firstVoiceAtRef.current > MIN_SPEECH_MS &&
        now - lastVoiceAtRef.current > SILENCE_MS
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
  };

  const handleAudioTurn = async (blob: Blob) => {
    if (!runId) return;
    if (sttInFlightRef.current) return;
    // Avoid accidental double-sends in quick succession.
    if (Date.now() - lastSentAtRef.current < 300) return;

    sttInFlightRef.current = true;
    setBusy(true);
    try {
      setSttError("");
      const sttStart = Date.now();
      const fd = new FormData();
      const ext = extForMime(blob.type || recorderMimeRef.current);
      fd.set("file", blob, `audio.${ext}`);
      fd.set("language", "en");
      const sttRes = await fetch("/api/stt", { method: "POST", body: fd });
      const stt = await sttRes.json().catch(() => ({}));
      if (!sttRes.ok || !stt.ok) throw new Error(`STT error: ${stt?.error || "STT failed"}`);
      const transcript = String(stt.text || "").trim();
      setPerf((p) => ({ ...p, sttMs: Date.now() - sttStart }));
      if (!transcript) {
        // Not fatal: just retry listening (quiet mic / noise suppression).
        setSttError("Empty transcript (retrying…)");
        return;
      }
      setLastTranscript(transcript);
      setSttLastOkAt(Date.now());

      lastSentAtRef.current = Date.now();
      const agentStart = Date.now();
      const res = await fetch(`/api/handsfree/${runId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(`Agent error: ${json?.error || "Input failed"}`);
      setPerf((p) => ({ ...p, agentMs: Date.now() - agentStart }));
      setRun(json.run as HandsFreeRun);
    } catch (e: any) {
      setSttError(String(e?.message || e).slice(0, 500));
    } finally {
      sttInFlightRef.current = false;
      setBusy(false);
    }
  };

  const startListeningSegment = async () => {
    if (!voice) return;
    if (!runId) return;
    if (!isWaiting) return;
    if (listening) return;
    // Don't listen while assistant is speaking / audio is playing.
    if (speakingRef.current) return;
    if (audioRef.current && !audioRef.current.paused) return;
    if (sttInFlightRef.current) return;

    try {
      await ensureMic();
    } catch {
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;

    // Reset segment state
    heardVoiceRef.current = false;
    lastVoiceAtRef.current = 0;
    firstVoiceAtRef.current = 0;
    chunksRef.current = [];

    const mime = pickRecorderMime();
    recorderMimeRef.current = mime;
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      setListening(false);
      if (segmentTimeoutRef.current) {
        window.clearTimeout(segmentTimeoutRef.current);
        segmentTimeoutRef.current = null;
      }
      const blobType = recorderMimeRef.current || mr.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      chunksRef.current = [];
      if (recordStartedAtRef.current) {
        setPerf((p) => ({ ...p, recordMs: Date.now() - recordStartedAtRef.current }));
      }

      // If VAD didn't trip, we used to discard the segment.
      // In practice, quiet mics often fail VAD; if we captured a non-trivial blob,
      // still send it to STT rather than dropping user speech.
      const hasAudio = blob.size >= 8000; // ~0.5s+ typically
      const shouldStt = heardVoiceRef.current || hasAudio;
      if (!shouldStt) {
        return;
      }
      await handleAudioTurn(blob);
    };

    mediaRecorderRef.current = mr;
    setListening(true);
    recordStartedAtRef.current = Date.now();
    mr.start();
    startVADMonitor();

    // Safety: cap each segment length (prevents long waits if VAD misses).
    segmentTimeoutRef.current = window.setTimeout(() => {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.stop();
      } catch {}
    }, 12000);

    // If we haven't detected any speech quickly, stop and restart (keeps loop snappy).
    window.setTimeout(() => {
      try {
        if (!voice) return;
        const r = runRef.current;
        if (!r?.runId || r.status !== "WAITING_FOR_USER") return;
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") return;
        if (!heardVoiceRef.current) {
          mediaRecorderRef.current.stop();
        }
      } catch {}
    }, 2500);
  };

  useEffect(() => {
    // Hands-free voice (browser SpeechRecognition): auto-start when waiting.
    if (!voice || !speech.supported) {
      if (speech.listening) speech.stop();
      return;
    }
    if (!autoStartTalking) return;

    if (mode === "FULL_REVIEW") {
      if (runId && isWaiting) {
        // Don't listen while assistant audio is playing.
        if (audioRef.current && !audioRef.current.paused) return;
        speech.start();
      } else if (speech.listening) {
        speech.stop();
      }
    } else {
      // Category update mode: keep listening while the category panel is active.
      if (selectedCategory) {
        if (audioRef.current && !audioRef.current.paused) return;
        speech.start();
      } else if (speech.listening) {
        speech.stop();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, speech.supported, autoStartTalking, mode, runId, isWaiting, run?.updatedAt, selectedCategory]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      try {
        if (lastAudioUrlRef.current) URL.revokeObjectURL(lastAudioUrlRef.current);
      } catch {}
      stopMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    if (!canStart) return;
    if (speak) await unlockAudio();
    setBusy(true);
    try {
      setPerf({});
      const res = await fetch("/api/handsfree/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: Number(orgId), repName }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Start failed");
      lastSpokenAtRef.current = 0;
      setRun(json.run as HandsFreeRun);
      setMode("FULL_REVIEW");
    } catch (e: any) {
      setRun({
        runId: "",
        sessionId: "",
        status: "ERROR",
        error: e?.message || String(e),
        masterPromptSha256: undefined,
        masterPromptLoadedAt: undefined,
        messages: [],
        modelCalls: 0,
        updatedAt: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  };

  const sendAnswer = async () => {
    await submitText(answer);
  };

  const startCategoryUpdate = async (categoryKey: typeof categories[number]["key"]) => {
    const oppId = Number(opportunityId);
    if (!oppId) {
      appendCat("system", "Enter an opportunity id first.");
      setMode("CATEGORY_UPDATE");
      setSelectedCategory(categoryKey);
      return;
    }
    setMode("CATEGORY_UPDATE");
    setSelectedCategory(categoryKey);
    setCatSessionId("");
    setCatMessages([]);
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${oppId}/update-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: Number(orgId),
          sessionId: undefined,
          category: categoryKey,
          text: "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Start failed");
      if (json?.sessionId) setCatSessionId(String(json.sessionId));
      if (json?.assistantText) appendCat("assistant", String(json.assistantText));
    } catch (e: any) {
      appendCat("system", `Error: ${String(e?.message || e)}`.slice(0, 500));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    stopMic();
    setRun(null);
    setAnswer("");
    setBusy(false);
    setMode("FULL_REVIEW");
    setSelectedCategory("");
    setCatSessionId("");
    setCatMessages([]);
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", maxWidth: 980, margin: "0 auto" }}>
      <h1>Forecast Agent (Hands-Free, non‑Realtime)</h1>

      <p style={{ marginTop: 6, color: "#555" }}>
        Build: <code>{BUILD_TAG}</code> · Runner is server-driven (Start once, then auto-advances until it needs you).
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Rep name</span>
          <input
            value={repName}
            onChange={(e) => setRepName(e.target.value)}
            style={{ padding: 8, minWidth: 220 }}
            disabled={!!runId || busy}
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Org ID</span>
          <input
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            style={{ padding: 8, width: 120 }}
            disabled={!!runId || busy}
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Opportunity ID (for Category Update)</span>
          <input
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            style={{ padding: 8, width: 200 }}
            disabled={busy}
            inputMode="numeric"
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} disabled={busy} />
          Speak
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} disabled={busy} />
          Voice (hands-free, browser)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={autoStartTalking}
            onChange={(e) => setAutoStartTalking(e.target.checked)}
            disabled={busy || !voice}
          />
          Auto-start “Start talking”
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Silence submit (ms)</span>
          <input
            value={String(submitOnSilenceMs)}
            onChange={(e) => setSubmitOnSilenceMs(Number(e.target.value || "900") || 900)}
            style={{ padding: 8, width: 160 }}
            disabled={busy || !voice}
            inputMode="numeric"
          />
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={start} disabled={!canStart}>
            Run Full Review
          </button>
          <button onClick={restart} disabled={busy}>
            Restart
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #e5e5e5", background: "#fafafa" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <strong>Category Update</strong>
          <span style={{ color: "#666", fontSize: 12 }}>
            (updates only one category; does not run the full rubric)
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {categories.map((c) => (
            <button
              key={c.key}
              onClick={() => void startCategoryUpdate(c.key)}
              disabled={busy}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: selectedCategory === c.key && mode === "CATEGORY_UPDATE" ? "#e8f0fe" : "#fff",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        {!speech.supported ? (
          <div style={{ marginTop: 10, color: "#b26a00" }}>
            Browser speech recognition is unavailable here. You can still type.
          </div>
        ) : null}
        {speech.error ? (
          <div style={{ marginTop: 10, color: "#b26a00" }}>
            Speech recognition: <code>{speech.error}</code>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            Status:{" "}
            <strong>
              {run?.status || "(not started)"}
            </strong>
          </div>
          {runId ? (
            <div>
              Run: <code>{runId}</code> · Model calls: <code>{run?.modelCalls ?? 0}</code>
            </div>
          ) : null}
          {run?.masterPromptSha256 ? (
            <div>
              Master prompt: <code>{run.masterPromptSha256.slice(0, 12)}…</code>
              {run.masterPromptLoadedAt ? (
                <>
                  {" "}
                  (<span style={{ color: "#666" }}>{new Date(run.masterPromptLoadedAt).toLocaleString()}</span>)
                </>
              ) : null}
            </div>
          ) : null}
          {run?.error ? <div style={{ color: "#b00020" }}>Error: {run.error}</div> : null}
        </div>
      </div>

      {audioBlocked ? (
        <div style={{ marginTop: 12, color: "#b26a00" }}>
          Audio is blocked by the browser. Click <strong>Start</strong> again or interact with the page to enable audio playback.
        </div>
      ) : null}
      {micBlocked ? (
        <div style={{ marginTop: 12, color: "#b00020" }}>
          Microphone permission is blocked. Allow microphone access for this site to use hands-free voice replies.
          {micError ? <div style={{ marginTop: 6, color: "#b00020" }}>{micError}</div> : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        style={{
          marginTop: 16,
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 12,
          height: 420,
          overflow: "auto",
          background: "#fff",
        }}
      >
        {(mode === "FULL_REVIEW" ? run?.messages : catMessages)?.length ? (
          (mode === "FULL_REVIEW" ? run?.messages || [] : catMessages).map((m, i) => (
            <div key={`${m.at}-${i}`} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#666" }}>
                <strong style={{ color: m.role === "assistant" ? "#1a73e8" : m.role === "user" ? "#0b8043" : "#666" }}>
                  {m.role.toUpperCase()}
                </strong>{" "}
                · {new Date(m.at).toLocaleTimeString()}
              </div>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{m.text}</div>
            </div>
          ))
        ) : (
          <div style={{ color: "#666" }}>
            Click <strong>Run Full Review</strong> to begin (Mode A), or choose a category above to update just that category (Mode B).
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Audio</strong>
        <div style={{ marginTop: 6 }}>
          <audio ref={audioRef} controls style={{ width: "100%" }} />
        </div>
        {ttsError ? (
          <div style={{ marginTop: 8, color: "#b00020", whiteSpace: "pre-wrap" }}>{ttsError}</div>
        ) : null}
        {!ttsError && ttsLastOkAt ? (
          <div style={{ marginTop: 8, color: "#666" }}>
            Last TTS OK: <code>{new Date(ttsLastOkAt).toLocaleTimeString()}</code>
          </div>
        ) : null}
        {sttError ? (
          <div style={{ marginTop: 8, color: "#b00020", whiteSpace: "pre-wrap" }}>Turn error: {sttError}</div>
        ) : null}
        {!sttError && sttLastOkAt ? (
          <div style={{ marginTop: 8, color: "#666" }}>
            Last STT OK: <code>{new Date(sttLastOkAt).toLocaleTimeString()}</code>
          </div>
        ) : null}
        {lastTranscript ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Last transcript</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{lastTranscript}</div>
          </div>
        ) : null}
        {perf.recordMs || perf.sttMs || perf.agentMs ? (
          <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
            Timings:{" "}
            {typeof perf.recordMs === "number" ? <span>record {perf.recordMs}ms · </span> : null}
            {typeof perf.sttMs === "number" ? <span>stt {perf.sttMs}ms · </span> : null}
            {typeof perf.agentMs === "number" ? <span>agent {perf.agentMs}ms</span> : null}
          </div>
        ) : null}
      </div>

      {isRunning ? (
        <div style={{ marginTop: 12, color: "#555" }}>Running… (auto-advancing)</div>
      ) : null}

      {isWaiting ? (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #e5e5e5", background: "#fafafa" }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Input required</strong> (the runner is paused)
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {voice && speech.supported ? (
              <>
                <button
                  onClick={() => (speech.listening ? speech.stop() : speech.start())}
                  disabled={busy}
                >
                  {speech.listening ? "Stop talking" : "Start talking"}
                </button>
                <span style={{ color: "#666", fontSize: 12 }}>
                  {speech.listening ? "Listening…" : "Mic idle"}
                </span>
              </>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={speech.combinedText ? speech.combinedText : "Type your answer…"}
              style={{ flex: 1, padding: 10 }}
              disabled={busy || !runId}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendAnswer();
              }}
            />
            <button onClick={sendAnswer} disabled={busy || !runId || !answer.trim()}>
              Send
            </button>
          </div>
        </div>
      ) : null}

      {isCatWaiting ? (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #e5e5e5", background: "#fafafa" }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Category input</strong>
            {selectedCategory ? (
              <span style={{ color: "#666" }}>
                {" "}
                · Selected: <code>{selectedCategory}</code>
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {voice && speech.supported ? (
              <>
                <button
                  onClick={() => (speech.listening ? speech.stop() : speech.start())}
                  disabled={busy}
                >
                  {speech.listening ? "Stop talking" : "Start talking"}
                </button>
                <span style={{ color: "#666", fontSize: 12 }}>
                  {speech.listening ? "Listening…" : "Mic idle"}
                </span>
              </>
            ) : (
              <span style={{ color: "#666", fontSize: 12 }}>Voice off (typing only).</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={speech.combinedText ? speech.combinedText : "Type your answer…"}
              style={{ flex: 1, padding: 10 }}
              disabled={busy || !selectedCategory}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendAnswer();
              }}
            />
            <button onClick={sendAnswer} disabled={busy || !selectedCategory || !answer.trim()}>
              Send
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
