/**
 * CloudStream Web — RepositoryManager
 *
 * Fetches `repo.json` + `plugins.json` from user-added repositories,
 * tracks installed plugins, persists everything to `localStorage`, and
 * bridges into the `JsProvider` loader so installed plugins get
 * registered with `APIHolder`.
 *
 * This is the **Option D** repository manager from
 * `EXTENSION_LOADER_DESIGN.md` §7–8. It is intentionally separate from
 * the legacy `store/repository-store.ts` (which uses Zustand and the
 * class-based `loader.ts`) — the two coexist, but new code should use
 * this module.
 *
 * Persistence layout (all under the `cloudstream:` namespace):
 *
 *   localStorage["cloudstream:repos"]       → Repository[]
 *   localStorage["cloudstream:installed"]   → InstalledPlugin[]
 *
 * The `localStorage` keys are versioned by the `STORAGE_VERSION`
 * constant — bumping it triggers a clean re-fetch on next boot.
 *
 * Repository format (web — see §8):
 *
 *   repo.json:
 *     {
 *       "name": "My Web Repo",
 *       "description": "...",
 *       "manifestVersion": 1,
 *       "pluginLists": ["https://example.com/plugins.json"]
 *     }
 *
 *   plugins.json:
 *     [{
 *       "name": "MyProvider",
 *       "internalName": "myprovider",
 *       "version": 1,
 *       "description": "...",
 *       "authors": ["me"],
 *       "language": "en",
 *       "tvTypes": ["Movie"],
 *       "url": "https://example.com/providers/myprovider.js",
 *       "iconUrl": "https://example.com/icon.png",
 *       "fileHash": "sha256-...",   // optional, enforced if present
 *       "status": 1
 *     }]
 */

import { createHttpClient } from "../http";
import { loadProviderFromUrl, unloadProvider } from "./JsProvider";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** The shape of a repo.json file. */
export interface RepoJson {
  name?: string;
  description?: string;
  iconUrl?: string;
  manifestVersion?: number;
  pluginLists?: string[];
}

/** One entry in a plugins.json array. */
export interface PluginEntry {
  name: string;
  internalName: string;
  version: number;
  description?: string;
  authors?: string[];
  language?: string;
  tvTypes?: string[];
  url: string; // Must end in `.js` for web (see §8.3)
  iconUrl?: string;
  fileHash?: string; // `sha256-<hex>` — enforced if present
  status?: number; // 0=down, 1=ok, 2=slow, 3=beta
  apiVersion?: number;
  repositoryUrl?: string;
  fileSize?: number;
}

/** A repository the user has added. */
export interface Repository {
  url: string; // The repo.json URL
  name: string;
  description?: string;
  iconUrl?: string;
  manifestVersion: number;
  plugins: PluginEntry[];
  addedAt: number;
}

/** An installed plugin — metadata only; the live instance is in APIHolder. */
export interface InstalledPlugin {
  internalName: string;
  name: string; // The provider name registered in APIHolder
  version: number;
  description?: string;
  authors?: string[];
  language?: string;
  tvTypes: string[];
  iconUrl?: string;
  repoUrl: string; // The repo.json URL the plugin came from
  sourceUrl: string; // The .js URL
  fileHash?: string;
  enabled: boolean;
  installedAt: number;
}

