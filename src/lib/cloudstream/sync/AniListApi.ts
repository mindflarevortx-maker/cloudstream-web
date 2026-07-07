/**
 * CloudStream Web — AniList Sync Provider
 * Ported from app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/AniListApi.kt
 *
 * Differences from the Kotlin original (see worklog Task ID D8 §5):
 *   - OAuth2 redirect_uri is `${origin}/api/sync/anilist/callback` (web) instead
 *     of `cloudstreamapp://anilistlogin` (Android custom scheme).
 *   - Implicit grant flow: the access_token arrives in the URL fragment
 *     (`#access_token=...`), which the browser never sends to the server. The
 *     callback route returns a tiny HTML page that reads the fragment, writes
 *     the token to localStorage + a cookie, then redirects to /settings.
 *   - AniList's GraphQL endpoint supports CORS, so we use `fetch()` directly
 *     rather than routing through the server-side proxy.
 *   - The Viewer query is used to look up the AniList user id; the id is
 *     cached in localStorage so subsequent library() calls don't re-fetch it.
 */

import { SyncAPI } from "./SyncAPI";
import type {
  AbstractSyncStatus,
  LibraryItem,
  LibraryMetadata,
} from "../types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * AniList OAuth2 client id. Users register their own at
 * https://anilist.co/settings/developer and paste it into the settings page.
 * Placeholder until the user configures it.
 */
export const ANILIST_CLIENT_ID = "YOUR_CLIENT_ID";

/** localStorage key for the access token (1-year lifetime, no refresh). */
export const ANILIST_TOKEN_KEY = "cs3_anilist_token";

/** localStorage key for the cached AniList user id. */
export const ANILIST_USER_ID_KEY = "cs3_anilist_user_id";

/** localStorage key for the cached library (so library() doesn't re-fetch on every open). */
export const ANILIST_CACHED_LIST_KEY = "cs3_anilist_cached_library";

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co/";
const ANILIST_AUTHORIZE_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_MAIN_URL = "https://anilist.co";

/**
 * AniList MediaListStatus values, in the order that matches our SyncWatchType
 * enum (Watching=0, Completed=1, Paused=2, Dropped=3, Planning=4, ReWatching=5,
 * None=-1). Mirrors `aniListStatusString` in the Kotlin source.
 */
const ANILIST_STATUS_STRING = [
  "CURRENT", // Watching
  "COMPLETED",
  "PAUSED",
  "DROPPED",
  "PLANNING",
  "REPEATING", // ReWatching
] as const;

/** Map our internal status string -> AniList GraphQL status string. */
function toAniListStatus(status: string | undefined): string | null {
  if (!status || status === "NONE") return null;
  const idx = [
    "WATCHING",
    "COMPLETED",
    "ONHOLD",
    "DROPPED",
    "PLANTOWATCH",
    "REWATCHING",
  ].indexOf(status);
  if (idx < 0) return null;
  return ANILIST_STATUS_STRING[idx];
}

/** Map AniList GraphQL status string -> our internal status string. */
function fromAniListStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const idx = ANILIST_STATUS_STRING.indexOf(status as (typeof ANILIST_STATUS_STRING)[number]);
  if (idx < 0) return null;
  return [
    "WATCHING",
    "COMPLETED",
    "ONHOLD",
    "DROPPED",
    "PLANTOWATCH",
    "REWATCHING",
  ][idx];
}

// ---------------------------------------------------------------------------
// GraphQL queries & mutations
// (Direct ports from AniListApi.kt — keep field selection identical so the
// response shapes match the DTOs we parse below.)
// ---------------------------------------------------------------------------

const VIEWER_QUERY = `
  {
    Viewer {
      id
      name
      avatar { large }
      favourites { anime { nodes { id } } }
    }
  }
`;

const SEARCH_QUERY = `
  query ($id: Int, $page: Int, $search: String, $type: MediaType) {
    Page (page: $page, perPage: 10) {
      media (id: $id, search: $search, type: $type) {
        id
        idMal
        seasonYear
        startDate { year month day }
        title { romaji }
        averageScore
        meanScore
        nextAiringEpisode { timeUntilAiring episode }
        trailer { id site thumbnail }
        bannerImage
        recommendations {
          nodes {
            id
            mediaRecommendation {
              id
              title { english romaji }
              idMal
              coverImage { medium large extraLarge }
              averageScore
            }
          }
        }
        relations {
          edges {
            id
            relationType(version: 2)
            node {
              format
              id
              idMal
              coverImage { medium large extraLarge }
              averageScore
              title { english romaji }
            }
          }
        }
      }
    }
  }
`;

