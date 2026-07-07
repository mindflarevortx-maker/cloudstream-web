/**
 * CloudStream Web — SyncManager
 *
 * Singleton-style registry of all sync providers. Mirrors the role of
 * `AccountManager` (syncApis subset) in the Kotlin source — but on web there's
 * no separate AuthRepo/SyncRepo wrapper layer; providers manage their own
 * auth state and the SyncManager just exposes a flat list.
 *
 * Registration policy (see task spec):
 *   - LocalList: always registered (no login required).
 *   - AniList / MAL: registered on demand — when the user pastes a client_id
 *     into settings, the matching provider is auto-registered so the rest of
 *     the app can discover it via `getEnabledSyncs()` / `getAllSyncs()`.
 *
 * See worklog Task ID D8 §3 (AccountManager) for the Kotlin equivalent.
 */

import { SyncAPI } from "./SyncAPI";
import { LocalList } from "./LocalList";
import { AniListApi, ANILIST_CLIENT_ID } from "./AniListApi";
import { MALApi, MAL_CLIENT_ID } from "./MALApi";

export { SyncAPI } from "./SyncAPI";
export { LocalList } from "./LocalList";
export { AniListApi, ANILIST_CLIENT_ID } from "./AniListApi";
export { MALApi, MAL_CLIENT_ID } from "./MALApi";

class SyncManagerImpl {
  /** All registered providers, keyed by idPrefix for O(1) lookup. */
  private readonly providers = new Map<string, SyncAPI>();

  /** Singletons — we reuse the same instance across getEnabledSyncs/getAllSyncs. */
  private readonly localList = new LocalList();
  private readonly aniList = new AniListApi();
  private readonly mal = new MALApi();

  constructor() {
    // LocalList is always available.
    this.providers.set(this.localList.idPrefix, this.localList);
  }

  /**
   * All registered providers, in stable order: Local, AniList, MAL.
   * Unregistered OAuth2 providers (no client_id set) are excluded — they
   * can't be used until configured.
   */
  getAllSyncs(): SyncAPI[] {
    const out: SyncAPI[] = [this.localList];
    if (this.isAniListConfigured()) out.push(this.aniList);
    if (this.isMalConfigured()) out.push(this.mal);
    return out;
  }

  /**
   * Registered providers that the user is currently authenticated with.
   * For LocalList, this is always true (loginRequired=false). For AniList/MAL,
   * the user must have completed the OAuth2 flow.
   */
  getEnabledSyncs(): SyncAPI[] {
    return this.getAllSyncs().filter((p) => p.isLoggedIn());
  }

  /** Look up a provider by display name (case-insensitive). */
  getSyncByName(name: string): SyncAPI | null {
    const lower = name.toLowerCase();
    for (const p of this.getAllSyncs()) {
      if (p.name.toLowerCase() === lower) return p;
    }
    return null;
  }

  /** Look up a provider by idPrefix. */
  getSyncByPrefix(prefix: string): SyncAPI | null {
    return this.providers.get(prefix) ?? this.getAllSyncs().find((p) => p.idPrefix === prefix) ?? null;
  }

  // -- Direct accessors (for settings UI / OAuth2 callback shims) ----------

  getLocalList(): LocalList {
    return this.localList;
  }

  getAniList(): AniListApi {
    return this.aniList;
  }

  getMal(): MALApi {
    return this.mal;
  }

  // -- Configuration probes ------------------------------------------------

  /**
   * Returns true if the user has set a non-placeholder AniList client id.
   * (LocalList has no equivalent — it's always available.)
   */
  isAniListConfigured(): boolean {
    if (typeof window === "undefined") return false;
    const id = localStorage.getItem("cs3_anilist_client_id");
    return !!id && id !== ANILIST_CLIENT_ID;
  }

  /** Returns true if the user has set a non-placeholder MAL client id. */
  isMalConfigured(): boolean {
    if (typeof window === "undefined") return false;
    const id = localStorage.getItem("cs3_mal_client_id");
    return !!id && id !== MAL_CLIENT_ID;
  }
}

/**
 * Singleton instance. Always use this — never `new SyncManagerImpl()`.
 *
 * (On the server side during SSR the singleton is per-module; that's fine
 * because the manager is stateless apart from the per-provider instances,
 * which themselves are SSR-safe — they no-op when `typeof window === 'undefined'`.)
 */
export const SyncManager = new SyncManagerImpl();

export default SyncManager;