/** Result of an add-repo or install-plugin operation. */
export interface OpResult {
  ok: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const REPOS_KEY = "cloudstream:repos";
const INSTALLED_KEY = "cloudstream:installed";
const STORAGE_VERSION = 1;
const VERSION_KEY = "cloudstream:storage-version";

/* ------------------------------------------------------------------ */
/*  localStorage helpers (SSR-safe)                                    */
/* ------------------------------------------------------------------ */

function lsAvailable(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readJSON<T>(key: string, fallback: T): T {
  if (!lsAvailable()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T): void {
  if (!lsAvailable()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[RepositoryManager] failed to persist ${key}:`, e);
  }
}

/* ------------------------------------------------------------------ */
/*  URL helpers                                                        */
/* ------------------------------------------------------------------ */

/** Strip `cloudstreamrepo://` and similar scheme prefixes used by Android. */
export function normalizeRepoUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("cloudstreamrepo://")) {
    return "https://" + trimmed.slice("cloudstreamrepo://".length);
  }
  return trimmed;
}

/**
 * Resolve a possibly-relative URL against a repo.json's location. Mirrors
 * how a browser would resolve a relative `<a href>` on a page fetched
 * from `repoUrl`. So if `repoUrl` is
 *   https://example.com/foo/repo.json
 * and `relative` is `plugins.json`, the result is
 *   https://example.com/foo/plugins.json
 */
export function resolveUrl(repoUrl: string, relative: string): string {
  if (!relative) return relative;
  if (/^https?:\/\//i.test(relative)) return relative;
  try {
    return new URL(relative, repoUrl).toString();
  } catch {
    return relative;
  }
}

/* ------------------------------------------------------------------ */
/*  Network fetch (via the CORS proxy)                                 */
/* ------------------------------------------------------------------ */

async function fetchText(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  const client = createHttpClient();
  const res = await client.get(url, {
    Accept: "application/json, text/plain, */*",
    ...headers,
  });
  return { status: res.statusCode, body: res.body ?? "" };
}

async function fetchJson<T>(url: string): Promise<T> {
  const { status, body } = await fetchText(url);
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} fetching ${url}`);
  }
  if (!body) throw new Error(`Empty response fetching ${url}`);
  try {
    return JSON.parse(body) as T;
  } catch (e) {
    throw new Error(
      `Invalid JSON at ${url}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/* ------------------------------------------------------------------ */
/*  SHA-256 hash verification (optional)                               */
/* ------------------------------------------------------------------ */

/**
 * Compute the SHA-256 hash of a string and return it as
 * `"sha256-<hex>"`. Uses the browser's `crypto.subtle`. If the SubtleCrypto
 * API isn't available (SSR, insecure context), returns null and the
 * caller skips verification.
 */
async function sha256Hex(input: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const bytes = new TextEncoder().encode(input);
    const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    const hex = hashArr
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sha256-${hex}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  RepositoryManager — singleton-style module API                     */
/* ------------------------------------------------------------------ */

/**
 * Migration: if the storage version doesn't match `STORAGE_VERSION`,
 * clear the keys. This is a coarse "blow away and re-fetch" strategy
 * suitable for the development phase.
 */
function migrateIfNeeded(): void {
  if (!lsAvailable()) return;
  const storedVersion = Number(localStorage.getItem(VERSION_KEY) ?? "0");
  if (storedVersion !== STORAGE_VERSION) {
    localStorage.removeItem(REPOS_KEY);
    localStorage.removeItem(INSTALLED_KEY);
    localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION));
  }
}

/**
 * Add a repository by URL.
 *
 * Flow (mirrors `EXTENSION_LOADER_DESIGN.md` §7):
 *   1. Normalize the URL (strip `cloudstreamrepo://`).
 *   2. Fetch repo.json.
 *   3. For each `pluginLists[i]`, fetch the plugins.json.
 *   4. Filter to entries whose `url` ends in `.js` (skip `.cs3`).
 *   5. Persist to localStorage.
 */
export async function addRepository(rawUrl: string): Promise<OpResult> {
  migrateIfNeeded();

  const url = normalizeRepoUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      error: "Repository URL must start with http:// or https://",
    };
  }

  // Already added?
  const existing = getRepositories();
  if (existing.some((r) => r.url === url)) {
    return { ok: false, error: "Repository already added" };
  }

  // Fetch repo.json
  let repoJson: RepoJson;
  try {
    repoJson = await fetchJson<RepoJson>(url);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (!Array.isArray(repoJson.pluginLists) || repoJson.pluginLists.length === 0) {
    return {
      ok: false,
      error: "repo.json has no `pluginLists` array — cannot find plugins.json",
    };
  }

  // Fetch each plugin list (usually one — plugins.json).
  const plugins: PluginEntry[] = [];
  for (const listPath of repoJson.pluginLists) {
    const listUrl = resolveUrl(url, listPath);
    try {
      const entries = await fetchJson<PluginEntry[]>(listUrl);
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!e || typeof e !== "object") continue;
        if (!e.internalName || !e.name) continue;
        // Resolve the plugin .js URL relative to the plugins.json location.
        if (e.url) {
          e.url = resolveUrl(listUrl, e.url);
        }
        // Skip .cs3 entries — they can't run on web. Log so the user
        // sees *why* a provider didn't show up.
        if (e.url && /\.cs3(\?|$)/i.test(e.url)) {
          console.info(
            `[RepositoryManager] skipping Android-only plugin "${e.name}" (${e.url}) — web providers must be .js`
          );
          continue;
        }
        // Resolve iconUrl too.
        if (e.iconUrl) {
          e.iconUrl = resolveUrl(listUrl, e.iconUrl);
        }
        // Track which repo this came from.
        e.repositoryUrl = url;
        plugins.push(e);
      }
    } catch (e) {
      console.warn(
        `[RepositoryManager] could not fetch plugin list ${listUrl}:`,
        e
      );
    }
  }

