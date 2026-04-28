import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("counter", "routes/counter.tsx"),
  route("chat-agent", "routes/chat-agent.tsx"),
  route("test-ai-worker", "routes/test-ai-worker.tsx"),
  route("api/test-ai-worker", "routes/api.test-ai-worker.ts"),
] satisfies RouteConfig;
