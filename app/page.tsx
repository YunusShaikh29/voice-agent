"use client";

import { useState, useEffect, useRef, useCallback } from "react";


type Task = {
  id: string;
  title: string;
  scheduledAt: string | null;
  createdAt: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Status = "idle" | "listening" | "processing" | "speaking" | "error";


function getSessionId(): string {
  if (typeof window === "undefined") return "";
  const key = "assistantSessionId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}


function formatTime(iso: string | null): string {
  if (!iso) return "no time";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) {
    return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── Waveform bars (static animation, no mic input needed) ──

function WaveformBars({ active }: { active: boolean }) {
  const bars = 5;
  return (
    <div className="flex items-center gap-[3px] h-6">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-current"
          style={{
            height: active ? undefined : "4px",
            animation: active
              ? `wavebar 0.9s ease-in-out ${i * 0.12}s infinite alternate`
              : "none",
            minHeight: "4px",
            maxHeight: "22px",
          }}
        />
      ))}
    </div>
  );
}


export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const isListeningRef = useRef(false);
  const transcriptRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // ── Flash newly added tasks ──
  useEffect(() => {
    const newIds = new Set<string>();
    tasks.forEach((t) => {
      if (!prevTaskIdsRef.current.has(t.id)) {
        newIds.add(t.id);
      }
    });
    if (newIds.size > 0) {
      setJustAdded(newIds);
      setTimeout(() => setJustAdded(new Set()), 1200);
    }
    prevTaskIdsRef.current = new Set(tasks.map((t) => t.id));
  }, [tasks]);

  // ── Speak ──
  const speak = useCallback((text: string, onEnd?: () => void) => {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.onend = () => { setStatus("idle"); onEnd?.(); };
    utterance.onerror = () => { setStatus("idle"); onEnd?.(); };
    setStatus("speaking");
    synth.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setStatus("idle");
  }, []);

  // ── Send message ──
  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim()) return;
    stopSpeaking();
    setStatus("processing");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMessage,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: userMessage }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { reply: string; tasks?: Task[] };

      if (data.tasks) setTasks(data.tasks);

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      speak(data.reply);
    } catch (err) {
      console.error("sendMessage error:", err);
      setStatus("error");
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Something went wrong. Please try again.",
      };
      setMessages((prev) => [...prev, errMsg]);
      speak("Something went wrong. Please try again.");
    }
  }, [sessionId, speak, stopSpeaking]);

  // ── Listen ──
  const startListening = useCallback(() => {
    if (isListeningRef.current) return;
    if (status === "speaking") stopSpeaking();

    const SpeechRecognitionAPI =
      (window as unknown as Record<string, unknown>).SpeechRecognition as typeof SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition as typeof SpeechRecognition;

    if (!SpeechRecognitionAPI) {
      alert("Speech recognition not supported. Use Chrome.");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognitionRef.current = recognition;
    isListeningRef.current = true;
    transcriptRef.current = "";
    setStatus("listening");
    setTranscript("");

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      const current = final || interim;
      transcriptRef.current = current;
      setTranscript(current);
      if (final) recognition.stop();
    };

    recognition.onend = () => {
      recognitionRef.current = null;

      isListeningRef.current = false;

      const captured = transcriptRef.current.trim();

      transcriptRef.current = "";

      setTranscript("");

      if (captured) {
        sendMessage(captured);
      } else {
        setStatus("idle");
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("STT error:", event.error);

      recognitionRef.current = null;
      isListeningRef.current = false;

      if (
        event.error === "aborted" ||
        event.error === "no-speech"
      ) {
        setStatus("idle");
        return;
      }

      if (event.error === "network") {
        setStatus("idle");
        return;
      }

      setStatus("error");

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "I couldn't hear that. Please try again.",
        },
      ]);
    };

    recognition.start();
  }, [status, stopSpeaking, sendMessage]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.abort();

    recognitionRef.current = null;

    isListeningRef.current = false;

    setStatus("idle");
  }, []);

  const handleMicClick = useCallback(() => {
    if (status === "speaking") stopSpeaking();
    else if (status === "listening") stopListening();
    else if (status === "idle" || status === "error") startListening();
  }, [status, stopSpeaking, stopListening, startListening]);

  const now = new Date();
  const timeStr = now.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const dateStr = now.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Syne:wght@400;600;700;800&display=swap');

        :root {
          --bg: #090a0f;
          --bg2: #0e1018;
          --bg3: #13151f;
          --border: rgba(255,255,255,0.07);
          --border-bright: rgba(255,255,255,0.14);
          --text: #e8eaf0;
          --text-dim: #5a5f72;
          --text-mid: #9098b0;
          --accent: #4af0a0;
          --accent-dim: rgba(74,240,160,0.12);
          --accent-glow: rgba(74,240,160,0.25);
          --red: #ff4d6a;
          --red-dim: rgba(255,77,106,0.12);
          --amber: #ffb647;
          --amber-dim: rgba(255,182,71,0.12);
          --blue: #4a9eff;
          --blue-dim: rgba(74,158,255,0.12);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'JetBrains Mono', monospace;
          height: 100dvh;
          overflow: hidden;
        }

        @keyframes wavebar {
          0%   { height: 4px; }
          100% { height: 22px; }
        }

        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 0.6; }
          100% { transform: scale(1.7); opacity: 0;   }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }

        @keyframes taskFlash {
          0%   { background: var(--accent-dim); border-color: var(--accent); }
          100% { background: transparent;       border-color: var(--border); }
        }

        .msg-enter {
          animation: fadeSlideIn 0.2s ease forwards;
        }

        .task-flash {
          animation: taskFlash 1.1s ease forwards;
        }

        /* custom scrollbar */
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 2px; }
      `}</style>

      <main style={{
        display: "grid",
        gridTemplateRows: "48px 1fr",
        gridTemplateColumns: "1fr 300px",
        height: "100dvh",
        background: "var(--bg)",
      }}>

        {/* ── Header ── */}
        <header style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: status === "idle" ? "var(--text-dim)"
                : status === "listening" ? "var(--red)"
                  : status === "processing" ? "var(--amber)"
                    : status === "speaking" ? "var(--accent)"
                      : "var(--red)",
              boxShadow: status !== "idle" ? `0 0 8px currentColor` : "none",
            }} />
            <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", color: "var(--text)" }}>
              VOCO
            </span>
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>/ voice task manager</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, color: "var(--text-dim)", fontSize: 11 }}>
            <span>{dateStr}</span>
            <span style={{ color: "var(--border-bright)" }}>|</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{timeStr}</span>
            <span style={{ color: "var(--border-bright)" }}>|</span>
            <span style={{ color: "var(--text-dim)", letterSpacing: "0.05em" }}>{sessionId.slice(0, 8)}</span>
          </div>
        </header>

        {/* ── Conversation panel ── */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid var(--border)",
        }}>
          {/* Messages scroll area */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}>
            {messages.length === 0 && (
              <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--text-dim)",
                fontSize: 12,
                textAlign: "center",
                paddingTop: 60,
              }}>
                <div style={{ fontSize: 28, marginBottom: 4 }}>◎</div>
                <div>tap the mic and speak</div>
                <div style={{ color: "var(--border-bright)", fontSize: 11 }}>
                  &ldquo;Create a task for gym at 7 AM&rdquo;
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className="msg-enter"
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                {msg.role === "assistant" && (
                  <span style={{ color: "var(--accent)", fontSize: 10, marginRight: 8, paddingTop: 3, flexShrink: 0 }}>AI</span>
                )}
                <div style={{
                  maxWidth: "78%",
                  padding: "9px 13px",
                  borderRadius: msg.role === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                  fontSize: 13,
                  lineHeight: 1.55,
                  background: msg.role === "user" ? "var(--blue-dim)" : "var(--bg3)",
                  border: `1px solid ${msg.role === "user" ? "rgba(74,158,255,0.2)" : "var(--border)"}`,
                  color: msg.role === "user" ? "var(--blue)" : "var(--text)",
                }}>
                  {msg.content}
                </div>
                {msg.role === "user" && (
                  <span style={{ color: "var(--blue)", fontSize: 10, marginLeft: 8, paddingTop: 3, flexShrink: 0 }}>YOU</span>
                )}
              </div>
            ))}

            {/* Live transcript */}
            {status === "listening" && transcript && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{
                  maxWidth: "78%",
                  padding: "9px 13px",
                  borderRadius: "12px 12px 3px 12px",
                  fontSize: 13,
                  background: "var(--red-dim)",
                  border: "1px solid rgba(255,77,106,0.2)",
                  color: "var(--red)",
                  fontStyle: "italic",
                }}>
                  {transcript}
                </div>
                <span style={{ color: "var(--red)", fontSize: 10, marginLeft: 8, paddingTop: 3 }}>YOU</span>
              </div>
            )}

            {/* Thinking indicator */}
            {status === "processing" && (
              <div className="msg-enter" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--accent)", fontSize: 10 }}>AI</span>
                <div style={{
                  padding: "9px 14px",
                  borderRadius: "12px 12px 12px 3px",
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--text-dim)",
                  fontSize: 12,
                }}>
                  <div style={{
                    width: 12, height: 12,
                    border: "1.5px solid var(--amber)",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                    flexShrink: 0,
                  }} />
                  thinking...
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── Mic control bar ── */}
          <div style={{
            borderTop: "1px solid var(--border)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            background: "var(--bg2)",
          }}>
            {/* Status text */}
            <div style={{
              fontSize: 11,
              color: status === "listening" ? "var(--red)"
                : status === "processing" ? "var(--amber)"
                  : status === "speaking" ? "var(--accent)"
                    : "var(--text-dim)",
              letterSpacing: "0.08em",
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 24,
            }}>
              {status === "speaking" ? (
                <>
                  <WaveformBars active={true} />
                  <span>SPEAKING — tap to interrupt</span>
                  <WaveformBars active={true} />
                </>
              ) : status === "listening" ? (
                <span>● LISTENING</span>
              ) : status === "processing" ? (
                <span>◌ PROCESSING</span>
              ) : status === "error" ? (
                <span>✕ ERROR — tap to retry</span>
              ) : (
                <span>TAP TO SPEAK</span>
              )}
            </div>

            {/* Mic button */}
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>

              {/* Pulse ring — listening only */}
              {status === "listening" && (
                <>
                  <div style={{
                    position: "absolute",
                    width: 64, height: 64,
                    borderRadius: "50%",
                    border: "2px solid var(--red)",
                    animation: "pulse-ring 1.1s ease-out infinite",
                    pointerEvents: "none",
                  }} />
                  <div style={{
                    position: "absolute",
                    width: 64, height: 64,
                    borderRadius: "50%",
                    border: "2px solid var(--red)",
                    animation: "pulse-ring 1.1s ease-out 0.4s infinite",
                    pointerEvents: "none",
                  }} />
                </>
              )}

              <button
                onClick={handleMicClick}
                disabled={status === "processing"}
                style={{
                  width: 56, height: 56,
                  borderRadius: "50%",
                  border: "none",
                  cursor: status === "processing" ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s ease",
                  position: "relative",
                  zIndex: 1,
                  background: status === "listening"
                    ? "var(--red)"
                    : status === "speaking"
                      ? "var(--accent)"
                      : status === "processing"
                        ? "var(--bg3)"
                        : "var(--bg3)",
                  boxShadow: status === "listening"
                    ? "0 0 0 1px var(--red), 0 0 20px var(--red-dim)"
                    : status === "speaking"
                      ? "0 0 0 1px var(--accent), 0 0 20px var(--accent-glow)"
                      : "0 0 0 1px var(--border-bright)",
                  outline: "none",
                }}
                aria-label={status === "listening" ? "Stop recording" : "Start recording"}
              >
                {status === "processing" ? (
                  <div style={{
                    width: 18, height: 18,
                    border: "2px solid var(--amber)",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }} />
                ) : status === "speaking" ? (
                  // Stop square
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: "var(--bg)" }} />
                ) : status === "listening" ? (
                  // Mic icon — white
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                ) : (
                  // Mic icon — dim
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Task panel ── */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg2)",
        }}>
          {/* Panel header */}
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-mid)" }}>
              TASKS
            </span>
            <span style={{
              fontSize: 11,
              color: "var(--text-dim)",
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "1px 7px",
              fontVariantNumeric: "tabular-nums",
            }}>
              {tasks.length}
            </span>
          </div>

          {/* Task list */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 0",
          }}>
            {tasks.length === 0 ? (
              <div style={{
                padding: "40px 16px",
                textAlign: "center",
                color: "var(--text-dim)",
                fontSize: 12,
              }}>
                <div style={{ marginBottom: 6 }}>□</div>
                no tasks yet
              </div>
            ) : (
              tasks.map((task, idx) => (
                <div
                  key={task.id}
                  className={justAdded.has(task.id) ? "task-flash" : ""}
                  style={{
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--border)",
                    cursor: "default",
                    transition: "background 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{
                      fontSize: 10,
                      color: "var(--text-dim)",
                      paddingTop: 2,
                      flexShrink: 0,
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 16,
                    }}>
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12,
                        color: "var(--text)",
                        lineHeight: 1.4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>
                        {task.title}
                      </div>
                      {task.scheduledAt && (
                        <div style={{
                          fontSize: 10,
                          color: "var(--accent)",
                          marginTop: 3,
                        }}>
                          {formatShortTime(task.scheduledAt)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer hint */}
          <div style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 10,
            color: "var(--text-dim)",
            lineHeight: 1.5,
          }}>
            voice commands only<br />
            <span style={{ color: "var(--border-bright)" }}>no buttons · no typing</span>
          </div>
        </div>

      </main>
    </>
  );
}