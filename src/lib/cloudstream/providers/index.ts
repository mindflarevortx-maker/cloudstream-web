/**
 * CloudStream Web — Provider Registry
 *
 * Mirrors the Android APIHolder seeding at app init. On Android the provider
 * list is hand-maintained (see worklog D2 §3, APIHolder.kt lines 973-1321);
 * on web we only register the handful that work without a JVM/JVM-only deps
 * (no NewPipeExtractor, no OkHttp interceptor, no WebView).
 *
 * Order DOES NOT matter for providers (unlike extractors) — getMainPage /
 * search dispatch to all enabled providers in parallel and merge results.
 * But we still register in a stable order for deterministic UI listing:
 *   1. InternetArchive  — public-domain movies / audio / texts / software
 *   2. Invidious        — YouTube frontend (REST API)
 *   3. IptvOrg          — public IPTV m3u channel index
 *
 * The initProviders() function is idempotent — calling it more than once is a
 * no-op. Safe to call from multiple entry points (app boot, page mount, etc.).
 *
 * Each provider gets the same shared HttpClient instance from createHttpClient(),
 * which routes through the server-side /api/proxy endpoint to bypass CORS.
 */

import { APIHolder, MainAPI } from "../MainAPI";
import { createHttpClient } from "../http";
import { InternetArchiveProvider } from "./InternetArchiveProvider";
import { InvidiousProvider } from "./InvidiousProvider";
import { IptvOrgProvider } from "./IptvOrgProvider";

let initialized = false;

/**
 * Register all built-in providers. Idempotent — safe to call from
 * multiple entry points (app boot, page mount, hot reload, etc.).
 *
 * Each provider is instantiated, injected with the shared HttpClient,
 * and registered with APIHolder.registerProvider(). If a provider with
 * the same name is already registered, APIHolder replaces it (so hot
 * reloads / re-calls don't accumulate duplicates).
 */
export function initProviders(): void {
  if (initialized) return;
  initialized = true;

  // Single shared HTTP client — all providers route through the same
  // /api/proxy endpoint. The proxy caches per-hostname cookies etc.
  const client = createHttpClient();

  // 1. Internet Archive — public-domain media library.
  const internetArchive = new InternetArchiveProvider();
  internetArchive.setClient(client);
  APIHolder.registerProvider(internetArchive);

  // 2. Invidious — YouTube frontend (REST API).
  const invidious = new InvidiousProvider();
  invidious.setClient(client);
  APIHolder.registerProvider(invidious);

  // 3. iptv-org — public IPTV m3u channel index.
  const iptvOrg = new IptvOrgProvider();
  iptvOrg.setClient(client);
  APIHolder.registerProvider(iptvOrg);
}

/**
 * Return all enabled providers. Per the task spec this returns
 * APIHolder.getAllProviders() (the APIHolder currently treats all
 * registered providers as enabled — there's no per-provider enable/disable
 * toggle yet).
 */
export function getEnabledProviders(): MainAPI[] {
  return APIHolder.getAllProviders();
}

// Re-export all provider classes for direct use / testing.
export { InternetArchiveProvider, InvidiousProvider, IptvOrgProvider };
// Re-export the registry + base class so callers don't need to know the
// internal layout of the cloudstream package.
export { APIHolder, MainAPI } from "../MainAPI";
