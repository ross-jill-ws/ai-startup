import { handleGoogleCallback } from "~/lib/auth.server";
import type { Route } from "./+types/auth.google.callback";

export async function loader({ request, context }: Route.LoaderArgs) {
  return handleGoogleCallback(request, context.cloudflare.env);
}
