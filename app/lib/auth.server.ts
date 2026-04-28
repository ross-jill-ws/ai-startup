import { redirect } from "react-router";

export type AuthenticatedUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
};

type AuthEnv = Env & {
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

type SessionPayload = AuthenticatedUser & {
  exp: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

const SESSION_COOKIE = "ai_startup_session";
const OAUTH_STATE_COOKIE = "ai_startup_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

export async function requireUser(
  request: Request,
  env: Env,
): Promise<AuthenticatedUser> {
  const user = await getUser(request, env);
  if (user) return user;

  const url = new URL(request.url);
  throw redirect(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
}

export async function getUser(
  request: Request,
  env: Env,
): Promise<AuthenticatedUser | null> {
  const cookie = getCookie(request, SESSION_COOKIE);
  if (!cookie) return null;

  const session = await verifySessionCookie(cookie, getAuthSecret(env));
  if (!session || session.exp < Math.floor(Date.now() / 1000)) return null;

  return {
    id: session.id,
    email: session.email,
    emailVerified: session.emailVerified,
    name: session.name,
    picture: session.picture,
  };
}

export function isAuthPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/auth/google" ||
    pathname === "/auth/google/callback"
  );
}

export async function getChatAgentName(user: AuthenticatedUser, env: Env) {
  const digest = await hmacSha256Base64Url(getAuthSecret(env), user.id);
  return `user-${digest.slice(0, 40)}`;
}

export async function buildGoogleLoginRedirect(request: Request, env: Env) {
  const url = new URL(request.url);
  const next = sanitizeNextPath(url.searchParams.get("next"));
  const state = `${randomBase64Url(24)}.${base64UrlEncode(next)}`;
  const redirectUri = getGoogleRedirectUri(request);

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", getGoogleClientId(env));
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);
  googleUrl.searchParams.set("access_type", "offline");
  googleUrl.searchParams.set("prompt", "select_account");

  return redirect(googleUrl.toString(), {
    headers: {
      "Set-Cookie": serializeCookie(OAUTH_STATE_COOKIE, state, {
        request,
        maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
      }),
    },
  });
}

export async function handleGoogleCallback(request: Request, env: Env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = getCookie(request, OAUTH_STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    throw redirect("/login?error=oauth_state");
  }

  const user = await exchangeCodeForGoogleUser(request, env, code);
  if (!user.emailVerified) {
    throw redirect("/login?error=email_not_verified");
  }

  const next = getNextPathFromState(state);
  const sessionCookie = await createSessionCookie(user, env, request);
  const clearStateCookie = clearCookie(OAUTH_STATE_COOKIE, request);

  return redirect(next, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", clearStateCookie],
    ],
  });
}

export function logout(request: Request) {
  return redirect("/login", {
    headers: {
      "Set-Cookie": clearCookie(SESSION_COOKIE, request),
    },
  });
}

function getGoogleRedirectUri(request: Request) {
  return `${new URL(request.url).origin}/auth/google/callback`;
}

async function exchangeCodeForGoogleUser(
  request: Request,
  env: Env,
  code: string,
): Promise<AuthenticatedUser> {
  const body = new URLSearchParams({
    code,
    client_id: getGoogleClientId(env),
    client_secret: getGoogleClientSecret(env),
    redirect_uri: getGoogleRedirectUri(request),
    grant_type: "authorization_code",
  });

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const tokenJson = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!tokenResponse.ok || !tokenJson.access_token) {
    throw new Response(
      tokenJson.error_description || tokenJson.error || "Google token exchange failed.",
      { status: 401 },
    );
  }

  const userInfoResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    },
  );

  const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;
  if (!userInfoResponse.ok || !userInfo.sub || !userInfo.email) {
    throw new Response("Could not load Google profile.", { status: 401 });
  }

  return {
    id: userInfo.sub,
    email: userInfo.email,
    emailVerified: Boolean(userInfo.email_verified),
    name: userInfo.name || userInfo.email,
    picture: userInfo.picture || null,
  };
}

async function createSessionCookie(
  user: AuthenticatedUser,
  env: Env,
  request: Request,
) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...user,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };

  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256Base64Url(getAuthSecret(env), payloadBase64);

  return serializeCookie(SESSION_COOKIE, `${payloadBase64}.${signature}`, {
    request,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

async function verifySessionCookie(
  value: string,
  secret: string,
): Promise<SessionPayload | null> {
  const [payloadBase64, signature] = value.split(".");
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = await hmacSha256Base64Url(secret, payloadBase64);
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  try {
    return JSON.parse(base64UrlDecode(payloadBase64)) as SessionPayload;
  } catch {
    return null;
  }
}

function getAuthSecret(env: Env) {
  const secret = (env as AuthEnv).BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Missing BETTER_AUTH_SECRET worker secret.");
  return secret;
}

function getGoogleClientId(env: Env) {
  const clientId = (env as AuthEnv).GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID worker secret.");
  return clientId;
}

function getGoogleClientSecret(env: Env) {
  const clientSecret = (env as AuthEnv).GOOGLE_CLIENT_SECRET;
  if (!clientSecret) throw new Error("Missing GOOGLE_CLIENT_SECRET worker secret.");
  return clientSecret;
}

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }

  return null;
}

function serializeCookie(
  name: string,
  value: string,
  options: { request: Request; maxAge: number },
) {
  const secure = new URL(options.request.url).protocol === "https:";
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
    `Max-Age=${options.maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function clearCookie(name: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

function sanitizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (isAuthPublicPath(new URL(value, "https://example.com").pathname)) return "/";
  return value;
}

function getNextPathFromState(state: string) {
  const encodedNext = state.split(".")[1];
  if (!encodedNext) return "/";

  try {
    return sanitizeNextPath(base64UrlDecode(encodedNext));
  } catch {
    return "/";
  }
}

async function hmacSha256Base64Url(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function randomBase64Url(bytes: number) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return bytesToBase64Url(data);
}

function base64UrlEncode(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
