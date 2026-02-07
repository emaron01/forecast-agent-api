import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionConstructor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as SpeechRecognitionConstructor | null;
}

export type UseSpeechRecognitionOptions = {
  lang?: string;
  autoRestart?: boolean;
  silenceMs?: number;
  onUtterance?: (finalText: string) => void;
};

export function useSpeechRecognition(opts: UseSpeechRecognitionOptions = {}) {
  const ctor = useMemo(() => getSpeechRecognitionCtor(), []);
  const supported = !!ctor;

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>("");
  const [interimText, setInterimText] = useState("");
  const [finalText, setFinalText] = useState("");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wantListeningRef = useRef(false);
  const silenceTimerRef = useRef<number | null>(null);
  const lastHeardAtRef = useRef<number>(0);
  const interimRef = useRef<string>("");
  const finalRef = useRef<string>("");

  const lang = opts.lang || "en-US";
  const autoRestart = opts.autoRestart ?? true;
  const silenceMs = Math.max(250, Number(opts.silenceMs ?? 900));

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const clearTranscript = useCallback(() => {
    interimRef.current = "";
    finalRef.current = "";
    setFinalText("");
    setInterimText("");
  }, []);

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      const now = Date.now();
      if (!wantListeningRef.current) return;
      if (!listening) return;
      const combined = `${finalRef.current} ${interimRef.current}`.trim();
      if (!combined) return;
      if (now - (lastHeardAtRef.current || 0) < silenceMs) return;
      try {
        opts.onUtterance?.(combined);
      } finally {
        clearTranscript();
      }
    }, silenceMs + 50);
  }, [listening, opts, silenceMs]);

  const ensureRecognition = useCallback(() => {
    if (!supported || recognitionRef.current) return recognitionRef.current;
    const Ctor = ctor;
    if (!Ctor) return null;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;

    r.onerror = (e: any) => {
      // Common non-fatal errors: "no-speech", "aborted"
      const msg = String(e?.error || e?.message || "speech_recognition_error");
      setError(msg);
    };

    r.onresult = (e: SpeechRecognitionEvent) => {
      setError("");
      lastHeardAtRef.current = Date.now();

      let interim = "";
      let appendedFinal = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = String(res?.[0]?.transcript || "");
        if (res.isFinal) appendedFinal += text;
        else interim += text;
      }

      const nextInterim = interim.trim();
      interimRef.current = nextInterim;
      if (nextInterim) setInterimText(nextInterim);
      else setInterimText("");

      if (appendedFinal.trim()) {
        finalRef.current = `${finalRef.current} ${appendedFinal}`.trim();
        setFinalText(finalRef.current);
      }

      armSilenceTimer();
    };

    r.onend = () => {
      setListening(false);
      clearSilenceTimer();

      // Some browsers end recognition when the user pauses, without reliably emitting final segments.
      // If we still have a transcript buffered, treat end as an utterance boundary.
      if (wantListeningRef.current) {
        const combined = `${finalRef.current} ${interimRef.current}`.trim();
        if (combined) {
          try {
            opts.onUtterance?.(combined);
          } finally {
            clearTranscript();
          }
        }
      }

      // Auto-restart is critical for hands-free; browsers end sessions frequently.
      if (wantListeningRef.current && autoRestart) {
        try {
          r.start();
          setListening(true);
        } catch {
          // Some browsers throw if restarted too quickly; best-effort retry.
          window.setTimeout(() => {
            try {
              if (!wantListeningRef.current) return;
              r.start();
              setListening(true);
            } catch {}
          }, 250);
        }
      }
    };

    recognitionRef.current = r;
    return r;
  }, [armSilenceTimer, autoRestart, ctor, lang, supported]);

  const start = useCallback(() => {
    wantListeningRef.current = true;
    setError("");
    const r = ensureRecognition();
    if (!r) return;
    try {
      r.start();
      setListening(true);
    } catch {
      // Ignore: browsers can throw if start() called twice.
      setListening(true);
    }
  }, [ensureRecognition]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    clearSilenceTimer();
    setListening(false);
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch {}
  }, []);

  const reset = useCallback(() => {
    clearTranscript();
    setError("");
  }, [clearTranscript]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearSilenceTimer();
      try {
        recognitionRef.current?.stop();
      } catch {}
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const combinedText = useMemo(() => {
    const f = finalText.trim();
    const i = interimText.trim();
    if (f && i) return `${f} ${i}`.trim();
    return f || i;
  }, [finalText, interimText]);

  return {
    supported,
    listening,
    error,
    interimText,
    finalText,
    combinedText,
    start,
    stop,
    reset,
  };
}

