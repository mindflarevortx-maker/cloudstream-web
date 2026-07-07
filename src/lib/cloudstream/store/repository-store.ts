/**
 * CloudStream Web — Repository + Installed Plugin Store (Zustand + persist)
 *
 * Mirrors the Android `RepositoryModule` + `InstalledPluginModule` state.
 * On Android, repos live in `settings.xml` and installed plugins are tracked
 * by the `PackageManager`-backed plugin database. On web we persist both to
 * localStorage via Zustand `persist`, and the actual provider instances live
 * in the in-memory `APIHolder` registry (mirroring Android's APIHolder).
 *
 * Repo format (web):
 *   {
 *     "name": "Example Repo",
 *     "description": "...",
 *     "authors": ["..."],
 *     "manifestVersion": 1,
 *     "pluginLists": ["plugins.json"]   // relative or absolute URLs
 *   }
 *
 * plugins.json format (array of plugin entries):
 *   [{
 *     "internalName": "ExampleProvider",
 *     "name": "Example Provider",
 *     "version": 1, "versionCode": 1,
 *     "description": "...",
 *     "authors": ["..."],
 *     "language": "en",
 *     "tvTypes": ["Movie", "TvSeries"],
 *     "iconUrl": "https://.../icon.png",
 *     "file": "provider.js",            // relative to repo base
 *     "url":  "https://.../provider.js" // OR absolute (preferred)
 *   }]
 *
 * `cloudstreamrepo://` URLs are also accepted — they're stripped and the
 * remainder is treated as the repo.json URL (the Android app does the same).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { APIHolder } from "../MainAPI";
import { createHttpClient } from "../http";
import { loadPluginFromUrl, unloadPlugin } from "../loader";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A single plugin entry as listed in a repository's plugins.json. */
export interface PluginEntry {
  internalName: string;
  name: string;
  version: number;
  versionCode?: number;
  versionName?: string;
  description?: string;
  authors?: string[];
  language?: string;
  tvTypes?: string[];
  iconUrl?: string;
  /** Relative path to the .js file (resolved against repo base URL). */
  file?: string;
  /** Absolute URL to the .js file (preferred over `file`). */
  url?: string;
  api?: number;
  size?: number;
}

/** A repository the user has added. */
export interface Repository {
  url: string;
  name: string;
  description?: string;
  authors?: string[];
  plugins: PluginEntry[];
  addedAt: number;
}

/** An installed plugin — tracks both the persisted metadata and the live
 *  enable/disable flag. The actual provider instance lives in APIHolder. */
export interface InstalledPlugin {
  name: string;
  internalName: string;
  version: number;
  versionName?: string;
  repoUrl: string;
  enabled: boolean;
  iconUrl?: string;
  description?: string;
  language?: string;
  tvTypes: string[];
  installedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Strip the `cloudstreamrepo://` scheme prefix used by some Android repos. */
function normalizeRepoUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("cloudstreamrepo://")) {
    return "https://" + trimmed.slice("cloudstreamrepo://".length);
  }
  return trimmed;
}

