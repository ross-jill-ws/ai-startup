import type { Route } from "./+types/api.test-ai-worker";

type ChatRole = "system" | "user" | "assistant";

type GatewayMessage = {
  role: ChatRole;
  content: string;
};

const MODEL = "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 4_000;

export async function loader() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;

  if (!env.CF_AIG_TOKEN) {
    return Response.json(
      { error: "Missing CF_AIG_TOKEN in the worker environment." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { messages?: unknown }
    | null;
  const messages = sanitizeMessages(body?.messages);

  if (messages.length === 0) {
    return Response.json(
      { error: "At least one chat message is required." },
      { status: 400 },
    );
  }

  const upstream = await fetch(
    `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/compat/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "cf-aig-authorization": env.CF_AIG_TOKEN,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages,
      }),
      signal: request.signal,
    },
  );

  const headers = new Headers();
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
  );
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

function sanitizeMessages(input: unknown): GatewayMessage[] {
  if (!Array.isArray(input)) return [];

  return input
    .flatMap((message) => {
      if (!message || typeof message !== "object") return [];

      const candidate = message as {
        role?: unknown;
        content?: unknown;
      };

      if (
        candidate.role !== "system" &&
        candidate.role !== "user" &&
        candidate.role !== "assistant"
      ) {
        return [];
      }

      if (typeof candidate.content !== "string") return [];

      const content = candidate.content.trim().slice(0, MAX_CONTENT_LENGTH);
      if (!content) return [];

      return [{ role: candidate.role, content } satisfies GatewayMessage];
    })
    .slice(-MAX_MESSAGES);
}
