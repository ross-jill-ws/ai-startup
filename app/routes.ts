import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.ts"),
  route("auth/google", "routes/auth.google.ts"),
  route("auth/google/callback", "routes/auth.google.callback.ts"),
  route("counter", "routes/counter.tsx"),
  route("chat-agent", "routes/chat-agent.tsx"),
  route("test-ai-worker", "routes/test-ai-worker.tsx"),
  route("api/ai-models", "routes/api.ai-models.ts"),
  route("api/test-ai-worker", "routes/api.test-ai-worker.ts"),
] satisfies RouteConfig;