  const repo: Repository = {
    url,
    name: repoJson.name || tryDeriveRepoName(url),
    description: repoJson.description,
    iconUrl: repoJson.iconUrl
      ? resolveUrl(url, repoJson.iconUrl)
      : undefined,
    manifestVersion: repoJson.manifestVersion ?? 1,
    plugins,
    addedAt: Date.now(),
  };

  const next = [...getRepositories(), repo];
  writeJSON(REPOS_KEY, next);
  return { ok: true };
}

/** Remove a repository and uninstall all plugins that came from it. */
export function removeRepository(url: string): OpResult {
  const repos = getRepositories();
  const target = repos.find((r) => r.url === url);
  if (!target) return { ok: false, error: "Repository not found" };

  // Uninstall every plugin that came from this repo.
  const installed = getInstalledPlugins();
  const toRemove = installed.filter((p) => p.repoUrl === url);
  for (const p of toRemove) {
    try {
      unloadProvider(p.name);
    } catch (e) {
      console.warn(`[RepositoryManager] unload ${p.name} failed:`, e);
    }
  }
  const remainingInstalled = installed.filter((p) => p.repoUrl !== url);
  const remainingRepos = repos.filter((r) => r.url !== url);

  writeJSON(REPOS_KEY, remainingRepos);
  writeJSON(INSTALLED_KEY, remainingInstalled);
  return { ok: true };
}

/**
 * Install a plugin from a repository.
 *
 * Flow (mirrors §7):
 *   1. Look up the plugin entry in the cached repositories.
 *   2. Fetch the .js source through the CORS proxy.
 *   3. (Optional) verify SHA-256 against `fileHash`.
 *   4. Evaluate the source via `loadProviderFromSource` (sandbox).
 *   5. Persist to localStorage.
 */
