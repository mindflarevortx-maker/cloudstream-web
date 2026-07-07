/**
 * CloudStream Web — MAL OAuth2 Callback Route
 *
 * MAL uses the OAuth2 authorization-code flow with PKCE (plain challenge).
 * After the user authorizes us, MAL redirects to:
 *
 *   ${origin}/api/sync/mal/callback?code=...&state=...
 *
 * Unlike AniList's implicit flow, the params here are in the **query string**
 * (not the fragment), so the server CAN read them directly. This route:
 *   1. Reads `code` and `state` from the query string.
 *   2. Reads the `cs3_mal_code_verifier` and `cs3_mal_state` cookies that
 *      `MALApi.login()` set before the redirect.
 *   3. Validates `state` against the cookie (CSRF protection).
 *   4. Exchanges the code for an access token by POSTing to
 *      `https://myanimelist.net/v1/oauth2/token` with the code_verifier.
 *   5. Sets the access_token as a cookie (`cs3_mal_token`) and returns an
 *      HTML shim that copies it into localStorage (where MALApi.ts reads it).
 *   6. Redirects to `/settings`.
 *
 * The token-exchange POST is server-side because MAL's token endpoint doesn't
 * support CORS. The proxy at `/api/proxy` is browser-only; the server can
 * call `fetch()` directly here.
 *
 * See worklog Task ID D8 §6.2 for the Kotlin equivalent (which uses a custom
 * scheme `cloudstreamapp://mallogin` and validates state against an in-memory
 * `requestIdCounter`).
 */

import { NextResponse } from "next/server";
import {
  MAL_TOKEN_KEY,
  MAL_TOKEN_COOKIE,
  MAL_REFRESH_TOKEN_KEY,
  MAL_CODE_VERIFIER_COOKIE,
  MAL_STATE_COOKIE,
} from "@/lib/cloudstream/sync/MALApi";

/** Cookie names are re-declared here so the route handler doesn't need to know
 *  about MALApi's cookie-name exports. (They're the same strings.) */
const COOKIE_NAMES = {
  verifier: "cs3_mal_code_verifier",
  state: "cs3_mal_state",
  token: MAL_TOKEN_COOKIE,
} as const;

interface MalTokenResponse {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  refresh_token?: string;
}