/** Resolve a relative `file` path against a repo.json's base URL. */
function resolveFileUrl(repoUrl: string, file?: string): string | null {
  if (!file) return null;
  if (/^https?:\/\//i.test(file)) return file;
  try {
    const base = new URL(repoUrl);
    // Strip the repo.json filename so relative paths resolve to the repo dir.
    const dir = base.pathname.replace(/\/[^/]*$/, "/");
    return new URL(file, base.origin + dir).toString();
  } catch {
    return null;
  }
}

/** Fetch JSON through the CORS proxy. Throws on failure. */
async function fetchJson<T>(url: string): Promise<T> {
  const client = createHttpClient();
  const res = await client.get(url, {
    Accept: "application/json, text/plain, */*",
  });
  if (!res.isSuccess || !res.body) {
    throw new Error(`HTTP ${res.statusCode} fetching ${url}`);
  }
  try {
    return JSON.parse(res.body) as T;
  } catch (e) {
    throw new Error(
      `Invalid JSON at ${url}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

interface RepoJson {
  name?: string;
  description?: string;
  authors?: string[];
  manifestVersion?: number;
  pluginLists?: string[];
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

interface RepositoryState {
  repositories: Repository[];
  installedPlugins: InstalledPlugin[];

  // Async actions
  addRepository: (url: string) => Promise<{ ok: boolean; error?: string }>;
  removeRepository: (url: string) => void;
  installPlugin: (
    repoUrl: string,
    pluginInternalName: string
  ) => Promise<{ ok: boolean; error?: string }>;
  uninstallPlugin: (internalName: string) => void;
  togglePluginEnabled: (internalName: string, enabled: boolean) => void;

  // Sync selectors
  isPluginInstalled: (internalName: string) => boolean;
  getRepositoryPlugins: (url: string) => PluginEntry[];

  // Internal
  _setRepositories: (updater: (prev: Repository[]) => Repository[]) => void;
  _setInstalled: (updater: (prev: InstalledPlugin[]) => InstalledPlugin[]) => void;
}

export const useRepositoryStore = create<RepositoryState>()(
  persist(
    (set, get) => ({
      repositories: [],
      installedPlugins: [],

      _setRepositories: (updater) =>
        set((s) => ({ repositories: updater(s.repositories) })),
      _setInstalled: (updater) =>
        set((s) => ({ installedPlugins: updater(s.installedPlugins) })),

      /* ---------------------------------------------------------- */
      /*  addRepository                                             */
      /* ---------------------------------------------------------- */
      addRepository: async (rawUrl) => {
        const url = normalizeRepoUrl(rawUrl);
        if (!/^https?:\/\//i.test(url)) {
          return {
            ok: false,
            error: "Repository URL must start with http:// or https://",
          };
        }
        if (get().repositories.some((r) => r.url === url)) {
          return { ok: false, error: "Repository already added" };
        }

        let repoJson: RepoJson;
        try {
          repoJson = await fetchJson<RepoJson>(url);
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }

        // Fetch each plugin list (usually one — plugins.json).
        const listUrls = (repoJson.pluginLists ?? []).map((p) => {
          if (/^https?:\/\//i.test(p)) return p;
          // Resolve relative to repo base dir.
          try {
            const base = new URL(url);
            const dir = base.pathname.replace(/\/[^/]*$/, "/");
            return new URL(p, base.origin + dir).toString();
          } catch {
            return p;
          }
        });

        const plugins: PluginEntry[] = [];
        for (const listUrl of listUrls) {
          try {
            const entries = await fetchJson<PluginEntry[]>(listUrl);
            if (Array.isArray(entries)) {
              for (const e of entries) {
                if (e && e.internalName) {
                  // Make sure each entry has a usable .js URL.
                  if (!e.url && e.file) {
                    const resolved = resolveFileUrl(url, e.file);
                    if (resolved) e.url = resolved;
                  }
                  // Fallback: derive a provider.js URL from internalName.
                  if (!e.url && !e.file) {
                    const derived = resolveFileUrl(url, `${e.internalName}.js`);
                    if (derived) e.url = derived;
                  }
                  plugins.push(e);
                }
              }
            }
          } catch (e) {
            console.warn(
              `[repository-store] could not fetch plugin list ${listUrl}:`,
              e
            );
          }
        }

        const repo: Repository = {
          url,
          name: repoJson.name || tryDeriveName(url),
          description: repoJson.description,
          authors: repoJson.authors,
          plugins,
          addedAt: Date.now(),
        };

        get()._setRepositories((prev) => [...prev, repo]);
        return { ok: true };
      },

      /* ---------------------------------------------------------- */
      /*  removeRepository                                          */
      /* ---------------------------------------------------------- */
      removeRepository: (url) => {
        // Uninstall every plugin that came from this repo.
        const toRemove = get().installedPlugins.filter((p) => p.repoUrl === url);
        for (const p of toRemove) {
          try {
            unloadPlugin(p.name);
          } catch (e) {
            console.warn(`[repository-store] unload ${p.name} failed:`, e);
          }
        }
        set((s) => ({
          repositories: s.repositories.filter((r) => r.url !== url),
          installedPlugins: s.installedPlugins.filter((p) => p.repoUrl !== url),
        }));
      },

      /* ---------------------------------------------------------- */
      /*  installPlugin                                             */
      /* ---------------------------------------------------------- */
      installPlugin: async (repoUrl, pluginInternalName) => {
        const repo = get().repositories.find((r) => r.url === repoUrl);
        if (!repo) return { ok: false, error: "Repository not found" };

        const entry = repo.plugins.find(
          (p) => p.internalName === pluginInternalName
        );
        if (!entry) return { ok: false, error: "Plugin not found in repo" };
        if (!entry.url) {
          return {
            ok: false,
            error: "Plugin has no downloadable .js URL (missing `url`/`file` field)",
          };
        }

        // Already installed? Refresh by uninstalling first.
        const existing = get().installedPlugins.find(
          (p) => p.internalName === pluginInternalName
        );
        if (existing) {
          try {
            unloadPlugin(existing.name);
          } catch {
            /* ignore */
          }
          get()._setInstalled((prev) =>
            prev.filter((p) => p.internalName !== pluginInternalName)
          );
        }

        const result = await loadPluginFromUrl(entry.url, entry.name);
        if (!result.success || !result.name) {
          return {
            ok: false,
            error: result.error || "Plugin failed to register a provider",
          };
        }

        const installed: InstalledPlugin = {
          name: result.name,
          internalName: entry.internalName,
          version: entry.version,
          versionName: entry.versionName,
          repoUrl,
          enabled: true,
          iconUrl: entry.iconUrl,
          description: entry.description,
          language: entry.language,
          tvTypes: entry.tvTypes ?? [],
          installedAt: Date.now(),
        };

        get()._setInstalled((prev) => [...prev, installed]);
        return { ok: true };
      },

      /* ---------------------------------------------------------- */
      /*  uninstallPlugin                                           */
      /* ---------------------------------------------------------- */
      uninstallPlugin: (internalName) => {
        const plugin = get().installedPlugins.find(
          (p) => p.internalName === internalName
        );
        if (!plugin) return;
        try {
          unloadPlugin(plugin.name);
        } catch (e) {
          console.warn(`[repository-store] unload ${plugin.name} failed:`, e);
        }
        get()._setInstalled((prev) =>
          prev.filter((p) => p.internalName !== internalName)
        );
      },

      /* ---------------------------------------------------------- */
      /*  togglePluginEnabled                                       */
      /* ---------------------------------------------------------- */
      togglePluginEnabled: (internalName, enabled) => {
        get()._setInstalled((prev) =>
          prev.map((p) =>
            p.internalName === internalName ? { ...p, enabled } : p
          )
        );
      },

      /* ---------------------------------------------------------- */
      /*  Selectors                                                 */
      /* ---------------------------------------------------------- */
      isPluginInstalled: (internalName) =>
        get().installedPlugins.some((p) => p.internalName === internalName),

      getRepositoryPlugins: (url) => {
        const repo = get().repositories.find((r) => r.url === url);
        return repo?.plugins ?? [];
      },
    }),
    {
      name: "cloudstream-repository-store",
      // Persist only the metadata — the live MainAPI instances live in
      // APIHolder (in-memory) and are re-registered on plugin install.
      partialize: (s) => ({
        repositories: s.repositories,
        installedPlugins: s.installedPlugins,
      }),
    }
  )
);

/* ------------------------------------------------------------------ */
/*  Pure helpers (not exported as store methods)                       */
/* ------------------------------------------------------------------ */

function tryDeriveName(url: string): string {
  try {
    const u = new URL(url);
    // Use the last path segment without extension, falling back to host.
    const seg = u.pathname
      .split("/")
      .filter(Boolean)
      .pop();
    if (seg) {
      const noExt = seg.replace(/\.(json|json5)$/i, "");
      return noExt.charAt(0).toUpperCase() + noExt.slice(1);
    }
    return u.hostname;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/*  Re-hydrate live providers after a page reload                      */
/* ------------------------------------------------------------------ */
//
// On a cold start, the persisted `installedPlugins` list is restored from
// localStorage, but the live MainAPI instances aren't in APIHolder anymore
// (they were in-memory). We can't re-evaluate plugin source without the .js
// URL — but every InstalledPlugin knows its `repoUrl` + `internalName`, so
// we can look up the entry in the persisted repositories and re-install
// automatically. This runs once on first store access in the browser.
//
if (typeof window !== "undefined") {
  // Defer to next tick so the store is fully hydrated before we re-install.
  queueMicrotask(() => {
    try {
      const state = useRepositoryStore.getState();
      if (state.installedPlugins.length === 0) return;
      // Re-install any plugin whose provider isn't currently in APIHolder.
      // We do this serially to avoid hammering the proxy.
      void (async () => {
        for (const ip of state.installedPlugins) {
          const alreadyLive = APIHolder.getApiByName(ip.name);
          if (alreadyLive) continue;
          const repo = state.repositories.find((r) => r.url === ip.repoUrl);
          if (!repo) continue;
          const entry = repo.plugins.find(
            (p) => p.internalName === ip.internalName
          );
          if (!entry?.url) continue;
          try {
            // Re-load the plugin source — but DON'T add a duplicate
            // InstalledPlugin entry; just register the provider.
            await loadPluginFromUrl(entry.url, ip.name);
          } catch (e) {
            console.warn(
              `[repository-store] failed to re-hydrate ${ip.name}:`,
              e
            );
          }
        }
      })();
    } catch {
      /* ignore — non-critical */
    }
  });
}