const STATUS_QUERY = `
  query ($id: Int = $id) {
    Media (id: $id, type: ANIME) {
      id
      episodes
      isFavourite
      mediaListEntry {
        progress
        status
        score (format: POINT_100)
      }
      title {
        english
        romaji
      }
    }
  }
`.replace("$id: Int = $id", "$id: Int");

const LOAD_QUERY = `
  query ($id: Int = $id) {
    Media (id: $id, type: ANIME) {
      id
      idMal
      coverImage { extraLarge large medium color }
      title { romaji english native userPreferred }
      duration
      episodes
      genres
      synonyms
      averageScore
      isAdult
      description(asHtml: false)
      characters(sort: ROLE page: 1 perPage: 20) {
        edges {
          role
          voiceActors {
            name { userPreferred full native }
            age
            image { large medium }
          }
          node {
            name { userPreferred full native }
            age
            image { large medium }
          }
        }
      }
      trailer { id site thumbnail }
      relations {
        edges {
          id
          relationType(version: 2)
          node {
            id
            coverImage { extraLarge large medium color }
          }
        }
      }
      recommendations {
        edges {
          node {
            mediaRecommendation {
              id
              coverImage { extraLarge large medium color }
              title { romaji english native userPreferred }
            }
          }
        }
      }
      nextAiringEpisode { timeUntilAiring episode }
      format
    }
  }
`.replace("$id: Int = $id", "$id: Int");

const LIBRARY_QUERY = `
  query ($userID: Int = $userID, $MEDIA: MediaType = $mediaType) {
    MediaListCollection (userId: $userID, type: $MEDIA) {
      lists {
        status
        entries {
          status
          completedAt { year month day }
          startedAt { year month day }
          updatedAt
          progress
          score (format: POINT_100)
          private
          media {
            id
            idMal
            season
            seasonYear
            format
            episodes
            chapters
            title { english romaji }
            coverImage { extraLarge large medium }
            synonyms
            nextAiringEpisode { timeUntilAiring episode }
          }
        }
      }
    }
  }
`.replace("$userID: Int = $userID, $MEDIA: MediaType = $mediaType", "$userID: Int, $MEDIA: MediaType");

const MEDIA_LIST_ID_QUERY = `
  query MediaList($userId: Int, $mediaId: Int) {
    MediaList(userId: $userId, mediaId: $mediaId) {
      id
    }
  }
`;

/** Build a SaveMediaListEntry mutation. We omit null params rather than passing them. */
function buildSaveMutation(
  id: number,
  status: string,
  scoreRaw: number | null,
  progress: number | null,
): string {
  const vars: string[] = [`$id: Int = ${id}`, `$status: MediaListStatus = ${status}`];
  if (scoreRaw !== null) vars.push(`$scoreRaw: Int = ${scoreRaw}`);
  if (progress !== null) vars.push(`$progress: Int = ${progress}`);

  const scoreArg = scoreRaw !== null ? ", scoreRaw: $scoreRaw" : "";
  const progressArg = progress !== null ? ", progress: $progress" : "";

  return `
    mutation (${vars.join(", ")}) {
      SaveMediaListEntry (mediaId: $id, status: $status${scoreArg}${progressArg}) {
        id
        status
        progress
        score
      }
    }
  `;
}

function buildDeleteMutation(listId: number): string {
  return `
    mutation($id: Int = ${listId}) {
      DeleteMediaListEntry(id: $id) {
        deleted
      }
    }
  `;
}

// ---------------------------------------------------------------------------
// DTOs (loosely typed — AniList responses are big and we only read a few fields)
// ---------------------------------------------------------------------------

interface AniListMediaListEntry {
  progress?: number;
  status?: string;
  score?: number;
}

