/**
 * CloudStream Web — SyncAPI Abstract Base Class
 * Ported from app/src/main/java/com/lagradost/cloudstream3/syncproviders/SyncAPI.kt
 *
 * A SyncAPI is a bidirectional watch-status / library synchronization provider.
 * The web port is simplified relative to the Kotlin original:
 *   - No `AuthData` / `AuthToken` plumbing (each provider manages its own credentials,
 *     typically in localStorage / cookies).
 *   - No `SyncRepo` wrapper (no auto-refresh layer; providers refresh their own tokens).
 *   - No `ListSorting` parameter on `library()` (sorting is the UI's responsibility).
 *
 * The contract mirrors the Kotlin class methods one-for-one so behaviour stays
 * recognisable to anyone porting an extension.
 *
 * See worklog Task ID D8 (lines ~2038+) for the line-by-line Kotlin analysis.
 */

import type {
  AbstractSyncStatus,
  LibraryItem,
  LibraryMetadata,
} from "../types";

/**
 * SyncAPI — abstract base class for all sync providers.
 *
 * Concrete implementations:
 *   - `LocalList`  — localStorage-backed, no login required.
 *   - `AniListApi` — AniList GraphQL, OAuth2 implicit flow.
 *   - `MALApi`     — MyAnimeList REST, OAuth2 PKCE flow.
 *
 * Each provider prefixes the IDs it emits with `idPrefix` so the UI can route
 * a syncData entry to the correct provider. E.g. `syncData["anilist"] = "12345"`
 * is consumed by AniListApi; `syncData["mal"] = "12345"` by MALApi.
 */
export abstract class SyncAPI {
  /** Display name (e.g. "AniList", "MAL", "Local"). */
  abstract get name(): string;

  /**
   * Prefix used in `LoadResponse.syncData` keys and in `LibraryItem.id`
   * (e.g. "anilist", "mal", "local"). Must be lowercase and unique across
   * the registered providers.
   */
  abstract get idPrefix(): string;

  /** Whether this provider requires login before use. LocalList = false. */
  abstract get loginRequired(): boolean;

  /** Whether the user is currently authenticated (or, for LocalList, always true). */
  abstract isLoggedIn(): boolean;

  /**
   * Begin the login flow. For OAuth2 providers this redirects the browser to
   * the provider's authorize URL and returns false (the page navigates away).
   * For in-app login providers (e.g. Kitsu password grant) this accepts
   * credentials and returns true on success.
   *
   * Returns true if the login completed synchronously (in-app flow), false if
   * the browser was redirected (OAuth2 flow) — the actual token arrives later
   * via the callback route.
   */
  abstract login(credentials?: any): Promise<boolean>;

  /** Sign out and clear any stored credentials. */
  abstract logout(): Promise<void>;

  /**
   * Push a new watch status to the service. Returns true on success.
   *
   * Mirrors Kotlin `updateStatus(auth, id, newStatus): Boolean`.
   *
   * The `status` field of `AbstractSyncStatus` is a string (one of the values
   * returned by `supportedWatchTypes`); `score` is a 0-10 float; `watchedEpisodes`
   * is an absolute episode count (NOT a delta); `isFavorite` toggles favourite
   * if the provider supports it.
   */
  abstract updateStatus(id: string, status: AbstractSyncStatus): Promise<boolean>;

  /**
   * Fetch the current watch status for one item, or null if it's not on the
   * user's list.
   *
   * Mirrors Kotlin `status(auth, id): AbstractSyncStatus?`.
   */
  abstract status(id: string): Promise<AbstractSyncStatus | null>;

  /**
   * Fetch rich metadata for one item (episodes, synopsis, characters,
   * recommendations, etc.). The shape is provider-specific — see each
   * implementation's return type for fields.
   *
   * Mirrors Kotlin `load(auth, id): SyncResult?`. We return `any` here because
   * each provider's SyncResult shape is slightly different (AniList fills
   * actors, MAL doesn't, etc.) and we don't want to force a least-common-
   * denominator type.
   */
  abstract load(id: string): Promise<any>;

  /**
   * Search the service for a query string. Returns matching items.
   *
   * Mirrors Kotlin `search(auth, query): List<SyncSearchResult>?`. The web port
   * returns `LibraryItem[]` (the search result and library item types were
   * merged in our simplified type system — they have the same shape).
   */
  abstract search(query: string): Promise<LibraryItem[]>;

  /**
   * Fetch the user's full library, grouped by status.
   *
   * Mirrors Kotlin `library(auth): LibraryMetadata?`.
   */
  abstract library(): Promise<LibraryMetadata>;

  // ---------------------------------------------------------------------------
  // Optional capabilities — providers override these to opt in.
  // ---------------------------------------------------------------------------

  /**
   * The set of watch-status strings this provider supports. Used by the UI to
   * decide which status chips to show. Defaults to the standard six used by
   * AniList/MAL/Kitsu/Simkl.
   *
   * Kotlin: `supportedWatchTypes: Set<SyncWatchType>`.
   */
  supportedWatchTypes: string[] = [
    "WATCHING",
    "COMPLETED",
    "ONHOLD",
    "DROPPED",
    "PLANTOWATCH",
    "REWATCHING",
    "NONE",
  ];

  /**
   * Cache invalidation flag. Set to true after `updateStatus` mutates the
   * library; the next `library()` call should re-fetch from the service.
   * The Kotlin version lives in the SyncRepo wrapper — on web we put it on
   * the provider itself for simplicity.
   */
  requireLibraryRefresh: boolean = true;
}

export default SyncAPI;
