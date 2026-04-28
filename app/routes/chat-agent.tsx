import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";

import { getChatAgentName, requireUser } from "~/lib/auth.server";
import type { Route } from "./+types/chat-agent";

const QUICK_PROMPTS = [
  "What can I build with Cloudflare Agents?",
  "Explain Durable Objects in one paragraph.",
  "Give me 5 practical Workers AI app ideas.",
];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "LLM Chat Agent" },
    {
      name: "description",
      content: "A Cloudflare AIChatAgent backed by Workers AI.",
    },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env);
  const chatAgentName = await getChatAgentName(user, context.cloudflare.env);

  return { user, chatAgentName };
}

export default function ChatAgentRoute() {
  const { user, chatAgentName } = useLoaderData<typeof loader>();
  const [input, setInput] = useState("");
  const agent = useAgent({ agent: "ChatAgent", name: chatAgentName });
  const {
    messages,
    sendMessage,
    clearHistory,
    stop,
    status,
    error,
    isStreaming,
  } = useAgentChat({
    agent,
    getInitialMessages: getInitialMessagesSafely,
  });

  function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    void sendMessage({
      role: "user",
      parts: [{ type: "text", text }],
    });
  }

  function sendQuickPrompt(prompt: string) {
    if (isStreaming) return;

    setInput("");
    void sendMessage({
      role: "user",
      parts: [{ type: "text", text: prompt }],
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <header className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-cyan-950/30">
          <div className="mb-4 inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
            AIChatAgent • Workers AI • GLM 4.7 Flash
          </div>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">
                LLM-backed Chat Agent
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Signed in as {user.email}. This route connects to your private
                Durable Object chat session and streams responses from Workers AI.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                to="/"
                className="rounded-full border border-white/15 px-4 py-2 text-slate-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
              >
                Home
              </Link>
              <Link
                to="/counter"
                className="rounded-full border border-white/15 px-4 py-2 text-slate-100 transition hover:border-fuchsia-300/40 hover:bg-fuchsia-300/10"
              >
                Counter demo
              </Link>
              <Link
                to="/logout"
                className="rounded-full border border-white/15 px-4 py-2 text-slate-100 transition hover:border-rose-300/40 hover:bg-rose-300/10"
              >
                Sign out
              </Link>
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
              Quick prompts
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => sendQuickPrompt(prompt)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={clearHistory}
              className="mt-6 w-full rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:border-rose-300/40 hover:bg-rose-300/10"
            >
              Clear history
            </button>
          </aside>

          <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="font-medium">Conversation</p>
                <p className="text-xs text-slate-400">
                  {isStreaming ? "Streaming response…" : `Status: ${status}`}
                </p>
              </div>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="rounded-full border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-300/20"
                >
                  Stop
                </button>
              ) : null}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
              {messages.length === 0 ? (
                <div className="flex h-full min-h-[320px] items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center text-slate-300">
                  Send a message to start chatting with the agent.
                </div>
              ) : (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
              )}
            </div>

            <form onSubmit={submitMessage} className="border-t border-white/10 p-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-3">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={3}
                  placeholder="Ask the ChatAgent anything…"
                  className="w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-white outline-none placeholder:text-slate-500"
                />
                <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                  <p className="text-xs text-slate-400">
                    Press Enter to send, Shift + Enter for a newline.
                  </p>
                  <button
                    type="submit"
                    disabled={!input.trim() || isStreaming}
                    className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-slate-400"
                  >
                    Send
                  </button>
                </div>
              </div>
              {error ? <p className="mt-3 text-sm text-rose-300">{error.message}</p> : null}
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

async function getInitialMessagesSafely({ url }: { url?: string }) {
  if (!url || typeof window === "undefined") return [];

  try {
    const getMessagesUrl = new URL(url);
    getMessagesUrl.pathname += "/get-messages";

    const response = await fetch(getMessagesUrl.toString());
    if (!response.ok) {
      console.warn(
        `Failed to fetch initial ChatAgent messages: ${response.status} ${response.statusText}`,
      );
      return [];
    }

    const text = await response.text();
    if (!text.trim()) return [];

    return JSON.parse(text) as UIMessage[];
  } catch (error) {
    console.warn("Failed to fetch initial ChatAgent messages:", error);
    return [];
  }
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-3xl rounded-3xl border px-4 py-3 text-sm leading-7 shadow-lg ${
          isUser
            ? "border-cyan-300/30 bg-cyan-300/15 text-cyan-50"
            : "border-white/10 bg-white/[0.06] text-slate-100"
        }`}
      >
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
          {isUser ? "You" : "Assistant"}
        </div>
        <div className="space-y-2 whitespace-pre-wrap">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return <span key={index}>{part.text}</span>;
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}
