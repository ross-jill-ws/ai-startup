import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/test-ai-worker";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  errored?: boolean;
};

type GatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const MODEL = "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const QUICK_PROMPTS = [
  "What is Cloudflare, in plain English?",
  "Explain the difference between Workers and Durable Objects.",
  "Give me 3 startup ideas built on Workers AI.",
];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Test AI Worker" },
    {
      name: "description",
      content: "Streaming chat UI powered by Cloudflare AI Gateway and Workers AI.",
    },
  ];
}

export default function TestAiWorker() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isStreaming]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = input.trim();
    if (!content || isStreaming) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    const assistantId = crypto.randomUUID();

    const payloadMessages: GatewayMessage[] = [
      ...messages.map(({ role, content: existingContent }) => ({
        role,
        content: existingContent,
      })),
      { role: "user", content },
    ];

    setInput("");
    setError(null);
    setIsStreaming(true);
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", pending: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/test-ai-worker", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ messages: payloadMessages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(bodyText || `Request failed with ${response.status}`);
      }

      if (!response.body) {
        throw new Error("The streaming response did not include a body.");
      }

      await readSseStream(response.body, (eventData) => {
        if (eventData === "[DONE]") return;

        const chunk = JSON.parse(eventData) as {
          choices?: Array<{
            delta?: {
              content?: string;
            };
          }>;
        };

        const delta = chunk.choices?.[0]?.delta?.content;
        if (!delta) return;

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: `${message.content}${delta}`,
                  pending: false,
                }
              : message,
          ),
        );
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, pending: false } : message,
        ),
      );
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Unknown streaming error.";

      if (!controller.signal.aborted) {
        setError(message);
      }

      setMessages((current) =>
        current.map((item) => {
          if (item.id !== assistantId) return item;
          if (item.content.trim()) return { ...item, pending: false };

          return {
            ...item,
            content: controller.signal.aborted
              ? "Generation stopped."
              : `Sorry — ${message}`,
            pending: false,
            errored: !controller.signal.aborted,
          };
        }),
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsStreaming(false);
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#050816] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.18),transparent_24%),radial-gradient(circle_at_bottom,rgba(34,197,94,0.16),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:36px_36px]" />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 lg:px-10">
        <header className="mb-6 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-xl md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-200">
              Streaming SSE • Cloudflare AI Gateway • Workers AI
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
                Test AI Worker
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                A chat route that proxies requests through your Worker so the
                gateway token stays server-side while responses stream back live.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              to="/"
              className="rounded-full border border-white/15 bg-white/8 px-4 py-2 text-slate-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
            >
              Home
            </Link>
            <Link
              to="/counter"
              className="rounded-full border border-white/15 bg-white/8 px-4 py-2 text-slate-100 transition hover:border-fuchsia-300/40 hover:bg-fuchsia-300/10"
            >
              Counter demo
            </Link>
          </div>
        </header>

        <section className="grid flex-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-white/10 bg-slate-950/60 p-5 backdrop-blur-xl">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                  Route config
                </p>
                <div className="mt-3 space-y-3 text-sm text-slate-200">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-slate-400">Endpoint</div>
                    <div className="mt-1 break-all font-medium text-white">
                      /api/test-ai-worker
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-slate-400">Model</div>
                    <div className="mt-1 font-medium text-white">{MODEL}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-slate-400">Transport</div>
                    <div className="mt-1 font-medium text-white">
                      fetch → route action → SSE stream
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                  Quick prompts
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        setInput(prompt);
                        textareaRef.current?.focus();
                      }}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
                Your prompt never needs the gateway token in the browser. The
                Worker sends the authenticated request and streams the model
                output back chunk by chunk.
              </div>
            </div>
          </aside>

          <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/70 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-white">Live conversation</p>
                <p className="text-xs text-slate-400">
                  {isStreaming
                    ? "Assistant is responding…"
                    : "Responses stream in using text/event-stream."}
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isStreaming ? "bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.8)]" : "bg-slate-500"
                  }`}
                />
                {isStreaming ? "Streaming" : "Idle"}
              </div>
            </div>

            <div
              ref={scrollerRef}
              className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
              aria-live="polite"
            >
              {messages.length === 0 ? (
                <div className="flex h-full min-h-[360px] items-center justify-center">
                  <div className="max-w-lg rounded-[28px] border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-xl">
                      ✦
                    </div>
                    <h2 className="text-2xl font-semibold text-white">
                      Start a streamed chat
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      Ask about Cloudflare, Workers AI, or anything else. The
                      assistant response will appear token by token.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((message) => {
                  const isUser = message.role === "user";

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-3xl rounded-[24px] border px-4 py-3 shadow-lg ${
                          isUser
                            ? "border-cyan-300/30 bg-cyan-300/15 text-cyan-50"
                            : message.errored
                              ? "border-rose-300/30 bg-rose-300/10 text-rose-50"
                              : "border-white/10 bg-white/[0.06] text-slate-100"
                        }`}
                      >
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                          {isUser ? "You" : "Assistant"}
                        </div>
                        <div className="whitespace-pre-wrap text-sm leading-7 md:text-[15px]">
                          {message.content || (message.pending ? "…" : "")}
                          {message.pending && (
                            <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-full bg-cyan-200/80 align-middle" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleSubmit} className="border-t border-white/10 p-4">
              <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!isStreaming && input.trim()) {
                        event.currentTarget.form?.requestSubmit();
                      }
                    }
                  }}
                  placeholder="Ask something…"
                  rows={3}
                  className="w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-white outline-none placeholder:text-slate-500"
                />

                <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-xs text-slate-400">
                    Press <span className="text-slate-200">Enter</span> to send,
                    <span className="text-slate-200"> Shift + Enter</span> for a new line.
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {isStreaming ? (
                      <button
                        type="button"
                        onClick={stopStreaming}
                        className="rounded-full border border-rose-300/30 bg-rose-300/10 px-5 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-300/20"
                      >
                        Stop
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={!input.trim() || isStreaming}
                      className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-slate-400"
                    >
                      {isStreaming ? "Streaming…" : "Send message"}
                    </button>
                  </div>
                </div>
              </div>

              {error ? (
                <p className="mt-3 text-sm text-rose-300">{error}</p>
              ) : null}
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onData: (eventData: string) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");

      if (data) {
        onData(data);
      }

      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  const finalEvent = buffer.trim();
  if (!finalEvent) return;

  const data = finalEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (data) {
    onData(data);
  }
}
