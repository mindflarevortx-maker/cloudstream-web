/**
 * CloudStream Web — Sync API abstraction
 *
 * Ported (in spirit) from `library/.../syncproviders/SyncAPI.kt` and
 * `AccountManager.kt`. On Android the list of sync providers is hardcoded
 * into AccountManager (see worklog Task F1, line ~24385) — extensions
 * cannot register new sync providers, only the in-tree ones (MAL, AniList,
 * Kitsu, Simkl, LocalList). The same restriction applies here: we ship a
 * fixed set of SyncAPI implementations and the user authenticates them
 * from the (future) Settings screen.
 *
 * The SyncPanel on the Result page reads from `SyncRegistry.getLoggedIn()`
 * and renders one card per logged-in provider. Each card lets the user
 * set: status (Watching/Completed/...), watched-episode count, and score.
 *
 * For now we ship a single LocalListSyncAPI — a localStorage-backed list
 * that's always "logged in". AniList/MAL are stubbed as TODOs.
 */

import type { AbstractSyncStatus } from "@/lib/cloudstream/types";
import { SyncIdName } from "@/lib/cloudstream/types";

/**
 * The five user-facing statuses. Matches the Android
 * `SyncStatus` enum from `syncproviders/SyncAPI.kt`.
 */
export type SyncStatus =
  | "Watching"
  | "Completed"
  | "Planned"
  | "Dropped"
  | "Paused"
  | "None";

export const SYNC_STATUS_OPTIONS: SyncStatus[] = [
  "Watching",
  "Completed",
  "Planned",
  "Paused",
  "Dropped",
];

/**
 * SyncAPI — abstract base class for sync providers.
 *
 * `id` is the SyncIdName enum value used to look this provider up in
 * `LoadResponse.syncData` (which maps SyncIdName → provider-specific id).
 */
export abstract class SyncAPI {
  abstract name: string;
  abstract id: SyncIdName;
  /** Optional icon URL (used by the SyncPanel). */
  abstract iconUrl?: string;
  /** Whether the user has authenticated with this provider. */
  loggedIn: boolean = false;

  /** Read the user's current watch status for this title. */
  abstract status(syncId: string): Promise<AbstractSyncStatus | null>;

  /**
   * Update the user's watch status for this title.
   * Returns true on success, false on failure.
   */
  abstract updateStatus(
    syncId: string,
    patch: Partial<AbstractSyncStatus>
  ): Promise<boolean>;

  /** Set the user's score (0-10). Returns true on success. */
  abstract score(syncId: string, score: number): Promise<boolean>;
}

/**
 * SyncRegistry — the global registry of sync providers.
 * Mirrors Android's `AccountManager.syncApis` array (but mutable from
 * settings — the user can enable/disable providers at runtime).
 */
export class SyncRegistry {
  private static providers: SyncAPI[] = [];

  static register(provider: SyncAPI): void {
    if (this.providers.some((p) => p.id === provider.id)) {
      console.warn(`[SyncRegistry] Overwriting provider: ${provider.name}`);
      this.providers = this.providers.filter((p) => p.id !== provider.id);
    }
    this.providers.push(provider);
  }

  static getAll(): SyncAPI[] {
    return [...this.providers];
  }

  static getLoggedIn(): SyncAPI[] {
    return this.providers.filter((p) => p.loggedIn);
  }

  static getById(id: SyncIdName): SyncAPI | null {
    return this.providers.find((p) => p.id === id) || null;
  }

  static getByName(name: string): SyncAPI | null {
    return this.providers.find((p) => p.name === name) || null;
  }
}

// ---------------------------------------------------------------------------
// LocalListSyncAPI — a localStorage-backed sync provider, always "logged in".
// Mirrors the Android `LocalListApi` (the in-app library that doesn't require
// any external account).
// ---------------------------------------------------------------------------

const LOCAL_STORAGE_KEY = "cloudstream-web-local-sync";

interface LocalStore {
  [syncId: string]: AbstractSyncStatus;
}

function readLocalStore(): LocalStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalStore) : {};
  } catch {
    return {};
  }
}

function writeLocalStore(store: LocalStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("[LocalListSyncAPI] failed to write localStorage:", e);
  }
}

class LocalListSyncAPI extends SyncAPI {
  name = "Local List";
  id = SyncIdName.LocalList;
  iconUrl = undefined;
  loggedIn = true; // always logged in — it's the user's local list

  async status(syncId: string): Promise<AbstractSyncStatus | null> {
    const store = readLocalStore();
    return store[syncId] ?? null;
  }

  async updateStatus(
    syncId: string,
    patch: Partial<AbstractSyncStatus>
  ): Promise<boolean> {
    const store = readLocalStore();
    const existing = store[syncId] ?? {};
    store[syncId] = { ...existing, ...patch };
    writeLocalStore(store);
    return true;
  }

  async score(syncId: string, score: number): Promise<boolean> {
    return this.updateStatus(syncId, { score });
  }
}

// Auto-register the local list provider at import time.
SyncRegistry.register(new LocalListSyncAPI());

/**
 * Resolve the sync ID for a given provider on a given LoadResponse.
 *
 * LoadResponse.syncData maps SyncIdName → provider-specific id (e.g.
 *   syncData = { "Anilist": "12345", "MyAnimeList": "67890" }
 * ). For LocalList there's usually no entry, so we fall back to the
 * LoadResponse.url — that's a stable identifier the user can re-find.
 */
export function resolveSyncId(
  syncData: Record<string, string> | undefined,
  providerId: SyncIdName,
  fallbackUrl: string
): string {
  if (!syncData) return fallbackUrl;
  return syncData[providerId] ?? syncData[String(providerId)] ?? fallbackUrl;
}
