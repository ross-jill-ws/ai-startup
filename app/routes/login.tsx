import { Link, redirect, useLoaderData } from "react-router";

import { getUser } from "~/lib/auth.server";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign in | AI Startup" },
    { name: "description", content: "Sign in with Google to use AI Startup." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getUser(request, context.cloudflare.env);
  const url = new URL(request.url);
  const next = sanitizeNext(url.searchParams.get("next"));

  if (user) {
    throw redirect(next, 302);
  }

  return {
    next,
    error: getErrorMessage(url.searchParams.get("error")),
  };
}

export default function Login() {
  const { next, error } = useLoaderData<typeof loader>();
  const googleHref = `/auth/google?next=${encodeURIComponent(next)}`;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080b10] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.20),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(245,158,11,0.16),transparent_24%),radial-gradient(circle_at_50%_90%,rgba(34,197,94,0.12),transparent_30%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:44px_44px]" />

      <section className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-8">
          <div className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-cyan-100">
            Private AI workspace
          </div>
          <div>
            <h1 className="max-w-3xl text-5xl font-semibold tracking-[-0.05em] text-white md:text-7xl">
              Sign in before the agents wake up.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 md:text-lg">
              AI Startup now keeps the app behind Google sign-in. Your chat history is routed to a Durable Object session derived from your Google account.
            </p>
          </div>
          <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
            {["Google verified", "Private chat room", "Workers AI ready"].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/80 p-6">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Authentication</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">Continue with Google</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Only signed-in users can open the app, API routes, or Agent WebSocket connections.
              </p>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <Link
              to={googleHref}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              <GoogleIcon />
              Sign in with Google
            </Link>

            <p className="mt-5 text-center text-xs leading-5 text-slate-500">
              By continuing, your Google profile ID is used to create your private ChatAgent session name.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function sanitizeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function getErrorMessage(error: string | null) {
  switch (error) {
    case "oauth_state":
      return "The Google sign-in state expired. Please try again.";
    case "email_not_verified":
      return "Your Google account email is not verified.";
    default:
      return null;
  }
}
