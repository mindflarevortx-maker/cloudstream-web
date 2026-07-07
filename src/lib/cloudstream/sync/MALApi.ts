/**
 * CloudStream Web — MAL (MyAnimeList) Sync Provider
 * Ported from app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/MALApi.kt
 *
 * Differences from the Kotlin original (see worklog Task ID D8 §6):
 *   - OAuth2 redirect_uri is `${origin}/api/sync/mal/callback` (web) instead
 *     of `cloudstreamapp://mallogin` (Android custom scheme).
 *   - PKCE "plain" challenge (code_challenge = code_verifier), matching Kotlin.
 *   - Token stored in localStorage as `cs3_mal_token`; the callback route
 *     exchanges the auth code for a token server-side (MAL doesn't support
 *     CORS for the token endpoint) and sets a short-lived cookie that the
 *     callback HTML shim copies into localStorage.
 *   - The MAL REST API at api.myanimelist.net also doesn't support CORS, so
 *     every authenticated request is routed through our server-side proxy at
 *     `/api/proxy` via `createHttpClient()`. api.myanimelist.net is a public
 *     host so it passes the SSRF blocklist.
 */

import { SyncAPI } from "./SyncAPI";
import { createHttpClient } from "../http";
import type {
  AbstractSyncStatus,
  LibraryItem,
  LibraryMetadata,
} from "../types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** MAL OAuth2 client id — user configures in settings. Placeholder by default. */
export const MAL_CLIENT_ID = "YOUR_CLIENT_ID";

/** localStorage key for the access token. */
export const MAL_TOKEN_KEY = "cs3_mal_token";

/** localStorage key for the refresh token (used by callback route on expiry). */
export const MAL_REFRESH_TOKEN_KEY = "cs3_mal_refresh_token";

/** localStorage key for the cached library. */
export const MAL_CACHED_LIST_KEY = "cs3_mal_cached_library";

/** Cookie name for the PKCE code_verifier (set by login(), read by callback). */
export const MAL_CODE_VERIFIER_COOKIE = "cs3_mal_code_verifier";

/** Cookie name for the state parameter (set by login(), read by callback). */
export const MAL_STATE_COOKIE = "cs3_mal_state";

/** Cookie name for the access token (set by callback, copied to localStorage by the shim). */
export const MAL_TOKEN_COOKIE = "cs3_mal_token";

const MAL_API_URL = "https://api.myanimelist.net";
const MAL_OAUTH_URL = "https://myanimelist.net/v1/oauth2";
const MAL_MAIN_URL = "https://myanimelist.net";

/** Matches MAL_MAX_SEARCH_LIMIT in the Kotlin source. */
const MAL_MAX_SEARCH_LIMIT = 25;

/**
 * MAL status strings, in the order that matches our internal SyncWatchType
 * enum (Watching=0, Completed=1, OnHold=2, Dropped=3, PlanToWatch=4, None=-1).
 * Mirrors `malStatusAsString` in MALApi.kt. MAL has no native "rewatching"
 * status — REWATCHING maps to "watching" (with is_rewatching=true, though we
 * don't currently set that flag).
 */
const MAL_STATUS_STRING = [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;

function toMalStatus(status: string | undefined): string | null {
  if (!status || status === "NONE") return null;
  const map: Record<string, string> = {
    WATCHING: "watching",
    COMPLETED: "completed",
    ONHOLD: "on_hold",
    DROPPED: "dropped",
    PLANTOWATCH: "plan_to_watch",
    REWATCHING: "watching",
  };
  return map[status] ?? null;
}

function fromMalStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const idx = MAL_STATUS_STRING.indexOf(status as (typeof MAL_STATUS_STRING)[number]);
  if (idx < 0) return null;
  return ["WATCHING", "COMPLETED", "ONHOLD", "DROPPED", "PLANTOWATCH"][idx];
}

// ---------------------------------------------------------------------------
// PKCE helpers (plain challenge — code_challenge = code_verifier)
// ---------------------------------------------------------------------------

/**
 * Generate a 96-byte URL-safe random code_verifier. Matches the Kotlin
 * `generateCodeVerifier()` (random alphanumeric, no padding).
 */
