# Cloudflare AI Gateway — Setup & Demo Guide

A step-by-step guide to creating an AI Gateway and integrating it into the `ai-startup` Cloudflare Worker.

---

## What is AI Gateway?

Cloudflare AI Gateway sits between your Worker and any AI provider (OpenAI, Anthropic, Workers AI, etc.). It gives you:

- **Analytics** — request counts, token usage, latency, costs
- **Caching** — serve identical prompts from cache, cut costs
- **Rate limiting** — protect your API budget
- **Logging** — full request/response audit trail

All traffic routes through a single URL you control, with zero changes to how AI providers work.

---

## Part 1 — Create the Gateway

### Step 1 — Open the Cloudflare Dashboard

Go to [https://dash.cloudflare.com](https://dash.cloudflare.com) and log in.

### Step 2 — Navigate to AI Gateway

In the left sidebar: **AI → AI Gateway**

### Step 3 — Create a Gateway

1. Click **Create Gateway**
2. Enter a name, e.g. `ai-startup-gateway`
3. Click **Create**

Your gateway is now live. Note the **Gateway ID** shown on the detail page — you'll need it below.

### Step 4 — Note Your Credentials

From the dashboard collect:

| Value | Where to find it |
|-------|-----------------|
| `ACCOUNT_ID` | Workers & Pages → right sidebar (32-char hex) |
| `GATEWAY_ID` | AI → AI Gateway → your gateway name |

Your gateway base URL will be:
```
https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}
```

---

## Part 2 — Demo: Add an AI Chat Route to the Worker

The `ai-startup` worker uses React Router v7. We'll add a `/api/chat` route loader that proxies requests through AI Gateway to OpenAI.

### Step 5 — Store the OpenAI API Key as a Secret

```bash
# Locally (for dev):
echo "OPENAI_API_KEY=sk-..." >> .dev.vars

# For production (Cloudflare encrypted secret):
wrangler secret put OPENAI_API_KEY
```

### Step 6 — Add the Gateway URL to wrangler.jsonc

Add a `vars` block so the gateway URL is available as an environment variable (not secret — it's not sensitive):

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ai-startup",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./workers/app.ts",
  "observability": { "enabled": true },
  "vars": {
    "AI_GATEWAY_URL": "https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}/openai"
  }
}
```

Replace `{ACCOUNT_ID}` and `{GATEWAY_ID}` with your real values.

### Step 7 — Declare the Env Types

After editing `wrangler.jsonc`, regenerate types:

```bash
npm run cf-typegen
```

This updates `worker-configuration.d.ts` so TypeScript knows about `OPENAI_API_KEY` and `AI_GATEWAY_URL`.

### Step 8 — Create the API Route

Create `app/routes/api.chat.ts`:

```ts
import type { Route } from "./+types/api.chat";

export async function action({ request, context }: Route.ActionArgs) {
  const { message } = await request.json<{ message: string }>();

  const { env } = context.cloudflare;

  const response = await fetch(`${env.AI_GATEWAY_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) {
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }

  const data = await response.json();
  const reply = data.choices[0].message.content;
  return Response.json({ reply });
}
```

### Step 9 — Register the Route

In `app/routes.ts`, add:

```ts
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/chat", "routes/api.chat.ts"),
] satisfies RouteConfig;
```

### Step 10 — Add a Simple UI to the Home Route

Update `app/routes/home.tsx` to include a chat form that calls `/api/chat`:

```tsx
import { useState } from "react";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "React Router v7 + Cloudflare Workers" },
    { name: "description", content: "AI Gateway demo" },
  ];
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setReply("");
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json<{ reply: string }>();
    setReply(data.reply);
    setLoading(false);
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 600, margin: "4rem auto", padding: "0 1rem" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>AI Gateway Demo</h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>
        Requests route through Cloudflare AI Gateway → OpenAI
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask anything..."
          style={{ flex: 1, padding: "0.5rem", fontSize: "1rem", borderRadius: 4, border: "1px solid #ccc" }}
        />
        <button
          type="submit"
          disabled={loading || !message}
          style={{ padding: "0.5rem 1rem", fontSize: "1rem", borderRadius: 4, cursor: "pointer" }}
        >
          {loading ? "..." : "Send"}
        </button>
      </form>
      {reply && (
        <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f5f5f5", borderRadius: 4 }}>
          <strong>Reply:</strong>
          <p style={{ margin: "0.5rem 0 0" }}>{reply}</p>
        </div>
      )}
    </main>
  );
}
```

### Step 11 — Test Locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), type a message, click Send. The request flows:

```
Browser → React Router action → AI Gateway → OpenAI → back
```

### Step 12 — Verify in the AI Gateway Dashboard

1. Go to **AI → AI Gateway → ai-startup-gateway**
2. Click **Logs** — you'll see the request with model, tokens, latency, and cost
3. Click **Analytics** — charts appear after a few requests

### Step 13 — Deploy

```bash
git add -A
git commit -m "feat: add AI Gateway chat demo"
git push
```

CI/CD will build and deploy automatically. The live worker at  
`https://ai-startup.ross-jill-ws.workers.dev` will then proxy AI calls through your gateway.

---

## Gateway URL Reference

| Provider | URL suffix |
|----------|-----------|
| OpenAI | `/openai` |
| Anthropic | `/anthropic` |
| Workers AI | `/workers-ai` |
| OpenAI-compatible (unified) | `/compat` |

Full pattern:
```
https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}/{provider}
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `401 Unauthorized` from OpenAI | Check `OPENAI_API_KEY` is set in `.dev.vars` (local) or `wrangler secret put` (prod) |
| Gateway URL not found in env | Run `npm run cf-typegen` after editing `wrangler.jsonc` |
| Logs not appearing in dashboard | Ensure the gateway ID in `AI_GATEWAY_URL` matches what's in the Cloudflare dashboard |
| `502` from `/api/chat` | Check the Worker logs via `wrangler tail` for the upstream error |
