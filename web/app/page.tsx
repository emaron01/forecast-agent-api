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

function extractWrap(text: string) {
  const t = String(text || "");
  const riskMatch = t.match(/Updated\s+Risk\s+Summary:\s*([\s\S]*?)(?:Suggested\s+Next\s+Steps:|$)/i);
  const nextMatch = t.match(/Suggested\s+Next\s+Steps:\s*([\s\S]*)$/i);
  const riskSummary = String(riskMatch?.[1] || "").trim();
  const nextSteps = String(nextMatch?.[1] || "").trim();
  return { riskSummary, nextSteps };
}

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

  const startFullDealReview = async () => {
    if (busy) return;
    if (speak) await unlockAudio();
    setBusy(true);
    try {
      const oppId = Number(opportunityId);
      if (oppId) {
        const res = await fetch(`/api/opportunities/${oppId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId: Number(orgId), repName }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Full deal review failed");
        lastSpokenAtRef.current = 0;
        setRun(json.run as HandsFreeRun);
        setMode("FULL_REVIEW");
        return;
      }
      await start();
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

  const activeMessages = mode === "FULL_REVIEW" ? run?.messages || [] : catMessages;
  const lastAssistantText = useMemo(() => {
    const last = [...activeMessages].reverse().find((m) => m.role === "assistant")?.text || "";
    return String(last || "").trim();
  }, [activeMessages]);
  const wrap = useMemo(() => extractWrap(lastAssistantText), [lastAssistantText]);

  return (
    <main className="wrap">
      <div className="top">
        <div>
          <h1>Forecast Agent – Audit Dashboard</h1>
          <div className="sub">
            Hands-free dashboard for Full Deal Review (Mode A) and Category Update (Mode B). Build: <code>{BUILD_TAG}</code>
          </div>
        </div>

        <div className="row">
          <label className="small">Org</label>
          <input value={orgId} onChange={(e) => setOrgId(e.target.value)} style={{ width: 90 }} disabled={busy} />
          <label className="small">Rep</label>
          <input value={repName} onChange={(e) => setRepName(e.target.value)} style={{ width: 180 }} disabled={!!runId || busy} />
          <label className="small">Opportunity</label>
          <input
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            style={{ width: 130 }}
            placeholder="123"
            disabled={busy}
            inputMode="numeric"
          />
          <label className="small">
            <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} disabled={busy} /> Speak
          </label>
          <label className="small">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} disabled={busy} /> Voice
          </label>
          <label className="small">
            <input
              type="checkbox"
              checked={autoStartTalking}
              onChange={(e) => setAutoStartTalking(e.target.checked)}
              disabled={busy || !voice}
            />{" "}
            Auto-start
          </label>
          <label className="small">Silence ms</label>
          <input
            value={String(submitOnSilenceMs)}
            onChange={(e) => setSubmitOnSilenceMs(Number(e.target.value || "900") || 900)}
            style={{ width: 110 }}
            disabled={busy || !voice}
            inputMode="numeric"
          />
          <button onClick={restart} disabled={busy}>
            Reset
          </button>
        </div>
      </div>

      <div className="status">
        <div className="row">
          <span className={`pill ${run?.error ? "err" : runId ? "ok" : "warn"}`}>
            {run?.error ? "ERROR" : runId ? "OK" : "IDLE"}
          </span>
          <span className="pill">
            Mode: <b>{mode === "FULL_REVIEW" ? "Full Deal Review" : "Category Update"}</b>
          </span>
          <span className="pill">
            Status: <b>{run?.status || "—"}</b>
          </span>
          {runId ? (
            <span className="pill">
              Run: <code>{runId.slice(0, 8)}…</code>
            </span>
          ) : null}
          <span className="pill">
            Listening: <b>{speech.listening ? "ON" : "OFF"}</b>
          </span>
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
                Opportunity <span style={{ color: "var(--muted)" }}>#{opportunityId || "—"}</span>
              </div>
              <div className="kv">
                <b>Org:</b> {orgId} · <b>Rep:</b> {repName || "—"} · <b>Selected category:</b>{" "}
                {selectedCategory ? (
                  <span style={{ color: "var(--accent)" }}>
                    {categories.find((c) => c.key === selectedCategory)?.label || selectedCategory}
                  </span>
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div className="meta">
              {speech.supported ? <span className="pill ok">Speech OK</span> : <span className="pill warn">Speech N/A</span>}
              {audioBlocked ? <span className="pill warn">Audio blocked</span> : null}
              {micBlocked ? <span className="pill err">Mic blocked</span> : null}
            </div>
          </div>

          <div className="cols">
            <div className="box">
              <h3>Risk Summary</h3>
              <p>{wrap.riskSummary || "—"}</p>
            </div>
            <div className="box">
              <h3>Next Steps</h3>
              <div style={{ marginBottom: 10 }}>
                <button className="btnPrimary" onClick={startFullDealReview} disabled={busy}>
                  Full Deal Review
                </button>
              </div>
              <p>
                <b>Next steps:</b> {wrap.nextSteps || "—"}
              </p>
              {run?.masterPromptSha256 ? (
                <p style={{ marginTop: 6 }} className="small">
                  Master prompt: <code>{run.masterPromptSha256.slice(0, 12)}…</code>
                </p>
              ) : null}
            </div>
          </div>

          <div className="med">
            {categories.map((c) => (
              <div key={c.key} className={`cat ${selectedCategory === c.key ? "active" : ""}`}>
                <div className="ch">
                  <b>{c.label}</b>
                  <span className="score">{selectedCategory === c.key && mode === "CATEGORY_UPDATE" ? "Updating" : ""}</span>
                </div>
                <div className="evi">Update only this category and recompute rollup.</div>
                <div className="catBtnRow">
                  <button onClick={() => void startCategoryUpdate(c.key)} disabled={busy}>
                    Update
                  </button>
                </div>
              </div>
            ))}
          </div>

          <details style={{ marginTop: 12 }}>
            <summary className="small">Conversation</summary>
            <div ref={scrollRef} className="chat">
              {activeMessages?.length ? (
                activeMessages.map((m, i) => (
                  <div key={`${m.at}-${i}`} className="msg">
                    <div className="msgMeta">
                      <strong className={`role ${m.role}`}>{m.role.toUpperCase()}</strong> ·{" "}
                      {new Date(m.at).toLocaleTimeString()}
                    </div>
                    <div className="msgBody">{m.text}</div>
                  </div>
                ))
              ) : (
                <div className="small">Click a category Update button or run Full Deal Review.</div>
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
                  : "Category update — answer the targeted question."}
              </div>
              {voice && speech.supported ? (
                <button onClick={() => (speech.listening ? speech.stop() : speech.start())} disabled={busy}>
                  {speech.listening ? "Stop talking" : "Start talking"}
                </button>
              ) : (
                <span className="small">Voice off (typing only).</span>
              )}
            </div>

            {speech.error ? (
              <div className="small" style={{ marginTop: 8, color: "var(--warn)" }}>
                Speech: <code>{speech.error}</code>
              </div>
            ) : null}
            {micError ? (
              <div className="small" style={{ marginTop: 8, color: "var(--bad)" }}>
                Mic: {micError}
              </div>
            ) : null}

            <div className="row" style={{ marginTop: 10, width: "100%" }}>
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={speech.combinedText ? speech.combinedText : "Type your answer…"}
                style={{ flex: 1, minWidth: 260 }}
                disabled={busy || (mode === "FULL_REVIEW" ? !runId : !selectedCategory)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendAnswer();
                }}
              />
              <button onClick={sendAnswer} disabled={busy || !answer.trim()}>
                Send
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="hdr">
            <div className="title">Audio</div>
            <div className="meta">
              {ttsError ? <span className="pill err">TTS error</span> : <span className="pill">TTS</span>}
              {sttError ? <span className="pill err">STT error</span> : <span className="pill">STT</span>}
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <audio ref={audioRef} controls style={{ width: "100%" }} />
          </div>
          {ttsError ? <div className="small" style={{ marginTop: 10, color: "var(--bad)" }}>{ttsError}</div> : null}
          {sttError ? <div className="small" style={{ marginTop: 10, color: "var(--bad)" }}>{sttError}</div> : null}
          {lastTranscript ? (
            <div style={{ marginTop: 10 }}>
              <div className="small">Last transcript</div>
              <div className="small" style={{ whiteSpace: "pre-wrap" }}>{lastTranscript}</div>
            </div>
          ) : null}
        </div>
      </div>

      <style jsx global>{`
        :root {
          --bg: #0b1220;
          --panel: #121b2e;
          --panel2: #0f172a;
          --border: #24324d;
          --text: #e6edf7;
          --muted: #9fb0c8;
          --accent: #60a5fa;
          --good: #22c55e;
          --warn: #f59e0b;
          --bad: #ef4444;
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
          box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.18);
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
          border-color: rgba(96, 165, 250, 0.45);
          background: linear-gradient(180deg, rgba(96, 165, 250, 0.18), rgba(96, 165, 250, 0.06));
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
          flex-wrap: wrap;
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
          border-color: rgba(34, 197, 94, 0.35);
        }
        .pill.err {
          color: var(--bad);
          border-color: rgba(239, 68, 68, 0.35);
        }
        .pill.warn {
          color: var(--warn);
          border-color: rgba(245, 158, 11, 0.35);
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
          margin-top: 6px;
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
        @media (max-width: 900px) {
          .cols {
            grid-template-columns: 1fr;
          }
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
          white-space: pre-wrap;
        }
        .med {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 10px;
        }
        .cat {
          background: #0f172a;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 120px;
        }
        .cat.active {
          outline: 2px solid rgba(96, 165, 250, 0.25);
        }
        .cat .ch {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cat .ch b {
          font-size: 13px;
        }
        .score {
          font-weight: 900;
          color: var(--muted);
          font-size: 12px;
        }
        .evi {
          color: var(--muted);
          font-size: 11px;
        }
        .catBtnRow {
          margin-top: auto;
          display: flex;
          justify-content: center; /* center update buttons under each category */
        }
        details {
          margin-top: 12px;
        }
        .small {
          font-size: 11px;
          color: var(--muted);
        }
        .chat {
          margin-top: 10px;
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
          max-height: 360px;
          overflow: auto;
        }
        .msg {
          margin-bottom: 10px;
        }
        .msgMeta {
          font-size: 12px;
          color: var(--muted);
          margin-bottom: 4px;
        }
        .msgBody {
          white-space: pre-wrap;
          line-height: 1.4;
          font-size: 13px;
        }
        .role.assistant {
          color: var(--accent);
        }
        .role.user {
          color: var(--good);
        }
        .role.system {
          color: var(--muted);
        }
        .inputCard {
          margin-top: 12px;
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
        }
      `}</style>
    </main>
  );
}