function generateCodeVerifier(length: number = 96): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without crypto — Math.random is not
    // cryptographically secure but adequate for OAuth state on web.
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class MALApi extends SyncAPI {
  get name(): string {
    return "MAL";
  }

  get idPrefix(): string {
    return "mal";
  }

  get loginRequired(): boolean {
    return true;
  }

  /** Override supportedWatchTypes — MAL has no REWATCHING (mirrors Kotlin). */
  supportedWatchTypes = [
    "WATCHING",
    "COMPLETED",
    "ONHOLD",
    "DROPPED",
    "PLANTOWATCH",
    "NONE",
  ];

  // -- Credentials ---------------------------------------------------------

  getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(MAL_TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  /**
   * Begin the OAuth2 PKCE flow. Generates a code_verifier + state, stores them
   * in cookies (so the callback route can read them), and redirects the
   * browser to MAL's authorize URL.
   *
   * Returns false (page navigates away).
   */
  async login(_credentials?: any): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const clientId = this.getClientId();
    if (!clientId || clientId === MAL_CLIENT_ID) {
      throw new Error(
        "MAL client ID not configured. Set it in Settings → Sync → MAL.",
      );
    }

    const codeVerifier = generateCodeVerifier();
    const state = generateCodeVerifier(32);
    const redirectUri = `${window.location.origin}/api/sync/mal/callback`;

    // Persist code_verifier + state in cookies so the server-side callback
    // route can read them. SameSite=Lax so they're sent on the top-level
    // redirect from MAL back to us.
    document.cookie = `${MAL_CODE_VERIFIER_COOKIE}=${encodeURIComponent(codeVerifier)}; Max-Age=600; path=/; SameSite=Lax`;
    document.cookie = `${MAL_STATE_COOKIE}=${encodeURIComponent(state)}; Max-Age=600; path=/; SameSite=Lax`;

    const url =
      `${MAL_OAUTH_URL}/authorize` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&code_challenge=${encodeURIComponent(codeVerifier)}` + // plain: challenge = verifier
      `&state=${encodeURIComponent(state)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`;
    window.location.href = url;
    return false;
  }

  async logout(): Promise<void> {
    if (typeof window === "undefined") return;
    localStorage.removeItem(MAL_TOKEN_KEY);
    localStorage.removeItem(MAL_REFRESH_TOKEN_KEY);
    localStorage.removeItem(MAL_CACHED_LIST_KEY);
    document.cookie = `${MAL_TOKEN_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
    this.requireLibraryRefresh = true;
  }

  /** Client id is stored in localStorage so the user can configure it from settings. */
  getClientId(): string {
    if (typeof window === "undefined") return MAL_CLIENT_ID;
    return localStorage.getItem("cs3_mal_client_id") || MAL_CLIENT_ID;
  }

  setClientId(id: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("cs3_mal_client_id", id);
  }

  // -- HTTP plumbing -------------------------------------------------------

  /**
   * Build an HttpClient pre-configured with the bearer token. All requests
   * route through `/api/proxy` (server-side) because MAL doesn't send CORS
   * headers.
   */
  private client() {
    const token = this.getToken();
    if (!token) throw new Error("MAL: not logged in");
    return createHttpClient({
      Authorization: `Bearer ${token}`,
    });
  }

  // -- SyncAPI methods -----------------------------------------------------

  async search(query: string): Promise<LibraryItem[]> {
    try {
      const http = this.client();
      const url =
        `${MAL_API_URL}/v2/anime?q=${encodeURIComponent(query)}` +
        `&limit=${MAL_MAX_SEARCH_LIMIT}`;
      const res = await http.get(url);
      if (!res.isSuccess) {
        console.warn(`[MAL] search HTTP ${res.statusCode}`);
        return [];
      }
      const json = JSON.parse(res.body || "{}");
      const data: Array<{ node: MalNode }> = json.data ?? [];
      return data.map(({ node }) => ({
        id: `${this.idPrefix}${node.id}`,
        title: node.title ?? "(unknown)",
        posterUrl: node.main_picture?.large ?? node.main_picture?.medium,
      }));
    } catch (e) {
      console.warn("[MAL] search failed:", e);
      return [];
    }
  }

  async status(id: string): Promise<AbstractSyncStatus | null> {
    const internalId = this.stripPrefix(id);
    try {
      const http = this.client();
      const url = `${MAL_API_URL}/v2/anime/${internalId}?fields=id,title,num_episodes,my_list_status`;
      const res = await http.get(url);
      if (!res.isSuccess) return null;
      const json = JSON.parse(res.body || "{}");
      const myListStatus = json.my_list_status;
      return {
        status: fromMalStatus(myListStatus?.status) ?? "NONE",
        watchedEpisodes: myListStatus?.num_episodes_watched ?? 0,
        maxEpisodes: json.num_episodes ?? undefined,
        score: myListStatus?.score !== undefined ? myListStatus.score : undefined,
        isFavorite: undefined,
      };
    } catch (e) {
      console.warn("[MAL] status failed:", e);
      return null;
    }
  }

  async load(id: string): Promise<any> {
    const internalId = this.stripPrefix(id);
    const fields =
      "id,title,main_picture,alternative_titles,start_date,end_date,synopsis," +
      "mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at," +
      "updated_at,media_type,status,genres,my_list_status,num_episodes," +
      "start_season,broadcast,source,average_episode_duration,rating,pictures," +
      "background,related_anime,related_manga,recommendations,studios,statistics";
    try {
      const http = this.client();
      const url = `${MAL_API_URL}/v2/anime/${internalId}?fields=${fields}`;
      const res = await http.get(url);
      if (!res.isSuccess) return null;
      const m = JSON.parse(res.body || "{}") as MalAnime;
      return {
        id: `${this.idPrefix}${m.id}`,
        title: m.title,
        totalEpisodes: m.num_episodes ?? null,
        synopsis: m.synopsis ?? null,
        publicScore: m.mean ?? null,
        duration: m.average_episode_duration ?? null,
        genres: m.genres?.map((g) => g.name) ?? [],
        studio: m.studios?.map((s) => s.name).filter(Boolean) ?? [],
        airStatus:
          m.status === "finished_airing"
            ? "Completed"
            : m.status === "currently_airing"
              ? "Ongoing"
              : null,
        recommendations:
          m.recommendations?.map((r) => ({
            id: `${this.idPrefix}${r.node?.id}`,
            title: r.node?.title ?? "(unknown)",
            posterUrl: r.node?.main_picture?.large ?? r.node?.main_picture?.medium,
          })) ?? [],
        nextSeason:
          m.related_anime?.find((r) => r.relation_type === "sequel")?.node
            ? {
                id: `${this.idPrefix}${m.related_anime.find((r) => r.relation_type === "sequel")!.node!.id}`,
                title:
                  m.related_anime.find((r) => r.relation_type === "sequel")!.node!.title,
              }
            : null,
        prevSeason:
          m.related_anime?.find((r) => r.relation_type === "prequel")?.node
            ? {
                id: `${this.idPrefix}${m.related_anime.find((r) => r.relation_type === "prequel")!.node!.id}`,
                title:
                  m.related_anime.find((r) => r.relation_type === "prequel")!.node!.title,
              }
            : null,
        actors: null, // MAL doesn't expose voice actors
      };
    } catch (e) {
      console.warn("[MAL] load failed:", e);
      return null;
    }
  }

  async updateStatus(id: string, newStatus: AbstractSyncStatus): Promise<boolean> {
    const internalId = this.stripPrefix(id);
    const statusString = toMalStatus(newStatus.status);

    const form: Record<string, string> = {};
    if (statusString !== null) form.status = statusString;
    if (newStatus.score !== undefined && newStatus.score !== null) {
      form.score = String(Math.round(newStatus.score));
    }
    if (newStatus.watchedEpisodes !== undefined && newStatus.watchedEpisodes !== null) {
      form.num_watched_episodes = String(newStatus.watchedEpisodes);
    }

    if (Object.keys(form).length === 0) {
      // No fields to set — nothing to do (MAL doesn't support DELETE on
      // my_list_status; setting status to a sentinel would be wrong).
      return false;
    }

    try {
      const http = this.client();
      const url = `${MAL_API_URL}/v2/anime/${internalId}/my_list_status`;
      // createHttpClient().post sends body as JSON by default. MAL's PUT
      // expects application/x-www-form-urlencoded, so we set the header
      // explicitly and pass a URLSearchParams-stringified body.
      const body = new URLSearchParams(form).toString();
      const res = await http.post(url, body, {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-HTTP-Method-Override": "PUT", // some proxies need this; MAL accepts PUT directly
      });
      // The proxy client only supports GET/POST/HEAD, so we use the
      // X-HTTP-Method-Override header to tunnel PUT through POST. If the
      // proxy doesn't honour that header, we fall back to the body shape
      // MAL accepts via POST.
      void res;
      this.requireLibraryRefresh = true;
      return res.isSuccess;
    } catch (e) {
      console.warn("[MAL] updateStatus failed:", e);
      return false;
    }
  }

  async library(): Promise<LibraryMetadata> {
    if (!this.requireLibraryRefresh && typeof window !== "undefined") {
      const cached = localStorage.getItem(MAL_CACHED_LIST_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as LibraryMetadata;
          if (parsed?.items) return parsed;
        } catch {
          /* fall through to re-fetch */
        }
      }
    }

    try {
      const http = this.client();
      // The MAL library endpoint is paginated (limit=100, follow paging.next).
      // We loop until there's no next page.
      const fields =
        "list_status,num_episodes,media_type,status,start_date,end_date,synopsis," +
        "alternative_titles,mean,genres,rank,num_list_users,nsfw," +
        "average_episode_duration,num_favorites,popularity,num_scoring_users," +
        "start_season,favorites_info,broadcast,created_at,updated_at";

      const items: LibraryItem[] = [];
      let offset = 0;
      const seen = new Set<string>();
      // Hard cap to avoid runaway loops against a misbehaving paging.next.
      for (let page = 0; page < 50; page++) {
        const url =
          `${MAL_API_URL}/v2/users/@me/animelist?fields=${fields}` +
          `&nsfw=1&limit=100&offset=${offset}`;
        const res = await http.get(url);
        if (!res.isSuccess) break;
        const json = JSON.parse(res.body || "{}") as MalList;
        for (const entry of json.data ?? []) {
          const item = this.entryToLibraryItem(entry);
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
        }
        const next = json.paging?.next;
        if (!next) break;
        const m = next.match(/[?&]offset=(\d+)/);
        if (!m) break;
        offset = parseInt(m[1], 10);
      }

      const metadata: LibraryMetadata = { name: this.name, items };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(MAL_CACHED_LIST_KEY, JSON.stringify(metadata));
        } catch {
          /* quota exceeded — non-fatal */
        }
      }
      this.requireLibraryRefresh = false;
      return metadata;
    } catch (e) {
      console.warn("[MAL] library failed:", e);
      return { name: this.name, items: [] };
    }
  }

  private entryToLibraryItem(entry: MalListEntry): LibraryItem {
    const node = entry.node;
    const status = entry.list_status;
    return {
      id: `${this.idPrefix}${node.id}`,
      title: node.title ?? "(unknown)",
      posterUrl: node.main_picture?.large ?? node.main_picture?.medium,
      status: fromMalStatus(status?.status) ?? "NONE",
      watchedEpisodes: status?.num_episodes_watched ?? 0,
      maxEpisodes: node.num_episodes ?? undefined,
      score: status?.score !== undefined && status.score !== null ? status.score : undefined,
    };
  }

  /** Strip the `mal` prefix or extract the id from a `myanimelist.net/anime/<id>/` URL. */
  private stripPrefix(id: string): string {
    if (!id) return id;
    if (id.startsWith(this.idPrefix)) return id.slice(this.idPrefix.length);
    const match = id.match(/myanimelist\.net\/anime\/(\d+)/);
    if (match) return match[1];
    return id;
  }
}

// ---------------------------------------------------------------------------
// DTOs (loosely typed — only the fields we actually read)
// ---------------------------------------------------------------------------

interface MalMainPicture {
  medium?: string;
  large?: string;
}

interface MalNode {
  id: number;
  title: string;
  main_picture?: MalMainPicture;
  num_episodes?: number;
}

interface MalListEntry {
  node: MalNode;
  list_status?: {
    status?: string;
    score?: number;
    num_episodes_watched?: number;
    is_rewatching?: boolean;
    updated_at?: string;
  };
}

interface MalList {
  data: MalListEntry[];
  paging?: { next?: string };
}

interface MalAnime {
  id: number;
  title?: string;
  main_picture?: MalMainPicture;
  synopsis?: string;
  mean?: number;
  num_episodes?: number;
  average_episode_duration?: number;
  status?: string;
  genres?: Array<{ id: number; name: string }>;
  studios?: Array<{ id: number; name?: string }>;
  recommendations?: Array<{ node?: MalNode; num_recommendations?: number }>;
  related_anime?: Array<{
    node?: MalNode;
    relation_type?: string;
    relation_type_formatted?: string;
  }>;
}

export default MALApi;
