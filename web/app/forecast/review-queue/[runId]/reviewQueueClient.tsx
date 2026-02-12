"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type DealHeader = {
  public_id: string;
  account_name: string;
  opportunity_name: string;
  rep_name: string;
  forecast_stage: string;
  close_date: string | null;
  amount: number | null;
  updated_at: string | null;
};

function safeDate(d: any) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : "—";
}

function pickRecorderMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const t of candidates) {
    try {
      if ((window as any).MediaRecorder?.isTypeSupported?.(t)) return t;
    } catch {}
  }
  return "";
}

function b64ToBlob(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

export function ReviewQueueClient(props: { runId: string }) {
  const runId = String(props.runId || "").trim();

  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<HandsFreeRun | null>(null);
  const [deal, setDeal] = useState<DealHeader | null>(null);
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  const [speak, setSpeak] = useState(true);
  const [voice, setVoice] = useState(true);
  const [keepMicOpen, setKeepMicOpen] = useState(true);

  // Mic tuning / capture controls (mirrors single-deal view).
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

  const micLevelRef = useRef(0);
  const micPeakRef = useRef(0);
  const voiceActiveRef = useRef(false);
  const heardVoiceRef = useRef(false);
  const firstVoiceAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);

  const runRef = useRef<HandsFreeRun | null>(null);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

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
      try {
        mediaRecorderRef.current?.stop();
      } catch {}
      mediaRecorderRef.current = null;
      chunksRef.current = [];
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
    const bufLen = 2048;
    const buf = new Uint8Array(bufLen);
    let lastUiAt = 0;
    const tick = () => {
      meterRafRef.current = requestAnimationFrame(tick);
      const a = analyserRef.current;
      if (!a || !micOpen) return;
      a.getByteTimeDomainData(buf);
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
        if (!streamRef.current) await ensureMic();
        startMicMeter();
        if (autoMicNormalize) void runMicTune(`auto_${reason}`);
      } catch (e: any) {
        setMicError(String(e?.message || e || "Microphone permission error"));
      } finally {
        if (!keepMicOpen) {
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
    async (text: string) => {
      if (!speak) return;
      const t = String(text || "").trim();
      if (!t) return;
      try {
        setTtsError("");
        speakingRef.current = true;
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
        await el.play().catch(() => {
          throw new Error("Audio playback blocked (click Play in the Audio panel).");
        });
      } catch (e: any) {
        setTtsError(String(e?.message || e).slice(0, 220));
      }
    },
    [speak]
  );

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => {
      speakingRef.current = false;
    };
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, []);

  const sendToStt = useCallback(async (blob: Blob) => {
    const mime = blob.type || "audio/webm";
    const ext = mime.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `audio.${ext}`, { type: mime });
    const form = new FormData();
    form.set("file", file, file.name);
    const res = await fetch("/api/stt", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error || "STT failed");
    return String(json?.text || "").trim();
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
    const streamToUse = processedStreamRef.current || streamRef.current;
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
    if (voiceActiveRef.current) return;
    closeMicStreamOnly();
  }, [closeMicStreamOnly, keepMicOpen]);

  const captureOneUtteranceAndSend = useCallback(async () => {
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
      const THRESH = 0.01;

      heardVoiceRef.current = false;
      lastVoiceAtRef.current = 0;
      firstVoiceAtRef.current = 0;

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

      const sendTranscript = async (text: string) => {
        setLastTranscript(text);
        const waitingSeq = runRef.current?.waitingSeq;
        const res = await fetch(`/api/deal-review/${encodeURIComponent(runId)}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, waitingSeq }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Send failed");
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
          if (!transcript) throw new Error("Empty transcript (check mic/tune and try again)");
          await sendTranscript(transcript);
          maybeCloseMicForPrivacy();
          return;
        }

        if (!heard && now - started >= NO_SPEECH_RESTART_MS) {
          await stopAll();
          voiceActiveRef.current = false;
          setListening(false);
          setSttError("No microphone input detected. Check mic device/permissions or click Prime mic now.");
          maybeCloseMicForPrivacy();
          return;
        }

        if (now - started >= MAX_SEGMENT_MS) {
          const rec = await stopAll();
          voiceActiveRef.current = false;
          setListening(false);
          if (!rec) return;
          const transcript = await sendToStt(rec.blob);
          if (!transcript) throw new Error("Empty transcript (max segment reached)");
          await sendTranscript(transcript);
          maybeCloseMicForPrivacy();
          return;
        }

        meterRafRef.current = requestAnimationFrame(() => void loop());
      };

      if (segmentTimeoutRef.current) window.clearTimeout(segmentTimeoutRef.current);
      segmentTimeoutRef.current = window.setTimeout(() => {
        void stopAll().finally(() => {
          voiceActiveRef.current = false;
          setListening(false);
          maybeCloseMicForPrivacy();
        });
      }, Math.max(2000, Number(micMaxSegmentMs) || 12000));

      await loop();
    } catch (e: any) {
      setSttError(String(e?.message || e).slice(0, 300));
      voiceActiveRef.current = false;
      setListening(false);
      maybeCloseMicForPrivacy();
    }
  }, [
    ensureMic,
    maybeCloseMicForPrivacy,
    micMaxSegmentMs,
    micMinSpeechMs,
    micNoSpeechRestartMs,
    micVadSilenceMs,
    runId,
    sendToStt,
    startMicMeter,
    startRecorder,
    stopRecorder,
    voice,
  ]);

  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/deal-review/${encodeURIComponent(runId)}/status`, { cache: "no-store" }),
        fetch(`/api/deal-review/${encodeURIComponent(runId)}/current`, { cache: "no-store" }),
      ]);
      const j1 = await r1.json().catch(() => ({}));
      const j2 = await r2.json().catch(() => ({}));
      if (r1.ok && j1?.ok && j1?.run) setRun(j1.run as HandsFreeRun);
      if (r2.ok && j2?.ok) {
        setIndex(Number(j2.index || 0) || 0);
        setTotal(Number(j2.total || 0) || 0);
        setDeal((j2.deal as DealHeader) || null);
      }
    } catch {}
  }, [runId]);

  // Poll while active.
  useEffect(() => {
    let alive = true;
    const t = window.setInterval(() => {
      if (!alive) return;
      void refresh();
    }, 900);
    void refresh();
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [refresh]);

  const status = run?.status || "DONE";
  const isWaiting = status === "WAITING_FOR_USER";
  const isRunning = status === "RUNNING";

  // Speak new assistant messages + auto-capture when waiting.
  const lastSpokenAssistantAtRef = useRef<number>(0);
  useEffect(() => {
    const msgs = Array.isArray(run?.messages) ? run!.messages : [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && speak) {
      const at = Number(lastAssistant.at || 0) || 0;
      if (at && at > (lastSpokenAssistantAtRef.current || 0)) {
        lastSpokenAssistantAtRef.current = at;
        void playTts(lastAssistant.text);
      }
    }
    if (isWaiting && voice && !speakingRef.current) {
      void captureOneUtteranceAndSend();
    }
    if ((status === "DONE" || status === "ERROR") && !keepMicOpen) {
      closeMicStreamOnly();
    }
  }, [captureOneUtteranceAndSend, closeMicStreamOnly, isWaiting, keepMicOpen, playTts, run?.messages, speak, status, voice]);

  useEffect(() => {
    if (voice) return;
    closeMicStreamOnly();
  }, [closeMicStreamOnly, voice]);

  async function sendAnswer() {
    const text = String(answer || "").trim();
    if (!text) return;
    setAnswer("");
    setBusy(true);
    setError("");
    try {
      const waitingSeq = runRef.current?.waitingSeq;
      const res = await fetch(`/api/deal-review/${encodeURIComponent(runId)}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, waitingSeq }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Send failed");
      void refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function stopNow() {
    setBusy(true);
    try {
      await fetch(`/api/deal-review/${encodeURIComponent(runId)}/stop`, { method: "POST" }).catch(() => null);
    } finally {
      setBusy(false);
      closeMicStreamOnly();
      void refresh();
    }
  }

  const header = useMemo(() => {
    if (!deal) return null;
    return (
      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
              {deal.account_name || "Account"}{" "}
              <span className="text-[color:var(--sf-text-secondary)]">
                · {deal.opportunity_name || "—"} · {deal.forecast_stage || "—"}
              </span>
            </div>
            <div className="mt-2 text-xs text-[color:var(--sf-text-disabled)]">
              Rep: <span className="font-medium text-[color:var(--sf-text-primary)]">{deal.rep_name || "—"}</span> · Close:{" "}
              <span className="font-medium text-[color:var(--sf-text-primary)]">{deal.close_date || "—"}</span> · Updated:{" "}
              <span className="font-medium text-[color:var(--sf-text-primary)]">{safeDate(deal.updated_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[color:var(--sf-text-secondary)]">
              Deal {Math.min(total, index + 1)}/{total || "—"}
            </span>
            {deal.public_id ? (
              <Link
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                href={`/opportunities/${encodeURIComponent(deal.public_id)}/deal-review`}
              >
                Open single deal view
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }, [deal, index, total]);

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Review Queue</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Group review: one deal at a time, then the agent advances automatically. Return to{" "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href="/forecast/simple">
                simple dashboard
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">
              <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} disabled={busy} /> Speak
            </label>
            <label className="text-xs text-[color:var(--sf-text-secondary)]">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} disabled={busy} /> Voice
            </label>
            <label
              className="text-xs text-[color:var(--sf-text-secondary)]"
              title="Stability mode keeps the mic open during the session. Turn off for strict privacy."
            >
              <input type="checkbox" checked={keepMicOpen} onChange={(e) => setKeepMicOpen(e.target.checked)} disabled={busy || !voice} /> Keep mic open
            </label>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
              disabled={busy}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void stopNow()}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
              disabled={busy}
            >
              Stop
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-sm text-[color:var(--sf-text-secondary)]">
          <div>
            Status:{" "}
            <span className="font-semibold">
              {status === "RUNNING" ? "RUNNING" : status === "WAITING_FOR_USER" ? "WAITING_FOR_USER" : status}
            </span>
            {run?.error ? <span className="ml-2 text-[#E74C3C]">· {run.error}</span> : null}
          </div>
          <div className="text-xs text-[color:var(--sf-text-secondary)]">
            Listening: <span className="font-semibold">{listening ? "ON" : "OFF"}</span> · Mic:{" "}
            <span className="font-semibold">{micOpen ? "ON" : "OFF"}</span>
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] p-3 text-sm text-[color:var(--sf-text-primary)]">
            {error}
          </div>
        ) : null}
        {micError ? <div className="mt-3 text-xs text-[#E74C3C]">Mic: {micError}</div> : null}
        {sttError ? <div className="mt-2 text-xs text-[#E74C3C]">STT: {sttError}</div> : null}
        {ttsError ? <div className="mt-2 text-xs text-[#E74C3C]">TTS: {ttsError}</div> : null}
      </section>

      {header}

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <details open>
          <summary className="cursor-pointer text-sm font-medium text-[color:var(--sf-text-primary)]">Mic tuning</summary>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Device</label>
            <select
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              value={selectedMicDeviceId}
              onChange={(e) => setSelectedMicDeviceId(e.target.value)}
              disabled={busy}
            >
              <option value="">(system default)</option>
              {micDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <label className="text-xs text-[color:var(--sf-text-secondary)]">
              <input type="checkbox" checked={micRawMode} onChange={(e) => setMicRawMode(e.target.checked)} disabled={busy} /> Raw
            </label>
            <label className="text-xs text-[color:var(--sf-text-secondary)]">
              <input type="checkbox" checked={autoMicNormalize} onChange={(e) => setAutoMicNormalize(e.target.checked)} disabled={busy} /> Auto
            </label>
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Gain</label>
            <input
              className="w-[90px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              value={String(micGain)}
              onChange={(e) => setMicGain(Number(e.target.value || "2.5") || 2.5)}
              disabled={busy}
            />
            <span className="text-xs text-[color:var(--sf-text-secondary)]">
              level <span className="font-semibold">{micLevel.toFixed(3)}</span> · peak{" "}
              <span className="font-semibold">{micPeak}</span>
              {micTrackLabel ? <span className="ml-1 text-[color:var(--sf-text-disabled)]">· {micTrackLabel}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => void refreshMicDevices()}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              disabled={busy}
            >
              Refresh devices
            </button>
            <button
              type="button"
              onClick={() => void primeMicPermissionFromGesture("manual_prime")}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              disabled={busy || !voice}
            >
              Prime mic
            </button>
            <button
              type="button"
              onClick={() => void runMicTune("manual")}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              disabled={busy || !voice}
            >
              Mic Tune
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Silence</label>
            <input
              className="w-[110px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              value={String(micVadSilenceMs)}
              onChange={(e) => setMicVadSilenceMs(Number(e.target.value || "650") || 650)}
              disabled={busy}
            />
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Min speech</label>
            <input
              className="w-[110px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              value={String(micMinSpeechMs)}
              onChange={(e) => setMicMinSpeechMs(Number(e.target.value || "350") || 350)}
              disabled={busy}
            />
            <label className="text-xs text-[color:var(--sf-text-secondary)]">No-speech</label>
            <input
              className="w-[130px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              value={String(micNoSpeechRestartMs)}
              onChange={(e) => setMicNoSpeechRestartMs(Number(e.target.value || "6000") || 6000)}
              disabled={busy}
            />
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Max</label>
            <input
              className="w-[110px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              value={String(micMaxSegmentMs)}
              onChange={(e) => setMicMaxSegmentMs(Number(e.target.value || "70000") || 70000)}
              disabled={busy}
            />
          </div>

          {micTuneStatus ? <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{micTuneStatus}</div> : null}
          {lastTranscript ? (
            <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
              <span className="font-semibold">Last transcript:</span> {lastTranscript}
            </div>
          ) : null}
        </details>
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Conversation</div>
            <div className="mt-3 max-h-[360px] overflow-auto rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-xs text-[color:var(--sf-text-primary)]">
              {(run?.messages || []).length ? (
                (run!.messages || []).map((m, i) => (
                  <div key={`${m.at}-${i}`} className="mb-3">
                    <div className="text-[11px] text-[color:var(--sf-text-disabled)]">
                      <span className="font-semibold">{m.role.toUpperCase()}</span> · {new Date(m.at).toLocaleTimeString()}
                    </div>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))
              ) : (
                <div className="text-[color:var(--sf-text-disabled)]">Waiting…</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Answer</div>
            <div className="mt-3 flex items-center gap-2">
              <input
                className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={isWaiting ? "Type your answer…" : "Waiting for next question…"}
                disabled={busy || !isWaiting}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendAnswer();
                }}
              />
              <button
                type="button"
                onClick={() => void sendAnswer()}
                className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
                disabled={busy || !isWaiting || !answer.trim()}
              >
                Send
              </button>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Audio</div>
              <div className="mt-2">
                <audio ref={audioRef} controls style={{ width: "100%" }} />
              </div>
              <div className="mt-2 text-xs text-[color:var(--sf-text-disabled)]">
                Voice mode uses mic+STT; the agent will pause when input is needed.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

