/**
 * CloudStream Web — Runtime Extension Loader (entry point)
 *
 * This module is the public entry point for the runtime JS provider
 * loader. It re-exports the `cs3` runtime, the `JsProvider` evaluator,
 * and the `RepositoryManager`, and provides `initUserRepositories()` —
 * the function called at app boot to re-hydrate installed plugins after
 * a page reload.
 *
 * Usage from app boot:
 *
 *   import { initUserRepositories } from "@/lib/cloudstream/loader";
 *   useEffect(() => { initUserRepositories(); }, []);
 *
 * Usage from the Settings → Repositories UI:
 *
 *   import {
 *     addRepository,
 *     installPlugin,
 *     getRepositories,
 *     getInstalledPlugins,
 *   } from "@/lib/cloudstream/loader";
 *
 * See `EXTENSION_LOADER_DESIGN.md` for the full design rationale.
 */

import { APIHolder } from "../MainAPI";
import {
  getInstalledPlugins,
  getRepositories,
  type InstalledPlugin,
  type Repository,
  type PluginEntry,
} from "./RepositoryManager";
import { loadProviderFromUrl } from "./JsProvider";

/* ------------------------------------------------------------------ */
/*  Re-exports — single import surface for callers                     */
/* ------------------------------------------------------------------ */

export type {
  Cs3Runtime,
  Cs3FetchOptions,
  Cs3FetchResponse,
  Cs3Element,
  Cs3Document,
  Cs3ExtractorLinkOptions,
} from "./runtime";
export { createCs3Runtime } from "./runtime";

export type {
  JsProviderObject,
  JsProviderLoadResult,
} from "./JsProvider";
export {
  JsProviderAdapter,
  loadProviderFromSource,
  loadProviderFromUrl,
  unloadProvider,
  evaluateProviderSource,
  validateProviderObject,
} from "./JsProvider";

export type {
  RepoJson,
  PluginEntry,
  Repository,
  InstalledPlugin,
  OpResult,
} from "./RepositoryManager";
export {
  addRepository,
  removeRepository,
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  getRepositories,
  getInstalledPlugins,
  getRepositoryPlugins,
  isPluginInstalled,
  normalizeRepoUrl,
  resolveUrl,
} from "./RepositoryManager";

/* ------------------------------------------------------------------ */
/*  initUserRepositories — app-boot re-hydration                       */
/* ------------------------------------------------------------------ */

let initPromise: Promise<void> | null = null;
let initDone = false;

/**
 * Re-hydrate all installed plugins after a page reload.
 *
 * On a cold start, the persisted `installedPlugins` list is restored
 * from localStorage, but the live `MainAPI` instances are gone (they
 * were in-memory). This function re-fetches each plugin's `.js` source,
 * re-evaluates it via `loadProviderFromUrl`, and re-registers the
 * provider with `APIHolder`.
 *
 * Idempotent: calling it more than once is a no-op (subsequent calls
 * return the cached promise). Safe to call from React `useEffect` with
 * an empty dependency array.
 *
 * Errors during re-hydration are logged but don't reject the promise —
 * a single broken plugin shouldn't prevent the others from loading.
 */
export function initUserRepositories(): Promise<void> {
  if (initDone) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (typeof window === "undefined") {
      // SSR — nothing to do; re-hydration runs in the browser only.
      return;
    }

    const installed = getInstalledPlugins();
    if (installed.length === 0) {
      initDone = true;
      return;
    }

    // Re-install serially to avoid hammering the proxy with parallel
    // fetches for every installed plugin at boot. A misbehaving host
    // would otherwise cause a thundering-herd on every page load.
    for (const ip of installed) {
      // Already live? Skip (can happen if init runs twice in dev).
      if (APIHolder.getApiByName(ip.name)) continue;

      try {
        const result = await loadProviderFromUrl(ip.sourceUrl, ip.name);
        if (!result.success) {
          console.warn(
            `[initUserRepositories] failed to re-hydrate "${ip.name}":`,
            result.error
          );
        }
      } catch (e) {
        console.warn(
          `[initUserRepositories] exception re-hydrating "${ip.name}":`,
          e
        );
      }
    }
    initDone = true;
  })();

  return initPromise;
}

/**
 * Force a re-init on next call. Useful for tests or for "Refresh all
 * plugins" UI actions.
 */
export function resetUserRepositoriesInit(): void {
  initDone = false;
  initPromise = null;
}

/* ------------------------------------------------------------------ */
/*  Diagnostics                                                        */
/* ------------------------------------------------------------------ */

export interface LoaderDiagnostics {
  repositories: Repository[];
  installedPlugins: InstalledPlugin[];
  liveProviderCount: number;
  initDone: boolean;
}

/** Snapshot of the loader's current state — useful for the Settings UI. */
export function getLoaderDiagnostics(): LoaderDiagnostics {
  return {
    repositories: getRepositories(),
    installedPlugins: getInstalledPlugins(),
    liveProviderCount: APIHolder.getAllProviders().length,
    initDone,
  };
}
