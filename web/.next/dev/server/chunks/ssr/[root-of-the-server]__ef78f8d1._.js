module.exports = [
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[project]/web/app/page.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
"use client";
;
;
function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++)bytes[i] = bin.charCodeAt(i);
    return new Blob([
        bytes
    ], {
        type: mime || "audio/mpeg"
    });
}
function Home() {
    const BUILD_TAG = "turn-based-v1";
    const [log, setLog] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([]);
    const [repName, setRepName] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("Erik M");
    const [orgId, setOrgId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("1");
    const [sessionId, setSessionId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("");
    const [recording, setRecording] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [busy, setBusy] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [speak, setSpeak] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(true);
    const [conversationOn, setConversationOn] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [lastTranscript, setLastTranscript] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("");
    const [lastAssistant, setLastAssistant] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("");
    const [textInput, setTextInput] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("");
    const mediaRecorderRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const chunksRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])([]);
    const audioRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const streamRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const audioCtxRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const analyserRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const rafRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const lastVoiceAtRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0);
    const heardVoiceRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(false);
    const segmentTimeoutRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const appendLog = (line)=>setLog((prev)=>[
                ...prev,
                line
            ]);
    const playAudio = async (audio_base64, mime)=>{
        const blob = b64ToBlob(audio_base64, mime);
        const url = URL.createObjectURL(blob);
        if (!audioRef.current) {
            const a = document.createElement("audio");
            a.controls = true;
            a.autoplay = true;
            audioRef.current = a;
        }
        audioRef.current.src = url;
        await audioRef.current.play().catch(()=>{});
    };
    const stopConversation = ()=>{
        setConversationOn(false);
        if (segmentTimeoutRef.current) {
            window.clearTimeout(segmentTimeoutRef.current);
            segmentTimeoutRef.current = null;
        }
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            }
        } catch  {}
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
        } catch  {}
        audioCtxRef.current = null;
        analyserRef.current = null;
        try {
            streamRef.current?.getTracks().forEach((t)=>t.stop());
        } catch  {}
        streamRef.current = null;
        appendLog("Conversation stopped.");
    };
    const startVADMonitor = ()=>{
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
        const tick = ()=>{
            if (!conversationOn) return;
            analyser.getByteTimeDomainData(buf);
            let sumSq = 0;
            for(let i = 0; i < buf.length; i++){
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
    const runRespondTurn = async (sid, userText)=>{
        const text = String(userText || "").trim();
        if (!text) return "";
        if (!sid) {
            appendLog("No session. Click Init session first.");
            return "";
        }
        const rRes = await fetch("/api/respond", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                sessionId: sid,
                text
            })
        });
        const r = await rRes.json();
        if (!rRes.ok || !r.ok) throw new Error(r?.error || "Respond failed");
        return String(r.text || "").trim();
    };
    const speakAssistant = async (assistantText)=>{
        const t = String(assistantText || "").trim();
        if (!speak || !t) return;
        const ttsRes = await fetch("/api/tts", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: t
            })
        });
        const tts = await ttsRes.json();
        if (ttsRes.ok && tts.ok && tts.audio_base64) {
            await playAudio(String(tts.audio_base64), String(tts.mime || "audio/mpeg"));
        } else {
            appendLog(`TTS error: ${tts?.error || "unknown"}`);
        }
    };
    const kickoffReview = async (sid)=>{
        // This mimics the old Realtime "response.create right after session.update":
        // the agent should start the review immediately (greeting + first question).
        const kickoffText = "Begin the forecast review now. Follow the workflow. Start with your greeting and immediately ask the first MEDDPICC gap question for the first deal.";
        const assistantText = await runRespondTurn(sid, kickoffText);
        if (assistantText) {
            setLastAssistant(assistantText);
            appendLog(`Assistant: ${assistantText}`);
            await speakAssistant(assistantText);
        }
    };
    const initSession = async ()=>{
        setBusy(true);
        try {
            appendLog(`Client build: ${BUILD_TAG}`);
            const res = await fetch("/api/agent/init", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    orgId: Number(orgId),
                    repName
                })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || "Init failed");
            const sid = String(json.sessionId || "");
            setSessionId(sid);
            appendLog(`Session ready: ${sid}`);
            // Immediately start the review (agent speaks first).
            await kickoffReview(sid);
        } catch (e) {
            appendLog(`Init error: ${e?.message || String(e)}`);
        } finally{
            setBusy(false);
        }
    };
    const handleTurn = async (userText)=>{
        const text = String(userText || "").trim();
        if (!text) return;
        setBusy(true);
        try {
            const assistantText = await runRespondTurn(sessionId, text);
            setLastAssistant(assistantText);
            appendLog(`Assistant: ${assistantText}`);
            await speakAssistant(assistantText);
        } catch (e) {
            appendLog(`Turn error: ${e?.message || String(e)}`);
        } finally{
            setBusy(false);
        }
    };
    const startRecording = async ()=>{
        if (!sessionId) {
            appendLog("No session. Click Init session first.");
            return;
        }
        if (conversationOn) {
            appendLog("Conversation mode is on. Use Stop conversation first.");
            return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });
        const mr = new MediaRecorder(stream, {
            mimeType: "audio/webm"
        });
        chunksRef.current = [];
        mr.ondataavailable = (e)=>{
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = async ()=>{
            stream.getTracks().forEach((t)=>t.stop());
            const blob = new Blob(chunksRef.current, {
                type: "audio/webm"
            });
            chunksRef.current = [];
            await handleAudioTurn(blob);
        };
        mediaRecorderRef.current = mr;
        mr.start();
        setRecording(true);
        appendLog("Recording...");
    };
    const stopRecording = ()=>{
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
    const handleAudioTurn = async (blob)=>{
        setBusy(true);
        try {
            const fd = new FormData();
            fd.set("file", blob, "audio.webm");
            const sttRes = await fetch("/api/stt", {
                method: "POST",
                body: fd
            });
            const stt = await sttRes.json();
            if (!sttRes.ok || !stt.ok) throw new Error(stt?.error || "STT failed");
            const transcript = String(stt.text || "").trim();
            setLastTranscript(transcript);
            appendLog(`Transcript: ${transcript}`);
            await handleTurn(transcript);
        } catch (e) {
            appendLog(`Audio turn error: ${e?.message || String(e)}`);
        } finally{
            setBusy(false);
        }
    };
    const startConversation = async ()=>{
        if (!sessionId) {
            appendLog("No session. Click Init session first.");
            return;
        }
        if (conversationOn) return;
        setConversationOn(true);
        appendLog("Conversation started. Talk normally; I’ll stop on silence.");
        if (!streamRef.current) {
            streamRef.current = await navigator.mediaDevices.getUserMedia({
                audio: true
            });
        }
        startVADMonitor();
        const startSegment = ()=>{
            if (!streamRef.current || !conversationOn) return;
            heardVoiceRef.current = false;
            lastVoiceAtRef.current = 0;
            const mr = new MediaRecorder(streamRef.current, {
                mimeType: "audio/webm"
            });
            chunksRef.current = [];
            mr.ondataavailable = (e)=>{
                if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
            };
            mr.onstop = async ()=>{
                const blob = new Blob(chunksRef.current, {
                    type: "audio/webm"
                });
                chunksRef.current = [];
                await handleAudioTurn(blob);
                // After assistant finishes (including TTS), start listening again.
                if (conversationOn) {
                    setTimeout(()=>startSegment(), 150);
                }
            };
            mediaRecorderRef.current = mr;
            mr.start();
            setRecording(true);
            // Safety: cap each segment length.
            segmentTimeoutRef.current = window.setTimeout(()=>{
                if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                    stopRecording();
                }
            }, 25000);
        };
        startSegment();
    };
    const sendText = async ()=>{
        const text = textInput.trim();
        setTextInput("");
        setLastTranscript(text);
        appendLog(`User: ${text}`);
        await handleTurn(text);
    };
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("main", {
        style: {
            padding: 24,
            fontFamily: "sans-serif"
        },
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                children: "Forecast Agent (GPT‑5 mini, non‑Realtime)"
            }, void 0, false, {
                fileName: "[project]/web/app/page.tsx",
                lineNumber: 340,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                style: {
                    display: "flex",
                    gap: 12,
                    marginBottom: 12,
                    flexWrap: "wrap"
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                        children: [
                            "Rep name",
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                value: repName,
                                onChange: (e)=>setRepName(e.target.value),
                                style: {
                                    marginLeft: 8
                                }
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 345,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 343,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                        children: [
                            "Org ID",
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                value: orgId,
                                onChange: (e)=>setOrgId(e.target.value),
                                style: {
                                    marginLeft: 8,
                                    width: 80
                                }
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 349,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 347,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                        style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 8
                        },
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                type: "checkbox",
                                checked: speak,
                                onChange: (e)=>setSpeak(e.target.checked)
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 352,
                                columnNumber: 11
                            }, this),
                            "Speak"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 351,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/page.tsx",
                lineNumber: 342,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                children: [
                    "Session: ",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("code", {
                        children: sessionId || "(none)"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 358,
                        columnNumber: 18
                    }, this),
                    " · Build: ",
                    BUILD_TAG
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/page.tsx",
                lineNumber: 357,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                style: {
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap"
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: initSession,
                        disabled: busy,
                        children: "Init session"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 362,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: startConversation,
                        disabled: busy || conversationOn || !sessionId,
                        children: "Start conversation"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 365,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: stopConversation,
                        disabled: busy || !conversationOn,
                        children: "Stop conversation"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 368,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: startRecording,
                        disabled: busy || recording || !sessionId,
                        children: "Start recording"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 371,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: stopRecording,
                        disabled: busy || !recording,
                        children: "Stop recording"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 374,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/page.tsx",
                lineNumber: 361,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                style: {
                    marginTop: 16
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                        children: "Manual text"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 380,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        style: {
                            display: "flex",
                            gap: 8,
                            marginTop: 8
                        },
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                value: textInput,
                                onChange: (e)=>setTextInput(e.target.value),
                                placeholder: "Type a message...",
                                style: {
                                    flex: 1,
                                    padding: 8
                                }
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 382,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                onClick: sendText,
                                disabled: busy || !sessionId || !textInput.trim(),
                                children: "Send"
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 388,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 381,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/page.tsx",
                lineNumber: 379,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                style: {
                    marginTop: 16,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                                children: "Last transcript"
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 396,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("pre", {
                                style: {
                                    background: "#f6f6f6",
                                    padding: 12,
                                    minHeight: 120,
                                    whiteSpace: "pre-wrap"
                                },
                                children: lastTranscript || "(none)"
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 397,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 395,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                                children: "Assistant"
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 402,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("pre", {
                                style: {
                                    background: "#f6f6f6",
                                    padding: 12,
                                    minHeight: 120,
                                    whiteSpace: "pre-wrap"
                                },
                                children: lastAssistant || "(none)"
                            }, void 0, false, {
                                fileName: "[project]/web/app/page.tsx",
                                lineNumber: 403,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 401,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/page.tsx",
                lineNumber: 394,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                style: {
                    marginTop: 16
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                        children: "Log"
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 410,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("pre", {
                        style: {
                            background: "#f6f6f6",
                            padding: 12,
                            maxHeight: 240,
                            overflow: "auto"
                        },
                        children: log.join("\n")
                    }, void 0, false, {
                        fileName: "[project]/web/app/page.tsx",
                        lineNumber: 411,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/page.tsx",
                lineNumber: 409,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/page.tsx",
        lineNumber: 339,
        columnNumber: 5
    }, this);
}
}),
"[project]/web/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
;
else {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    else {
        if ("TURBOPACK compile-time truthy", 1) {
            if ("TURBOPACK compile-time truthy", 1) {
                module.exports = __turbopack_context__.r("[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)");
            } else //TURBOPACK unreachable
            ;
        } else //TURBOPACK unreachable
        ;
    }
} //# sourceMappingURL=module.compiled.js.map
}),
"[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/web/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].ReactJsxDevRuntime; //# sourceMappingURL=react-jsx-dev-runtime.js.map
}),
"[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/web/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].React; //# sourceMappingURL=react.js.map
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__ef78f8d1._.js.map