export async function installPlugin(
  repoUrl: string,
  internalName: string
): Promise<OpResult> {
  migrateIfNeeded();

  const repo = getRepositories().find((r) => r.url === repoUrl);
  if (!repo) return { ok: false, error: "Repository not found" };

  const entry = repo.plugins.find((p) => p.internalName === internalName);
  if (!entry) return { ok: false, error: "Plugin not found in repository" };
  if (!entry.url) {
    return {
      ok: false,
      error: "Plugin entry has no `url` field — cannot download .js source",
    };
  }
  if (/\.cs3(\?|$)/i.test(entry.url)) {
    return {
      ok: false,
      error:
        "This is an Android .cs3 plugin — it cannot run in the browser. Web providers must be .js files.",
    };
  }

  // Already installed? Uninstall the old version first.
  const existing = getInstalledPlugins().find(
    (p) => p.internalName === internalName
  );
  if (existing) {
    try {
      unloadProvider(existing.name);
    } catch {
      /* ignore */
    }
    writeJSON(
      INSTALLED_KEY,
      getInstalledPlugins().filter((p) => p.internalName !== internalName)
    );
  }

  // Fetch the .js source so we can hash-check it before eval.
  let source: string;
  try {
    const { status, body } = await fetchText(entry.url, {
      Accept: "application/javascript, text/javascript, */*",
    });
    if (status < 200 || status >= 300 || !body) {
      return {
        ok: false,
        error: `Failed to download plugin source (HTTP ${status})`,
      };
    }
    source = body;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Optional: verify SHA-256 hash pin.
  if (entry.fileHash) {
    const computed = await sha256Hex(source);
    if (computed && computed !== entry.fileHash) {
      return {
        ok: false,
        error: `Hash mismatch for "${entry.name}". Expected ${entry.fileHash}, got ${computed}. The plugin file may have been tampered with.`,
      };
    }
  }

  // Evaluate the source. `loadProviderFromSource` is synchronous, but we
  // wrap in dynamic-import-style for forward compatibility.
  const { loadProviderFromSource } = await import("./JsProvider");
  const result = loadProviderFromSource(source, entry.name);
  if (!result.success || !result.name) {
    return {
      ok: false,
      error: result.error || "Plugin failed to register a provider",
    };
  }

  // Persist.
  const installed: InstalledPlugin = {
    internalName: entry.internalName,
    name: result.name,
    version: entry.version,
    description: entry.description,
    authors: entry.authors,
    language: entry.language,
    tvTypes: entry.tvTypes ?? [],
    iconUrl: entry.iconUrl,
    repoUrl,
    sourceUrl: entry.url,
    fileHash: entry.fileHash,
    enabled: true,
    installedAt: Date.now(),
  };
  writeJSON(INSTALLED_KEY, [...getInstalledPlugins(), installed]);
  return { ok: true };
}

/** Uninstall a plugin by `internalName`. */
export function uninstallPlugin(internalName: string): OpResult {
  const installed = getInstalledPlugins();
  const target = installed.find((p) => p.internalName === internalName);
  if (!target) return { ok: false, error: "Plugin not installed" };
  try {
    unloadProvider(target.name);
  } catch (e) {
    console.warn(`[RepositoryManager] unload ${target.name} failed:`, e);
  }
  writeJSON(
    INSTALLED_KEY,
    installed.filter((p) => p.internalName !== internalName)
  );
  return { ok: true };
}

/** Toggle a plugin's enabled flag (does NOT unload — that's a separate op). */
export function setPluginEnabled(
  internalName: string,
  enabled: boolean
): OpResult {
  const installed = getInstalledPlugins();
  const target = installed.find((p) => p.internalName === internalName);
  if (!target) return { ok: false, error: "Plugin not installed" };
  writeJSON(
    INSTALLED_KEY,
    installed.map((p) =>
      p.internalName === internalName ? { ...p, enabled } : p
    )
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Synchronous selectors                                              */
/* ------------------------------------------------------------------ */

export function getRepositories(): Repository[] {
  if (!lsAvailable()) return [];
  migrateIfNeeded();
  return readJSON<Repository[]>(REPOS_KEY, []);
}

export function getInstalledPlugins(): InstalledPlugin[] {
  if (!lsAvailable()) return [];
  migrateIfNeeded();
  return readJSON<InstalledPlugin[]>(INSTALLED_KEY, []);
}

export function getRepositoryPlugins(url: string): PluginEntry[] {
  return getRepositories().find((r) => r.url === url)?.plugins ?? [];
}

export function isPluginInstalled(internalName: string): boolean {
  return getInstalledPlugins().some((p) => p.internalName === internalName);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function tryDeriveRepoName(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (seg) {
      const noExt = seg.replace(/\.(json|json5)$/i, "");
      return noExt.charAt(0).toUpperCase() + noExt.slice(1);
    }
    return u.hostname;
  } catch {
    return url;
  }
}
