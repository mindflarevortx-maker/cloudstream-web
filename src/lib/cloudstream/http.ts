/**
 * CloudStream Web — HTTP Client
 * Browser-based port of nicehttp's Requests.
 * Routes through a server-side proxy to bypass CORS.
 */

import type { HttpClient, HttpResponse } from "../cloudstream/MainAPI";

const PROXY_PATH = "/api/proxy";

/** Create a browser-side HTTP client that proxies through our backend */
export function createHttpClient(defaultHeaders: Record<string, string> = {}): HttpClient {
  return {
    async get(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
      return fetchViaProxy("GET", url, undefined, { ...defaultHeaders, ...headers });
    },
    async post(url: string, body?: any, headers: Record<string, string> = {}): Promise<HttpResponse> {
      return fetchViaProxy("POST", url, body, { ...defaultHeaders, ...headers });
    },
    async head(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
      return fetchViaProxy("HEAD", url, undefined, { ...defaultHeaders, ...headers });
    },
  };
}

async function fetchViaProxy(
  method: string,
  url: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  const res = await fetch(PROXY_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, url, body, headers }),
  });

  if (!res.ok) {
    return {
      url,
      statusCode: res.status,
      headers: {},
      body: "",
      bodyBytes: new Uint8Array(),
      isSuccess: false,
    };
  }

  const data = await res.json();
  const bodyStr = data.body || "";
  const bodyBytes = data.bodyBase64
    ? Uint8Array.from(atob(data.bodyBase64), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(bodyStr);

  return {
    url,
    statusCode: data.statusCode || 200,
    headers: data.headers || {},
    body: bodyStr,
    bodyBytes,
    isSuccess: (data.statusCode || 200) >= 200 && (data.statusCode || 200) < 300,
  };
}

/** Default User-Agent (Chrome 149 desktop — matches the Android app) */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
