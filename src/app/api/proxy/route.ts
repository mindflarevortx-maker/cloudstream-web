/**
 * CloudStream Web — Server-side HTTP Proxy
 *
 * The browser HTTP client at `src/lib/cloudstream/http.ts` routes every request through
 * this endpoint to bypass CORS restrictions. Browsers can't fetch arbitrary
 * cross-origin pages from an extension's provider without CORS headers, and most
 * streaming / scraper sites don't send `Access-Control-Allow-Origin`. So the
 * browser POSTs the request here, the server re-issues it with `fetch()`, and
 * returns the response body + headers in a CORS-friendly envelope.
 *
 * This mirrors the CloudStream Android app's use of OkHttp directly (no CORS on
 * native) — on web, the server-side proxy is the equivalent escape hatch.
 *
 * Security: SSRF protection via a hostname blocklist (localhost, link-local,
 * private ranges) with an explicit allowlist for the domains the extractors /
 * providers legitimately need to hit (raw.githubusercontent.com, archive.org,
 * inv.nadeko.net, iptv-org.github.io).
 *
 * Contract (matches what `http.ts` POSTs):
 *   Request:  { method: "GET"|"POST"|"HEAD", url: string, body?: any, headers?: Record<string,string> }
 *   Response: { statusCode, headers, body, bodyBase64? }
 *
 * bodyBase64 is only included for non-text responses (binary content like images,
 * video segments, etc.). Text responses are UTF-8 encoded into `body`.
 */

import { NextResponse } from "next/server";
import { DEFAULT_USER_AGENT } from "@/lib/cloudstream/http";

/** 30 seconds — matches the extractor convention (WebViewResolver uses 60s; we're stricter). */
const PROXY_TIMEOUT_MS = 30_000;

/**
 * Hostnames that are ALWAYS allowed even if they would otherwise match the
 * private-range blocklist. These are public-facing CDNs / APIs that the
 * extractors and providers legitimately need to reach.
 *
 * - raw.githubusercontent.com — extension repo downloads, plugin manifests
 * - archive.org               — InternetArchive provider + extractor
 * - inv.nadeko.net            — Invidious API (YouTubeExtractor fallback)
 * - iptv-org.github.io        — iptv-org provider (m3u playlists)
 */
const HOSTNAME_ALLOWLIST = new Set<string>([
  "raw.githubusercontent.com",
  "archive.org",
  "inv.nadeko.net",
  "iptv-org.github.io",
]);

/**
 * SSRF protection: returns true if the hostname is a private / loopback /
 * link-local / documentation address that we should refuse to proxy to.
 *
 * Covers:
 *   - localhost, *.localhost
 *   - 127.0.0.0/8 (loopback)
 *   - 10.0.0.0/8 (private)
 *   - 192.168.0.0/16 (private)
 *   - 172.16.0.0/12 (private — 172.16.0.0 to 172.31.255.255)
 *   - 169.254.0.0/16 (link-local)
 *   - 0.0.0.0/8 (unspecified / "this host")
 *   - ::1, fc00::/7, fe80::/10 (IPv6 loopback / unique-local / link-local)
 *   - *.local mDNS
 */
function isBlockedHostname(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // Allowlist short-circuits everything.
  if (HOSTNAME_ALLOWLIST.has(h)) return false;

  // Literal "localhost" or any *.localhost
  if (h === "localhost" || h.endsWith(".localhost")) return true;

  // *.local (mDNS)
  if (h.endsWith(".local")) return true;

  // IPv4 dotted-quad check
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = parseInt(ipv4[1], 10);
    const b = parseInt(ipv4[2], 10);
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map((o) => parseInt(o, 10));
    if (octets.some((o) => o > 255)) return true;

    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 (loopback)
    if (a === 0) return true; // 0.0.0.0/8 (unspecified)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (private)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 (private)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  }

  // IPv6 check (basic)
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb"))
      return true; // fe80::/10 link-local
  }

  return false;
}

/**
 * Strip headers that should not be forwarded verbatim. These are either
 * hop-by-hop headers (RFC 7230 §6.1) or headers that fetch() will recompute
 * based on the actual request body (Content-Length) or that would leak
 * the proxy's internal address (Host).
 */
function stripRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const stripped: Record<string, string> = {};
  const blocked = new Set([
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "proxy-connection",
    "proxy-authorization",
    "proxy-authenticate",
    "te",
    "trailer",
  ]);
  for (const [k, v] of Object.entries(headers)) {
    if (!blocked.has(k.toLowerCase())) {
      stripped[k] = v;
    }
  }
  return stripped;
}

/**
 * Strip headers that shouldn't be propagated back to the browser client.
 * Mostly hop-by-hop and headers that the browser would refuse to read for
 * security reasons (Set-Cookie is allowed — the client may want to inspect
 * cookies for the CloudflareKiller-equivalent flow).
 */
function stripResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const blocked = new Set([
    "content-encoding", // fetch() already decoded; re-advertising would confuse the client
    "content-length", // may differ after decompression
    "transfer-encoding",
    "connection",
    "keep-alive",
  ]);
  headers.forEach((value, key) => {
    if (!blocked.has(key.toLowerCase())) {
      out[key] = value;
    }
  });
  return out;
}

