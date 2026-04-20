Now let me check the existing worker to tailor the demo to it:
Created `documents/ai-gateway-guide.md`. It covers:

1. **Dashboard setup** — creating the gateway and finding your Account ID + Gateway ID
2. **Wrangler config** — adding `AI_GATEWAY_URL` as a var and `OPENAI_API_KEY` as a secret
3. **Worker route** — a `/api/chat` action that proxies through AI Gateway to OpenAI
4. **UI demo** — a chat form on the home page wired to that route
5. **Verification** — where to check logs/analytics in the dashboard
6. **Troubleshooting** table for common issues

The demo is written specifically for this `ai-startup` worker's React Router v7 structure. Want me to actually implement the demo code into the project too?