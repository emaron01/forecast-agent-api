"use client";

import { useRef, useState } from "react";

function b64ToBlob(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

export default function Home() {
  const BUILD_TAG = "turn-based-v1";

  const [log, setLog] = useState<string[]>([]);
  const [repName, setRepName] = useState("Erik M");
  const [orgId, setOrgId] = useState("1");
  const [sessionId, setSessionId] = useState<string>("");

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [conversationOn, setConversationOn] = useState(false);

  const [lastTranscript, setLastTranscript] = useState("");
  const [lastAssistant, setLastAssistant] = useState("");
  const [textInput, setTextInput] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const heardVoiceRef = useRef<boolean>(false);
  const segmentTimeoutRef = useRef<number | null>(null);

  const appendLog = (line: string) => setLog((prev) => [...prev, line]);

  const playAudio = async (audio_base64: string, mime: string) => {
    const blob = b64ToBlob(audio_base64, mime);
    const url = URL.createObjectURL(blob);
    if (!audioRef.current) {
      const a = document.createElement("audio");
      a.controls = true;
      a.autoplay = true;
      audioRef.current = a;
    }
    audioRef.current.src = url;
    await audioRef.current.play().catch(() => {});
  };

  const stopConversation = () => {
    setConversationOn(false);
    if (segmentTimeoutRef.current) {
      window.clearTimeout(segmentTimeoutRef.current);
      segmentTimeoutRef.current = null;
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch {}
    mediaRecorderRef.current = null;
    setRecording(false);
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

    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    appendLog("Conversation stopped.");
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
    const SILENCE_MS = 900;
    const THRESH = 0.02; // RMS threshold; conservative default

    const tick = () => {
      if (!conversationOn) return;

      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      const now = Date.now();
      if (rms > THRESH) {
        heardVoiceRef.current = true;
        lastVoiceAtRef.current = now;
      }

      // If we've heard speech this segment, stop recording after a silence gap.
      if (recording && heardVoiceRef.current && lastVoiceAtRef.current && now - lastVoiceAtRef.current > SILENCE_MS) {
        stopRecording();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
  };

  const runRespondTurn = async (sid: string, userText: string) => {
    const text = String(userText || "").trim();
    if (!text) return "";
    if (!sid) {
      appendLog("No session. Click Init session first.");
      return "";
    }
    const rRes = await fetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, text }),
    });
    const r = await rRes.json();
    if (!rRes.ok || !r.ok) throw new Error(r?.error || "Respond failed");
    return String(r.text || "").trim();
  };

  const speakAssistant = async (assistantText: string) => {
    const t = String(assistantText || "").trim();
    if (!speak || !t) return;
    const ttsRes = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    const tts = await ttsRes.json();
    if (ttsRes.ok && tts.ok && tts.audio_base64) {
      await playAudio(String(tts.audio_base64), String(tts.mime || "audio/mpeg"));
    } else {
      appendLog(`TTS error: ${tts?.error || "unknown"}`);
    }
  };

  const kickoffReview = async (sid: string) => {
    // This mimics the old Realtime "response.create right after session.update":
    // the agent should start the review immediately (greeting + first question).
    const kickoffText =
      "Begin the forecast review now. Follow the workflow. Start with your greeting and immediately ask the first MEDDPICC gap question for the first deal.";
    const assistantText = await runRespondTurn(sid, kickoffText);
    if (assistantText) {
      setLastAssistant(assistantText);
      appendLog(`Assistant: ${assistantText}`);
      await speakAssistant(assistantText);
    }
  };

  const initSession = async () => {
    setBusy(true);
    try {
      appendLog(`Client build: ${BUILD_TAG}`);
      const res = await fetch("/api/agent/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: Number(orgId), repName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Init failed");
      const sid = String(json.sessionId || "");
      setSessionId(sid);
      appendLog(`Session ready: ${sid}`);
      // Immediately start the review (agent speaks first).
      await kickoffReview(sid);
    } catch (e: any) {
      appendLog(`Init error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTurn = async (userText: string) => {
    const text = String(userText || "").trim();
    if (!text) return;
    setBusy(true);
    try {
      const assistantText = await runRespondTurn(sessionId, text);
      setLastAssistant(assistantText);
      appendLog(`Assistant: ${assistantText}`);
      await speakAssistant(assistantText);
    } catch (e: any) {
      appendLog(`Turn error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    if (!sessionId) {
      appendLog("No session. Click Init session first.");
      return;
    }
    if (conversationOn) {
      appendLog("Conversation mode is on. Use Stop conversation first.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      await handleAudioTurn(blob);
    };
    mediaRecorderRef.current = mr;
    mr.start();
    setRecording(true);
    appendLog("Recording...");
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (segmentTimeoutRef.current) {
      window.clearTimeout(segmentTimeoutRef.current);
      segmentTimeoutRef.current = null;
    }
    mr.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
    appendLog("Stopped recording. Processing...");
  };

  const handleAudioTurn = async (blob: Blob) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", blob, "audio.webm");
      const sttRes = await fetch("/api/stt", { method: "POST", body: fd });
      const stt = await sttRes.json();
      if (!sttRes.ok || !stt.ok) throw new Error(stt?.error || "STT failed");
      const transcript = String(stt.text || "").trim();
      setLastTranscript(transcript);
      appendLog(`Transcript: ${transcript}`);
      await handleTurn(transcript);
    } catch (e: any) {
      appendLog(`Audio turn error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startConversation = async () => {
    if (!sessionId) {
      appendLog("No session. Click Init session first.");
      return;
    }
    if (conversationOn) return;

    setConversationOn(true);
    appendLog("Conversation started. Talk normally; I’ll stop on silence.");

    if (!streamRef.current) {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    startVADMonitor();

    const startSegment = () => {
      if (!streamRef.current || !conversationOn) return;
      heardVoiceRef.current = false;
      lastVoiceAtRef.current = 0;

      const mr = new MediaRecorder(streamRef.current, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        await handleAudioTurn(blob);
        // After assistant finishes (including TTS), start listening again.
        if (conversationOn) {
          setTimeout(() => startSegment(), 150);
        }
      };

      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);

      // Safety: cap each segment length.
      segmentTimeoutRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          stopRecording();
        }
      }, 25000);
    };

    startSegment();
  };

  const sendText = async () => {
    const text = textInput.trim();
    setTextInput("");
    setLastTranscript(text);
    appendLog(`User: ${text}`);
    await handleTurn(text);
  };

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Forecast Agent (GPT‑5 mini, non‑Realtime)</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <label>
          Rep name
          <input value={repName} onChange={(e) => setRepName(e.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <label>
          Org ID
          <input value={orgId} onChange={(e) => setOrgId(e.target.value)} style={{ marginLeft: 8, width: 80 }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />
          Speak
        </label>
      </div>

      <p>
        Session: <code>{sessionId || "(none)"}</code> · Build: {BUILD_TAG}
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={initSession} disabled={busy}>
          Init session
        </button>
        <button onClick={startConversation} disabled={busy || conversationOn || !sessionId}>
          Start conversation
        </button>
        <button onClick={stopConversation} disabled={busy || !conversationOn}>
          Stop conversation
        </button>
        <button onClick={startRecording} disabled={busy || recording || !sessionId}>
          Start recording
        </button>
        <button onClick={stopRecording} disabled={busy || !recording}>
          Stop recording
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Manual text</strong>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1, padding: 8 }}
          />
          <button onClick={sendText} disabled={busy || !sessionId || !textInput.trim()}>
            Send
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <strong>Last transcript</strong>
          <pre style={{ background: "#f6f6f6", padding: 12, minHeight: 120, whiteSpace: "pre-wrap" }}>
            {lastTranscript || "(none)"}
          </pre>
        </div>
        <div>
          <strong>Assistant</strong>
          <pre style={{ background: "#f6f6f6", padding: 12, minHeight: 120, whiteSpace: "pre-wrap" }}>
            {lastAssistant || "(none)"}
          </pre>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Log</strong>
        <pre style={{ background: "#f6f6f6", padding: 12, maxHeight: 240, overflow: "auto" }}>
          {log.join("\n")}
        </pre>
      </div>
    </main>
  );
}