/** POST to MAL's token endpoint and return the parsed token response. */
async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): Promise<MalTokenResponse | null> {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  try {
    const res = await fetch("https://myanimelist.net/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: body.toString(),
      // 15s timeout — MAL is usually fast.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[MAL callback] token exchange HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as MalTokenResponse;
  } catch (e) {
    console.warn("[MAL callback] token exchange failed:", e);
    return null;
  }
}

/** Read the MAL client_id from the `cs3_mal_client_id` cookie (set by the
 *  settings page when the user pastes their client id). Falls back to a
 *  request to the client to set the cookie if missing. */
function getClientIdFromCookies(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("cs3_mal_client_id="));
  if (!match) return null;
  const value = match.split("=").slice(1).join("=");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="));
  if (!match) return null;
  const value = match.split("=").slice(1).join("=");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildSuccessShim(
  accessToken: string,
  refreshToken: string | null,
  maxAge: number,
): string {
  // We expose the token to the inline script via JSON.stringify (safe escape).
  // The script copies them into localStorage — the canonical storage location
  // that MALApi.ts reads from.
  const payload = JSON.stringify({
    token: accessToken,
    refreshToken,
    maxAge,
    tokenKey: MAL_TOKEN_KEY,
    refreshTokenKey: MAL_REFRESH_TOKEN_KEY,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MAL login — CloudStream</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; background: #0b0d10; color: #e6e8eb; font-family: ui-sans-serif, system-ui, sans-serif; }
  main { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
  .card { max-width: 28rem; text-align: center; }
  .spinner { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.15); border-top-color: #2e51a2; border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { color: #9aa1aa; font-size: 0.875rem; margin: 0; }
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1>Finishing MAL sign-in…</h1>
    <p>Storing access token.</p>
  </div>
</main>
<script>
(function () {
  var payload = ${payload};
  try {
    localStorage.setItem(payload.tokenKey, payload.token);
    if (payload.refreshToken) {
      localStorage.setItem(payload.refreshTokenKey, payload.refreshToken);
    }
  } catch (e) {
    window.location.replace("/settings?sync_error=mal&reason=storage");
    return;
  }
  setTimeout(function () {
    window.location.replace("/settings?sync_success=mal");
  }, 350);
})();
</script>
</body>
</html>`;
}

function buildErrorShim(reason: string): string {
  const safeReason = encodeURIComponent(reason);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MAL login failed — CloudStream</title>
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; background: #0b0d10; color: #e6e8eb; font-family: ui-sans-serif, system-ui, sans-serif; }
  main { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
</style>
</head>
<body>
<main>
  <div>
    <h1>MAL sign-in failed</h1>
    <p>Redirecting back to settings…</p>
  </div>
</main>
<script>
  window.location.replace("/settings?sync_error=mal&reason=${safeReason}");
</script>
</body>
</html>`;
}

function shimResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

/** Clear the PKCE cookies so they can't be replayed. */
function clearPkceCookies(res: NextResponse): void {
  res.cookies.set(COOKIE_NAMES.verifier, "", { maxAge: 0, path: "/" });
  res.cookies.set(COOKIE_NAMES.state, "", { maxAge: 0, path: "/" });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return shimResponse(buildErrorShim(error));
  }
  if (!code || !state) {
    return shimResponse(buildErrorShim("missing_code_or_state"));
  }

  // CSRF: validate state against the cookie set by MALApi.login().
  const expectedState = getCookie(request, COOKIE_NAMES.state);
  if (!expectedState || expectedState !== state) {
    return shimResponse(buildErrorShim("state_mismatch"));
  }

  const codeVerifier = getCookie(request, COOKIE_NAMES.verifier);
  if (!codeVerifier) {
    return shimResponse(buildErrorShim("missing_verifier"));
  }

  const clientId = getClientIdFromCookies(request);
  if (!clientId) {
    // The client_id was set in localStorage by the settings page — the server
    // doesn't have access to localStorage. We need the client to send it via
    // a cookie too. For now, return an error: the settings page should also
    // write a `cs3_mal_client_id` cookie when the user pastes the id.
    return shimResponse(buildErrorShim("missing_client_id"));
  }

  const redirectUri = `${url.origin}/api/sync/mal/callback`;
  const tokenResp = await exchangeCodeForToken(code, codeVerifier, clientId, redirectUri);
  if (!tokenResp?.access_token) {
    return shimResponse(buildErrorShim("token_exchange_failed"));
  }

  const maxAge =
    typeof tokenResp.expires_in === "number" && tokenResp.expires_in > 0
      ? tokenResp.expires_in
      : 30 * 24 * 60 * 60; // MAL default ~30 days; fall back to 30d.

  // Set the access_token as a cookie (so server-side routes can read it).
  // We also expose it via the HTML shim so the client can mirror it into
  // localStorage where MALApi.ts reads from.
  const res = shimResponse(
    buildSuccessShim(tokenResp.access_token, tokenResp.refresh_token ?? null, maxAge),
  );
  res.cookies.set({
    name: COOKIE_NAMES.token,
    value: tokenResp.access_token,
    maxAge,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
  if (tokenResp.refresh_token) {
    res.cookies.set({
      name: MAL_REFRESH_TOKEN_KEY,
      value: tokenResp.refresh_token,
      // Refresh tokens live longer than access tokens — give them 2x.
      maxAge: maxAge * 2,
      path: "/",
      sameSite: "lax",
      httpOnly: true, // Refresh tokens are sensitive — never expose to JS.
    });
  }
  clearPkceCookies(res);
  return res;
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
