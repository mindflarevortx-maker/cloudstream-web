/**
 * CloudStream Web — AniList OAuth2 Callback Route
 *
 * AniList uses the OAuth2 implicit-grant flow (response_type=token), so after
 * the user authorizes us, AniList redirects to:
 *
 *   ${origin}/api/sync/anilist/callback#access_token=...&expires_in=...&token_type=bearer
 *
 * The token is in the URL **fragment** (`#access_token=...`), which the browser
 * never sends to the server (RFC 3986 §3.5). So this route can't read the token
 * directly — instead we return a tiny HTML shim that:
 *   1. Reads `window.location.hash`.
 *   2. Extracts `access_token` and `expires_in`.
 *   3. Persists the token to localStorage (`cs3_anilist_token`) — this is what
 *      AniListApi.ts reads on every request.
 *   4. Also sets a cookie (`cs3_anilist_token`) so any future server-side
 *      route can read it via `request.cookies`.
 *   5. Redirects to `/settings`.
 *
 * If the fragment is missing or malformed (e.g. the user navigated here
 * directly, or AniList returned an error), we redirect to /settings with an
 * error flag in the query string so the UI can show a toast.
 *
 * See worklog Task ID D8 §5.2 for the Kotlin equivalent (which uses a custom
 * scheme `cloudstreamapp://anilistlogin` and the `splitRedirectUrl` helper).
 */

import { NextResponse } from "next/server";
import { ANILIST_TOKEN_KEY } from "@/lib/cloudstream/sync/AniListApi";

/** HTML shim that runs in the browser to extract the token from the fragment. */
function buildShimHtml(): string {
  // Inline script — no external deps. Uses encodeURIComponent on every value
  // we splice into the script body to prevent XSS if a malicious redirect
  // ever fed us a crafted fragment.
  const tokenKey = ANILIST_TOKEN_KEY;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AniList login — CloudStream</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; background: #0b0d10; color: #e6e8eb; font-family: ui-sans-serif, system-ui, sans-serif; }
  main { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
  .card { max-width: 28rem; text-align: center; }
  .spinner { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.15); border-top-color: #6ee7ff; border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { color: #9aa1aa; font-size: 0.875rem; margin: 0; }
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1>Finishing AniList sign-in…</h1>
    <p id="status">Reading access token from redirect.</p>
  </div>
</main>
<script>
(function () {
  var TOKEN_KEY = ${JSON.stringify(tokenKey)};
  var hash = window.location.hash || "";
  if (hash.charAt(0) === "#") hash = hash.slice(1);

  var params = {};
  hash.split("&").forEach(function (pair) {
    if (!pair) return;
    var idx = pair.indexOf("=");
    if (idx < 0) return;
    var k = decodeURIComponent(pair.slice(0, idx));
    var v = decodeURIComponent(pair.slice(idx + 1));
    params[k] = v;
  });

  var err = params["error"];
  if (err) {
    window.location.replace("/settings?sync_error=anilist&reason=" + encodeURIComponent(err));
    return;
  }

  var token = params["access_token"];
  if (!token) {
    window.location.replace("/settings?sync_error=anilist&reason=no_token");
    return;
  }

  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (e) {
    window.location.replace("/settings?sync_error=anilist&reason=storage");
    return;
  }

  // Set a cookie too — expiry matches AniList's 1-year token lifetime.
  var maxAge = parseInt(params["expires_in"], 10);
  if (!isFinite(maxAge) || maxAge <= 0) maxAge = 365 * 24 * 60 * 60;
  var cookie = TOKEN_KEY + "=" + encodeURIComponent(token)
    + "; Max-Age=" + maxAge
    + "; path=/; SameSite=Lax";
  document.cookie = cookie;

  // Brief delay so the user sees the spinner (and localStorage write flushes).
  setTimeout(function () {
    window.location.replace("/settings?sync_success=anilist");
  }, 350);
})();
</script>
</body>
</html>`;
}

export async function GET(): Promise<NextResponse> {
  return new NextResponse(buildShimHtml(), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Don't allow this page to be framed (defense-in-depth against
      // token-leakage via clickjacking on the OAuth2 redirect).
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

/** POST handler — not part of the OAuth2 flow, but some callers may want to
 *  POST the token from a fragment-reading shim elsewhere. Accepts JSON
 *  `{ access_token, expires_in? }` and sets the cookie server-side. */
export async function POST(request: Request): Promise<NextResponse> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  const token = body?.access_token;
  if (typeof token !== "string" || !token) {
    return NextResponse.json(
      { ok: false, error: "missing_access_token" },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  let maxAge = Number(body?.expires_in);
  if (!isFinite(maxAge) || maxAge <= 0) maxAge = 365 * 24 * 60 * 60;

  const res = NextResponse.json(
    { ok: true },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
  res.cookies.set({
    name: ANILIST_TOKEN_KEY,
    value: token,
    maxAge,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
  return res;
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