interface ProxyRequestBody {
  method?: "GET" | "POST" | "HEAD";
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Determine whether a response is "text" (UTF-8 decodable) or binary.
 * We use the Content-Type header as the primary signal, with a URL-extension
 * fallback for hosts that mislabel their responses.
 */
function isTextResponse(contentType: string | null, url: string): boolean {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (
      ct.startsWith("text/") ||
      ct.includes("json") ||
      ct.includes("xml") ||
      ct.includes("javascript") ||
      ct.includes("utf-8") ||
      ct.includes("urlencoded")
    ) {
      return true;
    }
    // Default to binary for image/*, video/*, audio/*, application/octet-stream, etc.
    return false;
  }
  // No Content-Type — guess from URL extension.
  if (/\.(m3u8|mpd|json|xml|txt|html?|js|css|srt|vtt|tsv|csv)(\?|#|$)/i.test(url)) {
    return true;
  }
  return false;
}

/** Convert a binary Uint8Array to base64 (handles chunked input > 32k). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // 32k — String.fromCharCode applies per-char limit
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as number[]);
  }
  // btoa is available in Next.js server runtime (it polyfills Browser globals)
  return btoa(binary);
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: ProxyRequestBody;
  try {
    payload = (await request.json()) as ProxyRequestBody;
  } catch {
    return NextResponse.json(
      { statusCode: 400, headers: {}, body: "Invalid JSON body" },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  const method = (payload.method || "GET").toUpperCase() as "GET" | "POST" | "HEAD";
  const targetUrl = payload.url;

  if (!targetUrl || typeof targetUrl !== "string") {
    return NextResponse.json(
      { statusCode: 400, headers: {}, body: "Missing 'url' in request body" },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Parse the URL and apply the SSRF blocklist.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return NextResponse.json(
      { statusCode: 400, headers: {}, body: `Invalid URL: ${targetUrl}` },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Only allow http: and https: schemes — no file:, data:, ftp:, etc.
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return NextResponse.json(
      {
        statusCode: 403,
        headers: {},
        body: `Disallowed protocol: ${parsedUrl.protocol}`,
      },
      { status: 403, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  if (isBlockedHostname(parsedUrl.hostname)) {
    return NextResponse.json(
      {
        statusCode: 403,
        headers: {},
        body: `Blocked: ${parsedUrl.hostname} is on the SSRF blocklist`,
      },
      { status: 403, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Build the request headers: strip hop-by-hop, inject default User-Agent
  // if the caller didn't supply one.
  const reqHeaders: Record<string, string> = stripRequestHeaders(payload.headers || {});
  if (!Object.keys(reqHeaders).some((k) => k.toLowerCase() === "user-agent")) {
    reqHeaders["User-Agent"] = DEFAULT_USER_AGENT;
  }

  // Build the fetch options.
  const fetchOptions: RequestInit = {
    method,
    headers: reqHeaders,
    // The proxy follows redirects — the client doesn't need to see 3xx.
    // This matches the Kotlin `app.get(...)` default (allowRedirects = true).
    redirect: "follow",
    // 30-second hard timeout.
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  };

  // Attach body for POST. Body can be a string, a JSON-serializable object,
  // or undefined. We do NOT support FormData / Blob / ArrayBuffer over the
  // JSON wire format — if a provider needs binary POST, they'd have to
  // base64-encode it themselves (no current provider does this).
  if (method === "POST" && payload.body !== undefined && payload.body !== null) {
    const contentType = Object.entries(reqHeaders).find(
      ([k]) => k.toLowerCase() === "content-type"
    )?.[1];

    if (typeof payload.body === "string") {
      fetchOptions.body = payload.body;
    } else if (
      contentType &&
      contentType.toLowerCase().includes("application/x-www-form-urlencoded")
    ) {
      // Object → URL-encoded string
      const params = new URLSearchParams();
      const obj = payload.body as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) {
        params.append(k, typeof v === "string" ? v : String(v));
      }
      fetchOptions.body = params.toString();
    } else {
      // Default: JSON-serialize the body and ensure Content-Type is JSON.
      fetchOptions.body = JSON.stringify(payload.body);
      if (!contentType) {
        reqHeaders["Content-Type"] = "application/json";
      }
    }
  }

  // Issue the upstream fetch.
  let upstream: Response;
  try {
    upstream = await fetch(parsedUrl.toString(), fetchOptions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish timeout from generic network errors.
    const isTimeout =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return NextResponse.json(
      {
        statusCode: isTimeout ? 504 : 502,
        headers: {},
        body: `Proxy fetch failed: ${msg}`,
      },
      {
        status: 200, // 200 OK with error payload — the client unpacks statusCode
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  // Build the response envelope.
  const respHeaders = stripResponseHeaders(upstream.headers);
  const contentType = upstream.headers.get("content-type");

  // HEAD: return only status + headers, no body (matches HTTP HEAD semantics).
  if (method === "HEAD") {
    return NextResponse.json(
      {
        statusCode: upstream.status,
        headers: respHeaders,
        body: "",
      },
      {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  // For GET/POST: read the body.
  if (isTextResponse(contentType, parsedUrl.toString())) {
    const text = await upstream.text();
    return NextResponse.json(
      {
        statusCode: upstream.status,
        headers: respHeaders,
        body: text,
      },
      {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  // Binary response: encode as base64.
  const buf = await upstream.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return NextResponse.json(
    {
      statusCode: upstream.status,
      headers: respHeaders,
      body: "",
      bodyBase64: uint8ToBase64(bytes),
    },
    {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
    }
  );
}

/**
 * Handle CORS preflight. The browser's fetch() will OPTIONS-preflight any
 * POST with `Content-Type: application/json`, so we need to respond with
 * the appropriate Access-Control-* headers.
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * GET handler — convenience for ad-hoc testing / health check.
 * Not used by the http.ts client (which always POSTs), but useful for
 * `curl http://localhost:3000/api/proxy?url=https://example.com` debugging.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { ok: true, message: "CloudStream proxy is running. POST { method, url, body?, headers? }." },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
  // Re-dispatch as a POST internally.
  return POST(
    new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "GET", url }),
    })
  );
}