interface AniListTitleHolder {
  title?: { english?: string; romaji?: string };
  isFavourite?: boolean;
  id?: number;
  progress?: number;
  episodes?: number;
  score?: number; // POINT_100 format (0-100)
  type?: string; // AniList MediaListStatus string
}

interface AniListSearchMedia {
  id: number;
  idMal?: number;
  seasonYear?: number;
  title?: { romaji?: string };
  bannerImage?: string;
  averageScore?: number;
}

interface AniListLibraryEntry {
  status?: string;
  updatedAt?: number;
  progress?: number;
  score?: number; // POINT_100
  private?: boolean;
  media: {
    id: number;
    idMal?: number;
    seasonYear?: number;
    episodes?: number;
    title?: { english?: string; romaji?: string };
    coverImage?: { extraLarge?: string; large?: string; medium?: string };
    synonyms?: string[];
    description?: string;
  };
}

interface AniListLibraryList {
  status?: string;
  entries: AniListLibraryEntry[];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AniListApi extends SyncAPI {
  get name(): string {
    return "AniList";
  }

  get idPrefix(): string {
    return "anilist";
  }

  get loginRequired(): boolean {
    return true;
  }

  // -- Credentials ---------------------------------------------------------

  getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(ANILIST_TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  /**
   * Begin the OAuth2 implicit-grant flow. Redirects the browser to AniList's
   * authorize URL. After the user logs in, AniList redirects to
   * `${origin}/api/sync/anilist/callback#access_token=...`, which serves a
   * tiny HTML shim that extracts the token and writes it to localStorage.
   *
   * Returns false (the page navigates away before the promise resolves).
   */
  async login(_credentials?: any): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const clientId = this.getClientId();
    if (!clientId || clientId === ANILIST_CLIENT_ID) {
      throw new Error(
        "AniList client ID not configured. Set it in Settings → Sync → AniList.",
      );
    }
    const redirectUri = `${window.location.origin}/api/sync/anilist/callback`;
    const url =
      `${ANILIST_AUTHORIZE_URL}` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`;
    window.location.href = url;
    return false;
  }

  async logout(): Promise<void> {
    if (typeof window === "undefined") return;
    localStorage.removeItem(ANILIST_TOKEN_KEY);
    localStorage.removeItem(ANILIST_USER_ID_KEY);
    localStorage.removeItem(ANILIST_CACHED_LIST_KEY);
    // Also clear the cookie set by the callback route (best-effort).
    document.cookie = `${ANILIST_TOKEN_KEY}=; Max-Age=0; path=/; SameSite=Lax`;
    this.requireLibraryRefresh = true;
  }

  /**
   * The client id is stored in localStorage under `cs3_anilist_client_id` so
   * the user can configure it from the settings page without rebuilding.
   */
  getClientId(): string {
    if (typeof window === "undefined") return ANILIST_CLIENT_ID;
    return localStorage.getItem("cs3_anilist_client_id") || ANILIST_CLIENT_ID;
  }

  setClientId(id: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("cs3_anilist_client_id", id);
  }

  // -- GraphQL plumbing ----------------------------------------------------

  private async graphql(
    query: string,
    variables?: Record<string, unknown>,
    useCache: boolean = false,
  ): Promise<any | null> {
    const token = this.getToken();
    if (!token) return null;

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Cache-Control": useCache ? "max-stale=600" : "no-cache",
    };

    try {
      const res = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        console.warn(`[AniList] GraphQL HTTP ${res.status}`);
        return null;
      }
      const json = await res.json();
      if (json.errors) {
        console.warn("[AniList] GraphQL errors:", json.errors);
        return null;
      }
      return json.data ?? null;
    } catch (e) {
      console.warn("[AniList] GraphQL fetch failed:", e);
      return null;
    }
  }

  /** Run the Viewer query; cache the user id for later library() calls. */
  async getUserId(): Promise<number | null> {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(ANILIST_USER_ID_KEY);
      if (cached) {
        const n = parseInt(cached, 10);
        if (!Number.isNaN(n)) return n;
      }
    }
    const data = await this.graphql(VIEWER_QUERY);
    const id = data?.Viewer?.id;
    if (typeof id === "number" && typeof window !== "undefined") {
      localStorage.setItem(ANILIST_USER_ID_KEY, String(id));
    }
    return typeof id === "number" ? id : null;
  }

  // -- SyncAPI methods -----------------------------------------------------

  async search(query: string): Promise<LibraryItem[]> {
    // Search doesn't strictly require auth on AniList, but we send the token
    // if available to get personalised results.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: { search: query, page: 1, type: "ANIME" },
        }),
      });
      if (!res.ok) return [];
      const json = await res.json();
      const media: AniListSearchMedia[] = json?.data?.Page?.media ?? [];
      return media.map((m) => ({
        id: `${this.idPrefix}${m.id}`,
        title: m.title?.romaji ?? "(unknown)",
        posterUrl: m.bannerImage ?? undefined,
        score: m.averageScore ? m.averageScore / 10 : undefined,
      }));
    } catch (e) {
      console.warn("[AniList] search failed:", e);
      return [];
    }
  }

  async status(id: string): Promise<AbstractSyncStatus | null> {
    const internalId = parseInt(this.stripPrefix(id), 10);
    if (Number.isNaN(internalId)) return null;

    const data = await this.graphql(STATUS_QUERY, { id: internalId });
    if (!data?.Media) return null;

    const media = data.Media;
    const entry: AniListMediaListEntry | null = media.mediaListEntry ?? null;
    return {
      status: fromAniListStatus(entry?.status) ?? "NONE",
      watchedEpisodes: entry?.progress ?? 0,
      maxEpisodes: media.episodes ?? undefined,
      score: entry?.score !== undefined && entry.score !== null
        ? entry.score / 10 // POINT_100 → 0-10
        : undefined,
      isFavorite: media.isFavourite ?? undefined,
    };
  }

  async load(id: string): Promise<any> {
    const internalId = parseInt(this.stripPrefix(id), 10);
    if (Number.isNaN(internalId)) return null;

    const data = await this.graphql(LOAD_QUERY, { id: internalId }, true);
    if (!data?.Media) return null;

    const m = data.Media;
    return {
      id: `${this.idPrefix}${m.id}`,
      title: m.title?.userPreferred ?? m.title?.romaji ?? m.title?.english,
      totalEpisodes: m.episodes ?? null,
      synopsis: m.description ?? null,
      publicScore: m.averageScore ? m.averageScore / 10 : null,
      duration: m.duration ?? null,
      genres: m.genres ?? [],
      synonyms: m.synonyms ?? [],
      isAdult: m.isAdult ?? false,
      posterUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? m.coverImage?.medium,
      trailers:
        m.trailer?.site?.toLowerCase() === "youtube" && m.trailer.id
          ? [`https://www.youtube.com/watch?v=${m.trailer.id}`]
          : null,
      actors:
        m.characters?.edges?.map((edge: any) => ({
          name:
            edge.node?.name?.userPreferred ??
            edge.node?.name?.full ??
            edge.node?.name?.native,
          imageUrl: edge.node?.image?.large ?? edge.node?.image?.medium,
          role: edge.role ?? null,
          voiceActor: edge.voiceActors?.[0]
            ? {
                name:
                  edge.voiceActors[0].name?.userPreferred ??
                  edge.voiceActors[0].name?.full ??
                  edge.voiceActors[0].name?.native,
                imageUrl:
                  edge.voiceActors[0].image?.large ??
                  edge.voiceActors[0].image?.medium,
              }
            : null,
        })) ?? [],
      recommendations:
        m.recommendations?.edges
          ?.map((e: any) => e?.node?.mediaRecommendation)
          .filter(Boolean)
          .map((r: any) => ({
            id: `${this.idPrefix}${r.id}`,
            title: r.title?.userPreferred ?? r.title?.romaji ?? r.title?.english,
            posterUrl:
              r.coverImage?.extraLarge ?? r.coverImage?.large ?? r.coverImage?.medium,
          })) ?? [],
      nextAiring: m.nextAiringEpisode
        ? {
            episode: m.nextAiringEpisode.episode ?? null,
            unixTime: m.nextAiringEpisode.timeUntilAiring
              ? Math.floor(Date.now() / 1000) + m.nextAiringEpisode.timeUntilAiring
              : null,
          }
        : null,
    };
  }

