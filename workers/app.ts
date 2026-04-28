import { createRequestHandler } from "react-router";
import { routeAgentRequest } from "agents";
import { getChatAgentName, getUser } from "../app/lib/auth.server";

export { CounterAgent } from "./agent";
export { ChatAgent } from "./chat-agent";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    // Route agent WebSocket/RPC requests first, but only for signed-in users.
    const agentResponse = await routeAgentRequest(request, env, {
      onBeforeConnect: (agentRequest, lobby) =>
        authorizeAgentRequest(agentRequest, env, lobby),
      onBeforeRequest: (agentRequest, lobby) =>
        authorizeAgentRequest(agentRequest, env, lobby),
    });
    if (agentResponse) return agentResponse;

    // Fall through to React Router for everything else
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;

async function authorizeAgentRequest(
  request: Request,
  env: Env,
  lobby: { className: string; name: string },
) {
  const user = await getUser(request, env);
  if (!user) return new Response("Unauthorized", { status: 401 });

  if (lobby.className === "ChatAgent") {
    const expectedName = await getChatAgentName(user, env);
    if (lobby.name !== expectedName) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  return request;
}
