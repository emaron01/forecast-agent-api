"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<HandsFreeRun | null>(null);
  const [answer, setAnswer] = useState("");
  const [speak, setSpeak] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAudioUrlRef = useRef<string>("");
  const speakingRef = useRef(false);
  const lastSpokenAtRef = useRef<number>(0);

  const runId = run?.runId || "";
  const status = run?.status || "DONE";

  const canStart = useMemo(() => !busy && !runId, [busy, runId]);
  const isWaiting = status === "WAITING_FOR_USER";
  const isRunning = status === "RUNNING";

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
      await audioRef.current.play();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  };

  const speakAssistant = async (assistantText: string) => {
    const t = String(assistantText || "").trim();
    if (!speak || !t) return;
    const ttsRes = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    const tts = await ttsRes.json().catch(() => ({}));
    if (ttsRes.ok && tts.ok && tts.audio_base64) {
      await playAudio(String(tts.audio_base64), String(tts.mime || "audio/mpeg"));
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

  const start = async () => {
    if (!canStart) return;
    if (speak) await unlockAudio();
    setBusy(true);
    try {
      const res = await fetch("/api/handsfree/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: Number(orgId), repName }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Start failed");
      lastSpokenAtRef.current = 0;
      setRun(json.run as HandsFreeRun);
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
    const text = answer.trim();
    if (!text || !runId || busy) return;
    if (speak) await unlockAudio();
    setBusy(true);
    setAnswer("");
    try {
      const res = await fetch(`/api/handsfree/${runId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Input failed");
      setRun(json.run as HandsFreeRun);
    } catch (e: any) {
      setRun((prev) =>
        prev
          ? { ...prev, status: "ERROR", error: e?.message || String(e) }
          : {
              runId,
              sessionId: "",
              status: "ERROR",
              error: e?.message || String(e),
              masterPromptSha256: undefined,
              masterPromptLoadedAt: undefined,
              messages: [],
              modelCalls: 0,
              updatedAt: Date.now(),
            }
      );
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setRun(null);
    setAnswer("");
    setBusy(false);
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
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} disabled={busy} />
          Speak
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={start} disabled={!canStart}>
            Start
          </button>
          <button onClick={restart} disabled={busy}>
            Restart
          </button>
        </div>
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
        {run?.messages?.length ? (
          run.messages.map((m, i) => (
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
          <div style={{ color: "#666" }}>Click <strong>Start</strong> to begin. The agent will speak first and then pause only when it needs your input.</div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Audio</strong>
        <div style={{ marginTop: 6 }}>
          <audio ref={audioRef} controls style={{ width: "100%" }} />
        </div>
      </div>

      {isRunning ? (
        <div style={{ marginTop: 12, color: "#555" }}>Running… (auto-advancing)</div>
      ) : null}

      {isWaiting ? (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #e5e5e5", background: "#fafafa" }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Input required</strong> (the runner is paused)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer…"
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
    </main>
  );
}