  async updateStatus(id: string, newStatus: AbstractSyncStatus): Promise<boolean> {
    const internalId = parseInt(this.stripPrefix(id), 10);
    if (Number.isNaN(internalId)) return false;

    const statusString = toAniListStatus(newStatus.status);
    const userId = await this.getUserId();
    if (userId === null) return false;

    // Delete branch: status === "NONE" (mirrors Kotlin)
    if (!statusString) {
      const lookup = await this.graphql(MEDIA_LIST_ID_QUERY, {
        userId,
        mediaId: internalId,
      });
      const listId = lookup?.MediaList?.id;
      if (typeof listId !== "number") return false;
      const result = await this.graphql(buildDeleteMutation(listId));
      this.requireLibraryRefresh = true;
      return result !== null;
    }

    // SaveMediaListEntry branch
    const scoreRaw =
      newStatus.score !== undefined && newStatus.score !== null
        ? Math.round(newStatus.score * 10) // 0-10 → 0-100 (POINT_100)
        : null;
    const progress = newStatus.watchedEpisodes ?? null;
    const mutation = buildSaveMutation(internalId, statusString, scoreRaw, progress);
    const result = await this.graphql(mutation);
    this.requireLibraryRefresh = true;
    return result !== null;
  }

  async library(): Promise<LibraryMetadata> {
    const userId = await this.getUserId();
    if (userId === null) {
      return { name: this.name, items: [] };
    }

    // Cache layer — mirrors Kotlin getAniListAnimeListSmart
    if (!this.requireLibraryRefresh && typeof window !== "undefined") {
      const cached = localStorage.getItem(ANILIST_CACHED_LIST_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as LibraryMetadata;
          if (parsed?.items) return parsed;
        } catch {
          /* fall through to re-fetch */
        }
      }
    }

