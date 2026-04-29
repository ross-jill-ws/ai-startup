import { useMemo, useState } from "react";
import { Link, useLoaderData } from "react-router";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { FileUIPart, UIMessage } from "ai";
import type { ChatAgent, ChatUsageState } from "../../workers/chat-agent";

import { DEFAULT_CHAT_MODEL, type ChatModelInfo } from "~/lib/ai-models";
import { listChatModels } from "~/lib/ai-models.server";
import { getChatAgentName, requireUser } from "~/lib/auth.server";
import type { Route } from "./+types/chat-agent";

const QUICK_PROMPTS = [
  "What can I build with Cloudflare Agents?",
  "Explain Durable Objects in one paragraph.",
  "Give me 5 practical Workers AI app ideas.",
];

const IMAGE_PROMPTS = [
  "Describe this image in detail.",
  "Extract all visible text and summarize it.",
  "What should I notice in this screenshot?",
];

const MAX_IMAGES = 3;
const MAX_IMAGE_SIZE_BYTES = 2_500_000;

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

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
  const [chatAgentName, models] = await Promise.all([
    getChatAgentName(user, context.cloudflare.env),
    listChatModels(context.cloudflare.env),
  ]);

  return { user, chatAgentName, models };
}

export default function ChatAgentRoute() {
  const { user, chatAgentName, models } = useLoaderData<typeof loader>();
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(
    models.some((model) => model.id === DEFAULT_CHAT_MODEL)
      ? DEFAULT_CHAT_MODEL
      : models[0]?.id ?? DEFAULT_CHAT_MODEL,
  );
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? models[0],
    [models, selectedModel],
  );
  const filteredModels = useMemo(
    () => filterModels(models, modelSearch),
    [models, modelSearch],
  );
  const modelGroups = useMemo(
    () => groupModelsByProvider(filteredModels),
    [filteredModels],
  );

  const agent = useAgent<ChatAgent, ChatUsageState>({
    agent: "ChatAgent",
    name: chatAgentName,
  });
  const usage = agent.state;
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
    body: () => ({ model: selectedModel }),
    getInitialMessages: getInitialMessagesSafely,
  });

  async function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();
    if ((!text && selectedImages.length === 0) || isStreaming || isPreparing) return;
    if (selectedImages.length > 0 && !selectedModelInfo?.supportsImages) {
      setUploadError("Choose a vision-capable model before sending images.");
      return;
    }

    await sendPreparedMessage(text, selectedImages);
  }

  async function sendPreparedMessage(text: string, images: SelectedImage[]) {
    setIsPreparing(true);
    setUploadError(null);

    try {
      const fileParts = await Promise.all(
        images.map(async ({ file }) => ({
          type: "file" as const,
          mediaType: file.type,
          filename: file.name,
          url: await fileToDataUrl(file),
        } satisfies FileUIPart)),
      );

      const parts: UIMessage["parts"] = [
        ...fileParts,
        ...(text ? [{ type: "text" as const, text }] : []),
      ];

      setInput("");
      clearSelectedImages();
      void sendMessage({ role: "user", parts });
    } catch (caughtError) {
      setUploadError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not prepare the selected image files.",
      );
    } finally {
      setIsPreparing(false);
    }
  }

  function sendQuickPrompt(prompt: string) {
    if (isStreaming || isPreparing) return;

    setInput("");
    setUploadError(null);
    void sendMessage({
      role: "user",
      parts: [{ type: "text", text: prompt }],
    });
  }

  function handleImageInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setUploadError(null);
    setSelectedImages((current) => {
      const next = [...current];

      for (const file of files) {
        if (next.length >= MAX_IMAGES) {
          setUploadError(`You can attach up to ${MAX_IMAGES} images at once.`);
          break;
        }
        if (!file.type.startsWith("image/")) {
          setUploadError("Only image files can be attached.");
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          setUploadError(`${file.name} is too large. Keep each image under 2.5 MB.`);
          continue;
        }

        next.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }

      return next;
    });
  }

  function removeSelectedImage(id: string) {
    setSelectedImages((current) => {
      const image = current.find((item) => item.id === id);
      if (image) URL.revokeObjectURL(image.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearSelectedImages() {
    setSelectedImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.previewUrl);
      return [];
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="mb-6 rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-cyan-950/30">
          <div className="mb-4 inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
            AIChatAgent • Workers AI • Multimodal
          </div>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">
                LLM-backed Chat Agent
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Signed in as {user.email}. Pick a Workers AI model, attach images
                with a vision model, and stream responses from your private Durable
                Object chat session.
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

        <section className="grid flex-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-5 rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
            <div>
              <label
                htmlFor="model"
                className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400"
              >
                Model
              </label>
              <div className="mt-3 space-y-2">
                <input
                  type="search"
                  value={modelSearch}
                  disabled={isStreaming || isPreparing}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="Search models by name, provider, or id…"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <select
                  id="model"
                  value={selectedModel}
                  disabled={isStreaming || isPreparing || filteredModels.length === 0}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedModelInfo &&
                  modelSearch.trim() &&
                  !filteredModels.some((model) => model.id === selectedModelInfo.id) ? (
                    <optgroup label="Current selection">
                      <option value={selectedModelInfo.id}>
                        {selectedModelInfo.supportsImages ? "🖼️ " : ""}
                        {selectedModelInfo.name}
                      </option>
                    </optgroup>
                  ) : null}
                  {modelGroups.map(([provider, providerModels]) => (
                    <optgroup key={provider} label={provider}>
                      {providerModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.supportsImages ? "🖼️ " : ""}{model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {filteredModels.length === models.length
                      ? `${formatInteger(models.length)} models`
                      : `${formatInteger(filteredModels.length)} of ${formatInteger(models.length)} models`}
                  </span>
                  {modelSearch ? (
                    <button
                      type="button"
                      onClick={() => setModelSearch("")}
                      className="text-cyan-200 transition hover:text-cyan-100"
                    >
                      Clear search
                    </button>
                  ) : null}
                </div>
                {filteredModels.length === 0 ? (
                  <p className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                    No models match “{modelSearch}”. Clear the search to show all models.
                  </p>
                ) : null}
              </div>

              {selectedModelInfo ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-slate-300">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-cyan-100">
                      {selectedModelInfo.supportsImages ? "Vision" : "Text only"}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-slate-200">
                      {selectedModelInfo.provider}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-slate-200">
                      {selectedModelInfo.source === "cloudflare"
                        ? "Workers AI catalog"
                        : selectedModelInfo.source === "ai-gateway"
                          ? "AI Gateway"
                          : "Fallback catalog"}
                    </span>
                    {selectedModelInfo.contextWindow ? (
                      <span className="rounded-full bg-white/10 px-2 py-1 text-slate-200">
                        {formatNumber(selectedModelInfo.contextWindow)} ctx
                      </span>
                    ) : null}
                  </div>
                  <p>{selectedModelInfo.description}</p>
                  {selectedModelInfo.provider === "Workers AI" && selectedModelInfo.pricing ? (
                    <p className="mt-2 text-slate-400">
                      Price: {formatUsd(selectedModelInfo.pricing.inputPerMillion ?? 0)}/M in ·{" "}
                      {formatUsd(selectedModelInfo.pricing.outputPerMillion ?? 0)}/M out
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                Quick prompts
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={isStreaming || isPreparing}
                    onClick={() => sendQuickPrompt(prompt)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                Image prompts
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {IMAGE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={isStreaming || isPreparing || !selectedModelInfo?.supportsImages}
                    onClick={() => setInput(prompt)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-200 transition hover:border-emerald-300/35 hover:bg-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                Session usage
              </p>
              <UsageStats usage={usage} model={selectedModelInfo} />
            </div>

            <button
              type="button"
              onClick={() => {
                clearHistory();
                void agent.stub.resetUsage();
              }}
              className="w-full rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:border-rose-300/40 hover:bg-rose-300/10"
            >
              Clear history + usage
            </button>
          </aside>

          <div className="flex min-h-[72vh] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/70">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="font-medium">Conversation</p>
                <p className="text-xs text-slate-400">
                  {isStreaming
                    ? `Streaming from ${selectedModelInfo?.name ?? selectedModel}`
                    : `Status: ${status} • ${selectedModelInfo?.name ?? selectedModel}`}
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
                  Start with text, or switch to a vision model and attach images.
                </div>
              ) : (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
              )}
            </div>

            <form onSubmit={submitMessage} className="border-t border-white/10 p-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-3">
                {selectedImages.length > 0 ? (
                  <div className="mb-3 grid gap-3 border-b border-white/10 pb-3 sm:grid-cols-3">
                    {selectedImages.map((image) => (
                      <div key={image.id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
                        <img
                          src={image.previewUrl}
                          alt={image.file.name}
                          className="h-28 w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeSelectedImage(image.id)}
                          className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs text-white opacity-90 transition hover:bg-rose-500"
                        >
                          Remove
                        </button>
                        <div className="truncate px-3 py-2 text-xs text-slate-300">
                          {image.file.name}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

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
                  placeholder={
                    selectedImages.length > 0
                      ? "Ask about the attached image…"
                      : "Ask the ChatAgent anything…"
                  }
                  className="w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-white outline-none placeholder:text-slate-500"
                />
                <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-xs text-slate-400">
                    Press <span className="text-slate-200">Enter</span> to send,
                    <span className="text-slate-200"> Shift + Enter</span> for newline.
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="cursor-pointer rounded-full border border-white/15 px-4 py-2 text-sm text-slate-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/10">
                      Attach images
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleImageInput}
                        disabled={isStreaming || isPreparing}
                        className="sr-only"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={
                        (!input.trim() && selectedImages.length === 0) ||
                        isStreaming ||
                        isPreparing
                      }
                      className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-slate-400"
                    >
                      {isPreparing ? "Preparing…" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
              {uploadError ? <p className="mt-3 text-sm text-amber-300">{uploadError}</p> : null}
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

function UsageStats({
  usage,
  model,
}: {
  usage?: ChatUsageState;
  model?: ChatModelInfo;
}) {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const estimatedCostUsd = usage?.estimatedCostUsd ?? 0;
  const unpricedTokens = usage?.unpricedTokens ?? 0;

  return (
    <div className="mt-4 grid gap-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-400">Input tokens</span>
        <span className="font-semibold text-white">{formatInteger(inputTokens)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-400">Output tokens</span>
        <span className="font-semibold text-white">{formatInteger(outputTokens)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-400">Estimated cost</span>
        <span className="font-semibold text-emerald-200">
          {formatUsd(estimatedCostUsd)}
        </span>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
          Current rate
        </div>
        <div className="mt-1 text-xs leading-5 text-slate-300">
          {model?.pricing ? (
            <>
              {formatUsd(model.pricing.inputPerMillion ?? 0)}/M input ·{" "}
              {formatUsd(model.pricing.outputPerMillion ?? 0)}/M output
              {model.pricing.cachedInputPerMillion !== undefined ? (
                <> · {formatUsd(model.pricing.cachedInputPerMillion)}/M cached</>
              ) : null}
            </>
          ) : (
            "No rate metadata for selected model"
          )}
        </div>
      </div>
      {usage?.turns ? (
        <p className="text-xs leading-5 text-slate-500">
          Across {usage.turns} model turn{usage.turns === 1 ? "" : "s"}. Last turn:{" "}
          {formatInteger(usage.lastInputTokens ?? 0)} in /{" "}
          {formatInteger(usage.lastOutputTokens ?? 0)} out.
        </p>
      ) : (
        <p className="text-xs leading-5 text-slate-500">
          Usage appears after the first completed model response.
        </p>
      )}
      {unpricedTokens > 0 ? (
        <p className="text-xs leading-5 text-amber-200">
          {formatInteger(unpricedTokens)} tokens used by models without local
          price metadata are not included in the estimate.
        </p>
      ) : null}
    </div>
  );
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
        <div className="space-y-3 whitespace-pre-wrap">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return <p key={index}>{part.text}</p>;
            }

            if (part.type === "file") {
              if (part.mediaType.startsWith("image/")) {
                return (
                  <img
                    key={index}
                    src={part.url}
                    alt={part.filename ?? "Uploaded image"}
                    className="max-h-72 rounded-2xl border border-white/10 object-contain"
                  />
                );
              }

              return (
                <a
                  key={index}
                  href={part.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-cyan-100"
                >
                  {part.filename ?? part.mediaType}
                </a>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(`Could not read ${file.name}.`));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

function filterModels(models: ChatModelInfo[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return models;

  return models.filter((model) =>
    [model.name, model.id, model.provider, model.description, model.task]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
}

function groupModelsByProvider(models: ChatModelInfo[]) {
  const groups = new Map<string, ChatModelInfo[]>();

  for (const model of models) {
    const provider =
      model.provider === "Workers AI"
        ? model.supportsImages
          ? "Workers AI — Text + Vision"
          : "Workers AI — Text only"
        : model.provider;
    const group = groups.get(provider) ?? [];
    group.push(model);
    groups.set(provider, group);
  }

  const preferredOrder = [
    "Workers AI — Text + Vision",
    "Workers AI — Text only",
    "Anthropic",
    "OpenAI",
    "Google AI Studio",
    "DeepSeek",
  ];

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const aIndex = preferredOrder.indexOf(a);
      const bIndex = preferredOrder.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
          (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      }
      return a.localeCompare(b);
    })
    .map(([provider, providerModels]) => [
      provider,
      providerModels.sort((a, b) => a.name.localeCompare(b.name)),
    ] as const);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatUsd(value: number) {
  if (value > 0 && value < 0.0001) return "< $0.0001";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}
