import { buildGoogleLoginRedirect } from "~/lib/auth.server";
import type { Route } from "./+types/auth.google";

export async function loader({ request, context }: Route.LoaderArgs) {
  return buildGoogleLoginRedirect(request, context.cloudflare.env);
}