    const data = await this.graphql(LIBRARY_QUERY, {
      userID: userId,
      MEDIA: "ANIME",
    });
    const lists: AniListLibraryList[] = data?.MediaListCollection?.lists ?? [];

    // Group items by their status string. We mirror the Kotlin baseMap — empty
    // lists are filled in for every supported status so the UI can show all
    // tabs even when the user has nothing in some of them.
    const byStatus: Record<string, LibraryItem[]> = {};
    for (const list of lists) {
      const statusKey = fromAniListStatus(list.status) ?? "WATCHING";
      if (!byStatus[statusKey]) byStatus[statusKey] = [];
      for (const entry of list.entries) {
        byStatus[statusKey].push(this.entryToLibraryItem(entry));
      }
    }

    const items: LibraryItem[] = [];
    for (const statusKey of [
      "WATCHING",
      "COMPLETED",
      "ONHOLD",
      "DROPPED",
      "PLANTOWATCH",
      "REWATCHING",
    ]) {
      for (const item of byStatus[statusKey] ?? []) {
        items.push(item);
      }
    }

    const metadata: LibraryMetadata = {
      name: this.name,
      items,
    };

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(ANILIST_CACHED_LIST_KEY, JSON.stringify(metadata));
      } catch {
        /* quota exceeded — non-fatal */
      }
    }
    this.requireLibraryRefresh = false;
    return metadata;
  }

  private entryToLibraryItem(entry: AniListLibraryEntry): LibraryItem {
    const m = entry.media;
    const title = m.title?.english ?? m.title?.romaji ?? m.synonyms?.[0] ?? "(unknown)";
    return {
      id: `${this.idPrefix}${m.id}`,
      title,
      posterUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? m.coverImage?.medium,
      status: fromAniListStatus(entry.status) ?? "NONE",
      watchedEpisodes: entry.progress ?? 0,
      maxEpisodes: m.episodes ?? undefined,
      score:
        entry.score !== undefined && entry.score !== null
          ? entry.score / 10 // POINT_100 → 0-10
          : undefined,
    };
  }

  /** Strip the `anilist` prefix or an `anilist.co/anime/` URL → just the numeric id. */
  private stripPrefix(id: string): string {
    if (!id) return id;
    if (id.startsWith(this.idPrefix)) return id.slice(this.idPrefix.length);
    const match = id.match(/anilist\.co\/anime\/(\d+)/);
    if (match) return match[1];
    return id;
  }
}

export default AniListApi;
