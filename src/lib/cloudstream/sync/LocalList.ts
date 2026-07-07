/**
 * CloudStream Web — LocalList Sync Provider
 * Ported from app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/LocalList.kt
 *
 * The Kotlin LocalList exposes the app's DataStore-backed bookmark / watch-state
 * / favorites / subscriptions as a SyncAPI so the Library UI can treat local
 * and remote lists uniformly. The web port mirrors that contract but backs it
 * with localStorage instead of DataStore, since there's no equivalent of
 * DataStoreHelper on web.
 *
 * See worklog Task ID D8 §9 for the line-by-line Kotlin analysis.
 *
 * Differences from Kotlin:
 *   - All state lives in localStorage under `cs3_local_library` as a single
 *     JSON blob: `{ [id]: AbstractSyncStatus }`.
 *   - `updateStatus`, `status`, `load`, `search` are implemented (Kotlin
 *     inherits NotImplementedError defaults for these — we implement them so
 *     the local list can actually be mutated from the sync UI on web).
 *   - `library()` returns one big list (no per-status grouping) since the UI
 *     on web doesn't yet implement the multi-tab Library view.
 */

import { SyncAPI } from "./SyncAPI";
import type {
  AbstractSyncStatus,
  LibraryItem,
  LibraryMetadata,
} from "../types";

/** localStorage key for the local library blob. */
export const LOCAL_LIBRARY_KEY = "cs3_local_library";

/** Type of the persisted library: a map of id → status. */
type LocalLibraryMap = Record<string, AbstractSyncStatus & { title?: string; posterUrl?: string }>;

export class LocalList extends SyncAPI {
  get name(): string {
    return "Local";
  }

  get idPrefix(): string {
    return "local";
  }

  get loginRequired(): boolean {
    return false;
  }

  isLoggedIn(): boolean {
    return true; // Always logged in — no auth required.
  }

  // No-op login — LocalList doesn't authenticate.
  async login(_credentials?: any): Promise<boolean> {
    return true;
  }

  async logout(): Promise<void> {
    // Sign-out clears the local library. (The Kotlin version doesn't do this
    // because it doesn't own the data — DataStoreHelper does. On web we own
    // the data, so logout = wipe.)
    if (typeof window === "undefined") return;
    localStorage.removeItem(LOCAL_LIBRARY_KEY);
    this.requireLibraryRefresh = true;
  }

  // -- Persistence ---------------------------------------------------------

  private read(): LocalLibraryMap {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(LOCAL_LIBRARY_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as LocalLibraryMap;
    } catch {
      return {};
    }
  }

  private write(map: LocalLibraryMap): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn("[LocalList] Failed to persist library:", e);
    }
    this.requireLibraryRefresh = true;
  }

  // -- SyncAPI methods -----------------------------------------------------

  async updateStatus(id: string, newStatus: AbstractSyncStatus): Promise<boolean> {
    const internalId = this.stripPrefix(id);
    const map = this.read();
    const existing = map[internalId] ?? {};

    // If the new status is NONE and there's nothing else to keep, remove the
    // entry entirely (mirrors the AniList/MAL delete branch).
    if (
      (newStatus.status === "NONE" || newStatus.status === undefined) &&
      (newStatus.score === undefined || newStatus.score === null) &&
      (newStatus.watchedEpisodes === undefined || newStatus.watchedEpisodes === 0)
    ) {
      delete map[internalId];
      this.write(map);
      return true;
    }

    map[internalId] = {
      ...existing,
      ...newStatus,
    };
    this.write(map);
    return true;
  }

  async status(id: string): Promise<AbstractSyncStatus | null> {
    const internalId = this.stripPrefix(id);
    const map = this.read();
    const entry = map[internalId];
    if (!entry) return null;
    return {
      status: entry.status,
      score: entry.score,
      watchedEpisodes: entry.watchedEpisodes,
      isFavorite: entry.isFavorite,
      maxEpisodes: entry.maxEpisodes,
    };
  }

  async load(id: string): Promise<any> {
    const internalId = this.stripPrefix(id);
    const map = this.read();
    const entry = map[internalId];
    if (!entry) return null;
    return {
      id: `${this.idPrefix}${internalId}`,
      title: entry.title ?? "(unknown)",
      posterUrl: entry.posterUrl ?? null,
      totalEpisodes: entry.maxEpisodes ?? null,
      watchedEpisodes: entry.watchedEpisodes ?? 0,
      status: entry.status ?? "NONE",
      score: entry.score ?? null,
      isFavorite: entry.isFavorite ?? false,
    };
  }

  async search(query: string): Promise<LibraryItem[]> {
    // LocalList search = substring match across stored titles. There's no
    // remote service to search; we just walk what's already in localStorage.
    const map = this.read();
    const q = query.toLowerCase().trim();
    const items: LibraryItem[] = [];
    for (const [id, entry] of Object.entries(map)) {
      const title = entry.title ?? "(unknown)";
      if (!q || title.toLowerCase().includes(q)) {
        items.push(this.toLibraryItem(id, entry));
      }
    }
    return items;
  }

  async library(): Promise<LibraryMetadata> {
    const map = this.read();
    const items: LibraryItem[] = Object.entries(map).map(([id, entry]) =>
      this.toLibraryItem(id, entry),
    );
    this.requireLibraryRefresh = false;
    return { name: this.name, items };
  }

  // -- Helpers -------------------------------------------------------------

  private toLibraryItem(
    id: string,
    entry: AbstractSyncStatus & { title?: string; posterUrl?: string },
  ): LibraryItem {
    return {
      id: `${this.idPrefix}${id}`,
      title: entry.title ?? "(unknown)",
      posterUrl: entry.posterUrl,
      status: entry.status,
      score: entry.score,
      watchedEpisodes: entry.watchedEpisodes,
      maxEpisodes: entry.maxEpisodes,
    };
  }

  /** Strip the `local` prefix if present. */
  private stripPrefix(id: string): string {
    if (!id) return id;
    if (id.startsWith(this.idPrefix)) return id.slice(this.idPrefix.length);
    return id;
  }
}

export default LocalList;
