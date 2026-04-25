"use client";

import { useState, useEffect, useRef } from "react";
import type { HubSpotReviewSession } from "./types";

type Props = {
  session: HubSpotReviewSession;
  token: string;
  mode: "voice" | "text";
  onEndReview: () => void;
};

type Message = {
  role: "assistant" | "user";
  text: string;
};

export default function ActiveReview({ session, token, mode, onEndReview }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"starting" | "idle" | "listening" | "processing" | "speaking" | "error">(
    "starting"
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentCategory, setCurrentCategory] = useState<string | null>(null);
  const [categoriesDone, setCategoriesDone] = useState(0);
  const [totalCategories] = useState(10);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    "X-HS-Extension-Token": token,
  };

  useEffect(() => {
    async function startSession() {
      try {
        const res = await fetch("/api/deal-review/start", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            opportunityId: session.public_id,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);

        const sid = String(json?.run?.sessionId || "").trim();
        if (!sid) throw new Error("Missing sessionId");
        setSessionId(sid);
        setStatus("idle");
      } catch (e: any) {
        setErrorMsg(String(e.message || "Failed to start"));
        setStatus("error");
      }
    }
    startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!sessionId || !text.trim()) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setStatus("processing");

    try {
      const res = await fetch(`/api/deal-review/opportunities/${session.public_id}/update-category`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          sessionId,
          userText: text,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      if (reader) {
        setStatus("speaking");
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.text) {
                  assistantText += data.text;
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", text: assistantText }];
                    }
                    return [...prev, { role: "assistant", text: assistantText }];
                  });
                }
                if (data.category) setCurrentCategory(String(data.category));
                if (data.categoriesDone != null) setCategoriesDone(Number(data.categoriesDone));
                if (data.done) setStatus("idle");
              } catch {
                // ignore non-JSON SSE lines
              }
            }
          }
        }
      }
      setStatus("idle");
    } catch (e: any) {
      setErrorMsg(String(e.message || "Error"));
      setStatus("error");
    }
  }

  function startListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setErrorMsg("Speech recognition not supported");
      return;
    }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      sendMessage(transcript);
    };
    recognition.onerror = () => {
      setStatus("idle");
    };
    recognition.onend = () => {
      setStatus((s) => (s === "listening" ? "idle" : s));
    };
    recognitionRef.current = recognition;
    recognition.start();
    setStatus("listening");
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setStatus("idle");
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#0f1117] text-white flex flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-400">{errorMsg || "An error occurred"}</p>
        <button onClick={onEndReview} className="px-4 py-2 bg-white/10 rounded-lg text-sm">
          Back to Deal Overview
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col">
      <div className="px-6 py-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{session.dealState.account_name ?? "Deal Review"}</p>
          {currentCategory && <p className="text-xs text-gray-400">Category: {currentCategory}</p>}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.min(100, (categoriesDone / totalCategories) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-400">
              {categoriesDone}/{totalCategories}
            </span>
          </div>
          <button
            onClick={onEndReview}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-xs transition-colors"
          >
            End Review
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
        {status === "starting" && <div className="text-center text-gray-400 text-sm py-8">Starting review...</div>}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "assistant" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                msg.role === "assistant" ? "bg-[#1a1f2e] text-gray-100" : "bg-blue-600 text-white"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 py-4 border-t border-white/10">
        {mode === "voice" ? (
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={status === "listening" ? stopListening : startListening}
              disabled={status === "processing" || status === "speaking" || status === "starting"}
              className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl transition-all ${
                status === "listening" ? "bg-red-500 animate-pulse" : "bg-blue-600 hover:bg-blue-700"
              } disabled:opacity-40`}
            >
              {status === "listening" ? "⏹" : "🎤"}
            </button>
            <p className="text-sm text-gray-400">
              {status === "listening"
                ? "Listening... tap to stop"
                : status === "processing"
                  ? "Processing..."
                  : status === "speaking"
                    ? "Matthew is speaking..."
                    : "Tap to speak"}
            </p>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Type your answer..."
              disabled={status === "processing" || status === "speaking" || status === "starting"}
              className="flex-1 bg-[#1a1f2e] rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 border border-white/10 focus:outline-none focus:border-blue-500 disabled:opacity-40"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || status === "processing" || status === "speaking" || status === "starting"}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
            >
              Send
            </button>
          </div>
        )}
        {errorMsg && <p className="text-red-400 text-xs mt-2 text-center">{errorMsg}</p>}
      </div>
    </div>
  );
}

