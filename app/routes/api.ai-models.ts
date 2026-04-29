import { listChatModels } from "~/lib/ai-models.server";
import { requireUser } from "~/lib/auth.server";
import type { Route } from "./+types/api.ai-models";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUser(request, context.cloudflare.env);
  const models = await listChatModels(context.cloudflare.env);

  return Response.json({ models });
}
