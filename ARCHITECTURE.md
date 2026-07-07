# CloudStream Web — Architecture

This document describes the architecture of the CloudStream Web port: the contract
surface (MainAPI / ExtractorApi / SyncAPI), the data-flow traces for the four core
operations (search → playback, extension install, watch-progress sync), the state
management strategy, the HTTP proxy, and a side-by-side comparison with the Android
app it was ported from.

It is intended for two audiences:

1. **Maintainers** — to understand *why* each piece exists and *how* it relates to the
   Android original.
2. **Extension authors** — to write providers, extractors, and sync providers without
   reading the host shell's source.

---

## Table of contents

- [Overview diagram](#overview-diagram)
- [The MainAPI Contract](#the-mainapi-contract)
- [The ExtractorApi Contract](#the-extractorapi-contract)
- [The Sync Provider Contract](#the-sync-provider-contract)
- [Data Flow: Search → Playback](#data-flow-search--playback)
- [Data Flow: Extension Install](#data-flow-extension-install)
- [Data Flow: Watch Progress Sync](#data-flow-watch-progress-sync)
- [State Management](#state-management)
- [HTTP Proxy](#http-proxy)
- [Comparison to Android CloudStream](#comparison-to-android-cloudstream)
- [How to write a new provider](#how-to-write-a-new-provider)
- [How to write a new extractor](#how-to-write-a-new-extractor)
- [How to add a sync provider](#how-to-add-a-sync-provider)

---

## Overview diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                          UI LAYER                                  │
│                                                                    │
│  HomeRails  Search  ResultPage  Player(HLS.js)  Library  Settings  │
│       │        │        │              │            │        │      │
└───────┼────────┼────────┼──────────────┼────────────┼────────┼──────┘
        │        │        │              │            │        │
        ▼        ▼        ▼              ▼            ▼        ▼
┌────────────────────────────────────────────────────────────────────┐
│                  STATE MANAGEMENT (client)                         │
│                                                                    │
│  Zustand stores (persisted)      TanStack Query (server state)     │
│   • settingsStore                 • useHomeRails()                  │
│   • libraryStore                  • useSearch(q)                    │
│   • syncAccountStore              • useResult(provider, id)         │
│   • providerRegistryStore         • useEpisodeLinks(provider, id)   │
│                                   • useLibrary()                    │
└────────┬───────────────────────────────────────────────────────────┘
         │ fetch('/api/...')  (relative path only — Caddy gateway)
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                      NEXT.JS API ROUTES                            │
│                                                                    │
│  /api/home          /api/search      /api/load       /api/links    │
│  /api/subtitles     /api/sync/*      /api/proxy  ◄── HTTP egress    │
└────────┬───────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                    PROVIDER REGISTRY                                │
│                                                                    │
│   providerRegistry.get(name) → MainAPI instance                    │
│   providerRegistry.all()     → MainAPI[]   (enabled filter)        │
│   providerRegistry.register(MyProvider)                            │
└────────┬───────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│  Built-in Providers  │  │  Built-in Extractors │  │   Sync Providers     │
│                      │  │                      │  │                      │
│  InternetArchive     │  │  GenericM3U8         │  │  AniList             │
│  Invidious           │  │  DirectVideo         │  │  MAL                 │
│  IPTVOrg             │  │  YouTube             │  │  LocalList           │
└──────────┬───────────┘  └──────────┬───────────┘  └──────────┬───────────┘
           │                         │                         │
           │  getUrl() returns       │                         │
           ▼                         │                         │
   ┌───────────────────┐             │                         │
   │  loadExtractor()  │ ◄───────────┘                         │
   │   (dispatcher)    │                                       │
   └──────────┬────────┘                                       │
              │                                                │
              ▼                                                │
   ┌────────────────────┐                                      │
   │ ExtractorLink[]    │  ────► /api/proxy  ───► HLS.js ──►   │
   │  + SubtitleData[]  │                                      │
   └────────────────────┘                                      │
                                                              │
                                  ┌───────────────────────────┘
                                  ▼
                       ┌─────────────────────┐
                       │   /api/sync/*       │
                       │  status/updateStatus│
                       │   library / search  │
                       └─────────┬───────────┘
                                 │
                                 ▼
                       ┌─────────────────────┐
                       │  AniList / MAL      │
                       │  (OAuth, GraphQL)   │
                       └─────────────────────┘
```

Three things to note about the diagram:

1. **All network egress goes through `/api/proxy`.** Providers never call `fetch()`
   directly to third-party hosts — the browser would block them on CORS, and we'd
   have no SSRF protection. Every provider fetch goes through the proxy.
2. **The registry is the seam.** Providers register themselves; the host shell only
   knows about the registry. This is the same shape as Android's `APIHolder.allProviders`
   + `afterPluginsLoadedEvent`.
3. **Sync providers live outside the registry.** They're instantiated at app start
   (one instance per provider) and held in `accountManager`. This mirrors the Android
   `AccountManager.syncApis` array.

---

## The MainAPI Contract

Every provider implements `MainAPI`. The contract is a direct port of the Android
`com.lagradost.cloudstream3.MainAPI` abstract class.

### Properties

```typescript
abstract class MainAPI {
  /** Short unique identifier, e.g. "InternetArchive". */
  abstract readonly name: string;

  /** Main site URL. Used to resolve relative links and as the Levenshtein-fallback
   *  key for extractor dispatch. */
  abstract readonly mainUrl: string;

  /** Whether the provider is enabled by default. User can override in Settings. */
  readonly enabled: boolean = true;

  /** Supported languages (BCP-47 IETF tags). Used to filter the home rails. */
  readonly lang: string[] = ["en"];

  /** Whether this provider can be used without an account. */
  readonly requiresLogin: boolean = false;

  /** Content types this provider can return. */
  readonly supportedTypes: TvType[] = [
    TvType.Movie,
    TvType.TvSeries,
    TvType.Anime,
    TvType.Live,
    TvType.Documentary,
    TvType.Others,
  ];

  /** Whether the provider is "safe" to show in the home rails. NSFW providers
   *  should set this to false; they'll only appear in explicit search. */
  readonly hasQuickSearch: boolean = false;
  readonly hasMainPage: boolean = false;
}
```

### Methods

```typescript
abstract class MainAPI {
  // ─── Search ───────────────────────────────────────────────────────

  /** Search the provider for `query`. Returns up to `pageCount` results per page.
   *  The host shell paginates by calling search(query, nextPageToken+1) until
   *  hasNextPage is false — exactly like the Android `search(query, page)` contract. */
  async search(query: string, page: number = 1): Promise<SearchResponse> {
    throw new Error("search() not implemented");
  }

  /** Quick-search (instant results as the user types). Optional. */
  async quickSearch(query: string): Promise<SearchResponse[]> {
    return [];
  }

  // ─── Home rails ───────────────────────────────────────────────────

  /** Return the home page's rails. Each rail is a named list of SearchResponse.
   *  Paginated by `page` (rail 1 of page 1, rail 1 of page 2, …) — mirrors the
   *  Android `getMainPage(page, nextPage)` contract. */
  async getMainPage(page: number = 1): Promise<HomePageResponse> {
    return { items: [], hasNextPage: false };
  }

  // ─── Detail load ──────────────────────────────────────────────────

  /** Resolve a SearchResponse.url (or any provider-internal id) to a full
   *  LoadResponse — poster, synopsis, episode list, tracker ids, etc. */
  async load(url: string): Promise<LoadResponse> {
    throw new Error("load() not implemented");
  }

  // ─── Episode → playable links ─────────────────────────────────────

  /** For a given episode (or movie), return zero or more ExtractorLink +
   *  SubtitleData. The host shell then runs loadExtractor on each ExtractorLink
   *  whose `url` doesn't already resolve to a stream, and passes the resulting
   *  playable URL to the player. */
  async loadLinks(
    data: EpisodeLink | MovieLink,
    isCasting: boolean,
    onSubtitle: (sub: SubtitleData) => void,
    onLink: (link: ExtractorLink) => void,
  ): Promise<void> {
    throw new Error("loadLinks() not implemented");
  }

  // ─── Optional video interceptor (for Cloudflare / DDoS-Guard) ─────

  /** Optional interceptor. If non-null, the player (or the proxy) will route
   *  segment fetches through it. Equivalent to Android's getVideoInterceptor. */
  async getVideoInterceptor(link: ExtractorLink): Promise<Interceptor | null> {
    return null;
  }
}
```

### Return types

The contract defines the following response types — direct ports of the Android
`SearchResponse` / `HomePageResponse` / `LoadResponse` / `ExtractorLink` /
`SubtitleData` data classes:

```typescript
interface SearchResponse {
  name: string;
  url: string;
  apiName: string;          // provider name
  type: TvType;
  posterUrl?: string;
  backgroundUrl?: string;
  syncData?: Record<string, string>;  // { aniListId: "123", malId: "456" }
}

interface HomePageResponse {
  items: HomePageList[];    // each list = one rail
  hasNextPage: boolean;
}

interface HomePageList {
  name: string;             // "Trending", "New Releases", …
  items: SearchResponse[];
  horizontalImages?: boolean;
}

interface LoadResponse {
  url: string;
  apiName: string;
  type: TvType;
  name: string;
  posterUrl?: string;
  backgroundUrl?: string;
  synopsis?: string;
  year?: number;
  rating?: number;
  duration?: string;
  tags?: string[];
  recommendations?: SearchResponse[];
  actors?: Actor[];
  trailers?: Trailer[];
  episodes?: Episode[];
  syncData?: Record<string, string>;
}

interface Episode {
  name?: string;
  episode: number;          // 1-indexed within season
  season: number;
  data: string;             // opaque id passed back to loadLinks
  description?: string;
  posterUrl?: string;
  date?: string;
}

interface ExtractorLink {
  name: string;             // "InternetArchive", "GenericM3U8", …
  type: ExtractorLinkType;  // M3U8 | VIDEO | DASH | TORRENT | MAGNET
  url: string;
  referer?: string;
  quality: Qualities;       // Q360 | Q480 | Q720 | Q1080 | Q4K | Unknown
  headers?: Record<string, string>;
  isM3u8?: boolean;
}

interface SubtitleData {
  url: string;
  lang: string;             // BCP-47 IETF tag ("en", "pt-br")
  label?: string;
  format?: "vtt" | "srt" | "ass";
}

enum TvType {
  Movie = "Movie",
  TvSeries = "TvSeries",
  Anime = "Anime",
  Live = "Live",
  Documentary = "Documentary",
  Others = "Others",
}

enum Qualities {
  Q360 = 360,
  Q480 = 480,
  Q720 = 720,
  Q1080 = 1080,
  Q4K = 2160,
  Unknown = 0,
}

enum ExtractorLinkType {
  Video = "Video",
  M3U8 = "M3U8",
  Dash = "Dash",
  Torrent = "Torrent",
  Magnet = "Magnet",
}
```

These mirror the Android types field-for-field (modulo Kotlin's `data class` vs
TypeScript's `interface`).

---

## The ExtractorApi Contract

`loadLinks` returns `ExtractorLink`s. Some of those links are direct playable URLs
(e.g. an Internet Archive MP4); others are *page URLs* that need an extractor to
resolve to a stream (e.g. a YouTube watch URL, or an Invidious video page).

The web port's extractor dispatch is a direct port of Android's
`APIHolder.loadExtractor`:

```typescript
abstract class ExtractorApi {
  abstract readonly name: string;
  abstract readonly mainUrl: string;
  readonly requiresReferer: boolean = false;

  /** Resolve a page URL to a playable ExtractorLink. */
  async getUrl(url: string, referer?: string): Promise<ExtractorLink[] | null> {
    throw new Error("getUrl() not implemented");
  }
}

async function loadExtractor(
  url: string,
  referer?: string,
  onSubtitle?: (s: SubtitleData) => void,
): Promise<ExtractorLink[] | null> {
  // 1. Exact-prefix match against each registered extractor's mainUrl.
  for (const ext of extractorRegistry.all()) {
    if (url.startsWith(ext.mainUrl)) {
      const links = await ext.getUrl(url, referer);
      if (links && links.length > 0) return links;
    }
  }

  // 2. Levenshtein-distance fallback — pick the extractor whose mainUrl is
  //    "closest" to the input URL. This handles cases where a site has many
  //    subdomains (e.g. voe.sx, voe-host.net, voe-2.eu) and only one is the
  //    registered mainUrl. Mirrors Android's `getExtractorApiSimilarity`.
  let best: ExtractorApi | null = null;
  let bestDist = Infinity;
  for (const ext of extractorRegistry.all()) {
    const d = levenshtein(new URL(url).hostname, new URL(ext.mainUrl).hostname);
    if (d < bestDist) {
      bestDist = d;
      best = ext;
    }
  }
  if (best && bestDist <= 8) {
    return await best.getUrl(url, referer);
  }

  // 3. Last-resort: if URL ends in .m3u8 or content-type matches, return it as-is
  //    via GenericM3U8. Otherwise return null (link dropped).
  return await genericM3U8.getUrl(url, referer);
}
```

The Levenshtein fallback exists because provider-supplied extractor page URLs are
notoriously inconsistent — a single source site can be reachable under a dozen
subdomains. The threshold of `<= 8` is the same heuristic the Android app uses (it
capped at "distance ≤ ~half the hostname length").

### Built-in extractors

| Extractor         | `mainUrl`                              | Notes                                                        |
| ----------------- | -------------------------------------- | ------------------------------------------------------------ |
| `GenericM3U8`     | `""` (matches anything ending in `.m3u8` / `application/vnd.apple.mpegurl`) | Last-resort. Returns the input URL verbatim. |
| `DirectVideo`     | `""` (matches `.mp4` / `.mkv` / `.webm` / `video/*`) | Returns the input URL verbatim.                              |
| `YouTube`         | `https://www.youtube.com`              | Resolves a watch URL via Invidious' `latest_url` endpoint.   |

---

## The Sync Provider Contract

Sync providers implement the `SyncAPI` abstract class — a port of the Android
`com.lagradost.cloudstream3.syncproviders.SyncAPI`. Three sync providers ship with
the web port (AniList, MAL, LocalList); three more (Kitsu, Simkl, Trakt) are
planned.

### The abstract class

```typescript
abstract class SyncAPI {
  /** Short id, e.g. "AniList", "MAL". Used as the account-namespace prefix. */
  abstract readonly name: string;
  abstract readonly idPrefix: string;       // "aniListId", "malId", …
  abstract readonly mainUrl: string;        // site URL (for OAuth redirect)

  /** Login capability flags. AniList = OAuth2-only; MAL = OAuth2+PKCE; LocalList
   *  = no login (overrides library() only). */
  readonly hasOAuth2: boolean = false;
  readonly hasPin: boolean = false;
  readonly hasInApp: boolean = false;

  // ─── Auth ─────────────────────────────────────────────────────────

  /** Start the OAuth2 flow. Returns a redirect URL the user should be sent to. */
  async loginRedirect(): Promise<string> {
    throw new Error("loginRedirect not implemented");
  }

  /** Handle the OAuth2 callback (parses the `code` from the redirect URL,
   *  exchanges it for an access token, stores it). */
  async handleLoginCallback(params: URLSearchParams): Promise<AuthUser> {
    throw new Error("handleLoginCallback not implemented");
  }

  /** Refresh an expired access token. Returns the new auth data. */
  async refreshToken(auth: AuthData): Promise<AuthData> {
    throw new Error("refreshToken not implemented");
  }

  /** Logout. Revokes tokens server-side and clears local state. */
  async logout(): Promise<void> {}

  // ─── Reads ────────────────────────────────────────────────────────

  /** Get the user's library (the "watching" / "completed" / "planned" lists). */
  async library(): Promise<LibraryList> {
    throw new Error("library not implemented");
  }

  /** Get the user's status on a single item (by id). */
  async status(id: string): Promise<SyncStatus | null> {
    throw new Error("status not implemented");
  }

  /** Look up a single id (provider's native id) by title. Used by the tracker
   *  merge logic — see "Data Flow: Watch Progress Sync" below. */
  async search(query: string): Promise<SyncResult | null> {
    throw new Error("search not implemented");
  }

  /** Resolve the full metadata for a single id (poster, synopsis, …). */
  async load(id: string): Promise<LibraryMetadata | null> {
    throw new Error("load not implemented");
  }

  // ─── Writes ───────────────────────────────────────────────────────

  /** Update the user's status on a single item. The status object can carry
   *  watchedEpisodes, score, isFavorite, maxEpisodes. Returns the new status. */
  async updateStatus(id: string, status: SyncStatus): Promise<SyncStatus | null> {
    throw new Error("updateStatus not implemented");
  }
}
```

### OAuth flows

The web port uses three OAuth shapes, picked per-provider:

| Provider  | Flow                                   | Token storage              |
| --------- | -------------------------------------- | -------------------------- |
| AniList   | Implicit OAuth (`response_type=token`) | `localStorage` (no refresh — AniList tokens don't expire) |
| MAL       | Authorization-code with PKCE           | `localStorage` + refresh-token rotation |
| LocalList | None                                   | n/a                        |

The implicit flow for AniList is the natural choice for a client-side web app — no
client secret to leak. MAL requires PKCE (which is the only flow MAL v2 supports for
confidential-less clients). The Android app's `AuthAPI` supports the same three
flows (plus Pin and in-app login, which we don't need on the web).

### The AccountManager

The `accountManager` is the host-shell-side holder of sync provider instances +
auth state, mirroring Android's `AccountManager`:

```typescript
class AccountManager {
  /** All registered sync providers, instantiated once at app start. */
  readonly syncApis: SyncAPI[] = [aniListApi, malApi, localList];

  /** The currently-active sync provider (for the "logged in" account). */
  active: SyncAPI | null = null;

  /** All logged-in accounts, keyed by `${providerName}:${accountIndex}`. */
  accounts: Map<string, AuthData> = new Map();

  /** Wire LoadResponse.{aniListId, malId} prefixes — mirrors Android's
   *  initMainAPI() which sets malApi.idPrefix etc. on the MainAPI companion. */
  initMainAPI(): void { /* … */ }
}
```

---

## Data Flow: Search → Playback

This is the end-to-end "user searches 'Breaking Bad' → plays an episode" trace,
mirroring the Android F1 trace but in the web port's vocabulary.

```
1.  User types "Breaking Bad" in the search bar
        │
        ▼
2.  useSearch("Breaking Bad")  ── TanStack Query hook
        │  staleTime: 0 (always refetch on query change)
        ▼
3.  fetch('/api/search?q=Breaking+Bad')
        │
        ▼
4.  /api/search route handler
        │  reads enabled providers from providerRegistry
        │  fans out: Promise.allSettled(providers.map(p => p.search(q, 1)))
        │  (concurrent — exactly like Android's APIRepository.search
        │   which uses amap = concurrent map via coroutineScope.async)
        ▼
5.  Each provider's search() issues fetch() calls via /api/proxy
        │  e.g. InternetArchive calls:
        │    /api/proxy?u=https://archive.org/advancedsearch.php?q=Breaking+Bad...
        │
        ▼
6.  /api/proxy  ── the only network egress point
        │  • validates target URL against PROXY_ALLOW_LIST (SSRF protection)
        │  • forwards with the configured user-agent
        │  • enforces a 30s timeout
        │  • returns the body and parsed headers
        ▼
7.  Provider parses the response, returns SearchResponse[]
        │
        ▼
8.  /api/search groups results per provider:
        │  { InternetArchive: [...], Invidious: [...], IPTVOrg: [...] }
        │
        ▼
9.  UI renders the results — one section per provider, plus an "All" view
        │
        ▼
10. User clicks a result → navigates to /?result=InternetArchive:breaking-bad-2008
        │
        ▼
11. useResult("InternetArchive", "breaking-bad-2008")
        │  TanStack Query, staleTime: 10 min (mirrors Android APIRepository.cache)
        ▼
12. fetch('/api/load?provider=InternetArchive&url=breaking-bad-2008')
        │
        ▼
13. provider.load(url) → LoadResponse { episodes: [...], posterUrl, synopsis, ... }
        │
        ▼
14. UI renders the result page: backdrop hero, episode list, tracker badges,
    season switcher, "Play" CTA
        │
        ▼
15. User clicks an episode → useEpisodeLinks(provider, episode.data)
        │  TanStack Query, staleTime: 20 min (mirrors Android RepoLinkGenerator.cache)
        ▼
16. fetch('/api/links?provider=InternetArchive&episodeId=...')
        │
        ▼
17. provider.loadLinks(data, isCasting=false, onSub, onLink) {
        │    // typically: fetch the episode page, extract embed URLs,
        │    //             call onLink({ url, type, ... }) for each
        │  }
        ▼
18. For each ExtractorLink whose URL is a page (not a stream), call loadExtractor()
        │  → dispatches to the right ExtractorApi via the prefix-match + Levenshtein
        │    fallback (see the ExtractorApi contract section)
        ▼
19. UI renders the source picker (sorted by QualityDataHelper priority)
        │
        ▼
20. User picks a source → HLS.js loads the URL through /api/proxy for segments
        │  (HLS.js supports a custom loader — we route segment fetches through
        │   /api/proxy so that Referer headers from the ExtractorLink are honored)
        ▼
21. Player plays, fires onTimeUpdate → at 80% we trigger watch-progress sync
        │  (see "Data Flow: Watch Progress Sync" below)
```

### Caching layers (mirroring the Android app)

| Layer                          | Web port                          | Android original                          | TTL  |
| ------------------------------ | --------------------------------- | ----------------------------------------- | ---- |
| Search results                 | TanStack Query default staleTime  | (none — re-fetched each search)           | 0    |
| Result page (load)             | TanStack Query per-(provider,url) | `APIRepository.cache` HashMap             | 10 m |
| Episode links                  | TanStack Query per-episode        | `RepoLinkGenerator.cache` static HashMap  | 20 m |
| Sorted links (source picker)   | `useMemo` per quality profile     | `VideoState.sortedLinks` ConcurrentHashMap | n/a  |

### Thread / coroutine equivalents

The Android app routes everything network through `Dispatchers.IO` (via `ioSafe` /
`ioWork` / `withContext(Dispatchers.IO)`) and back to `Dispatchers.Main` for UI
updates (via `LiveData.postValue` and `runOnUiThread`).

The web port's equivalent is simpler:

- API route handlers run on the Node runtime (server-side) — equivalent to
  `Dispatchers.IO`.
- TanStack Query's `useQuery` runs in the browser, with `select`/`onSuccess`
  callbacks scheduled on the React render cycle — equivalent to
  `Dispatchers.Main`.

There is no web-side equivalent of `ioSafe`'s top-level try/catch + `logError` —
the route handler's `try/catch` + TanStack Query's `onError` cover the same
ground.

---

## Data Flow: Extension Install

The Android app loads extensions as compiled `.dex` plugins from `.cs3` files
(see the F2 trace in the worklog for the full byte-by-byte). The web port does
**not** yet support `.cs3` loading (see [README roadmap](./README.md#roadmap)),
but the registry pattern is in place — extension install is currently "drop a
file in `src/providers/` and restart dev", with the hot-load path stubbed.

### The registry pattern

```
1. src/providers/index.ts  ── module-level: registers all built-in providers
        │  providerRegistry.register(InternetArchiveProvider)
        │  providerRegistry.register(InvidiousProvider)
        │  providerRegistry.register(IPTVOrgProvider)
        │  ...
        │  (eventually: providerRegistry.loadCs3(url) for hot-loaded .cs3 files)
        ▼
2. providerRegistry emits a "providers-changed" event
        │  (TanStack Query consumers subscribe via useQuery's queryKey)
        ▼
3. All UI hooks re-fetch:
        │  • useHomeRails()       — rebuilds home rails
        │  • useSearch(q)         — re-runs search across new provider set
        │  • Settings → Providers — re-renders the toggle list
        │
        │  This is the web equivalent of Android's `afterPluginsLoadedEvent`
        │  Event<T> that fires after every plugin reload.
```

### Why this matches Android

The Android app's `APIHolder.allProviders` is a `MutableList<MainAPI>`, mutated
by the plugin loader and observed via the `afterPluginsLoadedEvent` event. The
web port's `providerRegistry` is the same shape: a `Map<string, MainAPI>`,
mutated by `register()`/`unregister()`, observed via TanStack Query's
`invalidateQueries(['providers'])` (which causes all `useQuery` hooks with the
`providers` key prefix to refetch).

The Android app's F2 trace noted several "gotchas" in this flow (no per-plugin
enable/disable, no collision handling, manual refresh needed after
single-plugin install, `SitePlugin` is 14 fields not 16, `cs.repo` has no DNS,
`PREBUILT_REPOSITORIES` is empty). The web port inherits none of these — the
registry is simpler and the per-plugin enable/disable lives in `settingsStore`.

---

## Data Flow: Watch Progress Sync

This is the end-to-end "user crosses 80% playback → sync providers updated"
trace, mirroring the Android F4 trace.

```
1. HLS.js fires MEDIA_ATTACHED + MANIFEST_PARSED, then plays
        │
        ▼
2. <video>.onTimeUpdate fires ~4×/sec
        │
        ▼
3. Player component computes: percentage = currentTime * 100 / duration
        │
        ▼
4. if (percentage >= 80 && !maxEpisodeSet) {
        │    maxEpisodeSet = true   // prevents re-firing (mirrors Android's
        │                            // maxEpisodeSet < meta.episode guard)
        │
        ▼
5. syncManager.modifyMaxEpisode(episodeNum)
        │
        ▼
6. modifyMaxEpisode reads the LoadResponse.syncData map (the
   { aniListId: "123", malId: "456" } the provider returned at load time,
   possibly enriched by the AniList tracker — see the merge below)
        │
        ▼
7. For each (idPrefix, id) in syncData:
        │  • look up the matching SyncAPI by idPrefix in accountManager.syncApis
        │  • call repo.status(id) to get the current watchedEpisodes
        │  • update: maxOf(episodeNum, status.watchedEpisodes)
        │  • call repo.updateStatus(id, newStatus)
        │
        │  Fan-out is concurrent via Promise.allSettled — mirrors Android's
        │  syncs.amap { (prefix, id) -> repo.status → update → repo.updateStatus }
        │
        │  Failures are silent (each .status/.updateStatus is wrapped in
        │  try/catch and logged) — exactly like Android's runCatching + .getOrNull()
        ▼
8. The relevant API calls fire:
        │  • AniList: GraphQL SaveMediaListEntry(mediaId, status, scoreRaw, progress)
        │  • MAL:     PUT /v2/anime/{id}/my_list_status { num_watched_episodes }
        │  • LocalList: skipped (it's read-only — throws NotImplementedError,
        │              which we catch and ignore, exactly like Android)
        ▼
9. After all updates resolve, accountManager.markLibraryStale() fires
        │  TanStack Query's invalidateQueries(['library'])
        │  → useLibrary() refetches on next mount
        ▼
10. UI: the library view refreshes, the new "watched" episode shows up
```

### The tracker merge (mirror of Android `applyMeta + getTracker`)

Before sync, the LoadResponse's `syncData` map is enriched with tracker IDs. The
merge logic is a port of Android's `ResultViewModel2.applyMeta`:

```typescript
function mergeTrackerIds(
  providerSyncData: Record<string, string>,
  tracker: { aniListId?: string; malId?: string; kitsuId?: string },
): Record<string, string> {
  const out = { ...providerSyncData };

  // CONFLICT CHECK: if tracker disagrees with provider, abandon tracker entirely.
  // (Android comment: "getTracker fucked up as it conflicts with current implementation")
  const pairs: [string, string | undefined][] = [
    ["aniListId", tracker.aniListId],
    ["malId", tracker.malId],
    ["kitsuId", tracker.kitsuId],
  ];
  for (const [key, val] of pairs) {
    if (val != null && out[key] != null && out[key] !== val) {
      return out; // preserve provider data; abandon tracker
    }
  }

  // GAP-FILL: provider IDs always win; tracker IDs only fill gaps.
  for (const [key, val] of pairs) {
    if (val != null && out[key] == null) {
      out[key] = val;
    }
  }

  return out;
}
```

This is identical to Android's behavior: the tracker is purely a fallback
metadata enrichment; it never overrides what the provider returned.

### Note on the `episode_sync_enabled_key` Android bug

The Android app has a known issue (see [BUGS.md](./BUGS.md) bug #16): the
`episode_sync_enabled_key` preference only guards the local `maxEpisodeSet`
assignment, **not** the actual `sync.modifyMaxEpisode` call. The web port fixes
this — the setting gates the entire `modifyMaxEpisode` invocation:

```typescript
if (percentage >= 80 && !maxEpisodeSet && settingsStore.syncEnabled) {
  maxEpisodeSet = true;
  syncManager.modifyMaxEpisode(episodeNum); // gated
}
```

---

## State Management

The web port uses two state libraries, picked to match the Android app's
separation of concerns:

### Zustand stores (client UI state)

The Android app uses `ViewModel` + `LiveData` for UI state and SharedPreferences
for persisted settings. The web port uses Zustand for both, with the `persist`
middleware handling the SharedPreferences-equivalent role.

| Store                  | Persisted | Purpose                                                       |
| ---------------------- | --------- | ------------------------------------------------------------- |
| `settingsStore`        | ✅        | Provider toggles, default quality profile, subtitle styling, preferred audio language |
| `libraryStore`         | ✅        | Last-known library state (for instant render before refetch)  |
| `syncAccountStore`     | ✅        | Active account, OAuth tokens (note: tokens in localStorage is acceptable for AniList implicit OAuth; MAL PKCE tokens are short-lived + rotated) |
| `providerRegistryStore` | ❌        | In-memory registry of currently-loaded providers (rebuilt on app start) |
| `playerStore`          | ❌        | Current episode, current source, play position, subtitle track |

What's **persisted** (survives reload): settings, library snapshot, sync auth.
What's **not persisted** (rebuilt on reload): registry contents, player state.

### TanStack Query (server state)

For everything that comes from a provider or sync API, the web port uses
TanStack Query. This is the direct equivalent of Android's `APIRepository.cache`
+ `RepoLinkGenerator.cache` + `VideoState.sortedLinks` memoization.

| Query key                          | staleTime | Equivalent Android cache                     |
| ---------------------------------- | --------- | -------------------------------------------- |
| `['home', providerName, railId]`   | 10 min    | `APIRepository.cache` (per-provider load)    |
| `['search', query, providerName]`  | 0         | (none — always refetch on Android)           |
| `['result', providerName, url]`    | 10 min    | `APIRepository.cache` (load)                 |
| `['links', providerName, epId]`    | 20 min    | `RepoLinkGenerator.cache` (per-episode)      |
| `['library']`                      | 5 min     | `LibraryViewModel.reloadPages`               |
| `['sync', providerName, id]`       | 5 min     | (none — sync status is always freshly pulled) |

`invalidateQueries(['providers'])` is the web equivalent of firing
`afterPluginsLoadedEvent` — it cascades to all provider-keyed queries and forces
a refetch across the UI.

---

## HTTP Proxy

### Why a proxy?

Two reasons:

1. **CORS bypass.** Browsers block `fetch()` to third-party hosts unless the host
   sends `Access-Control-Allow-Origin: *` (or the requesting origin). Almost no
   streaming-adjacent site does this. The Android app's `app.get(url)` doesn't
   have this problem — it's a JVM-side OkHttp call. We need a server-side proxy
   to do the equivalent.

2. **SSRF protection.** A naive proxy that accepts any URL would be a wide-open
   SSRF vector (attackers could use it to reach internal services). The proxy
   validates every target URL against an allow-list (`PROXY_ALLOW_LIST` env var)
   and rejects requests to:
   - Private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
     `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`).
   - Link-local and broadcast addresses.
   - Hosts not on the allow-list (when one is configured).

### The proxy contract

```
GET /api/proxy?u={encoded url}&headers={encoded JSON headers}
```

The proxy:

1. Decodes the `u` parameter.
2. Validates the URL's hostname against the SSRF block-list + allow-list.
3. Forwards the request with the configured user-agent, the supplied headers,
   and a 30-second timeout.
4. Returns the body and selected response headers (`Content-Type`,
   `Content-Length`, `Content-Disposition`).

### What the proxy is NOT

- **Not a caching layer.** TanStack Query handles caching client-side; the
  Android app's OkHttp cache is omitted because TanStack Query's staleTime is
  more flexible.
- **Not a Referer injector for player segment fetches.** HLS.js's custom loader
  sets `Referer` directly on the segment request — the proxy just forwards
  whatever headers the caller supplied.

### Equivalent to Android's `app` / `insecureApp`

The Android app has two OkHttp clients in `MainActivity.kt`: `app` (default) and
`insecureApp` (with relaxed SSL). The web port has one proxy with one allow-list;
the SSL-trust-bypass path is not needed (browser fetch handles TLS natively).

Note: the Android `insecureApp` client is itself dead code (see
[BUGS.md](./BUGS.md) bug #18) — initialized but never called. The web port
simply doesn't include it.

---

## Comparison to Android CloudStream

### What's the same

- **MainAPI contract** — every method, every property, every return type
  matches. A provider written for Android (modulo Kotlin→TS syntax differences)
  ports directly.
- **ExtractorApi contract** — `name`, `mainUrl`, `requiresReferer`, `getUrl()`.
  The `loadExtractor` dispatcher (prefix match + Levenshtein fallback) is
  byte-for-byte the same algorithm.
- **SyncAPI contract** — `library()`, `status()`, `updateStatus()`, `search()`,
  `load()`, plus the OAuth capability flags.
- **The 80% / 90% / 50% playback thresholds** for sync / preload / skip-OP.
- **The `QualityDataHelper` priority formula** — `getQualityPriority(profile, closestQuality(q)) + getSourcePriority(profile, source)`, with `AUTO_SKIP_PRIORITY = 10`.
- **The tracker-merge semantics** — provider IDs always win; tracker IDs only
  fill gaps; conflicts abandon the tracker.
- **The `requestedListListeningPercentages` pattern** — instead of polling
  ExoPlayer's position every 100ms, both apps register threshold callbacks. The
  web port uses HLS.js's `MEDIA_ATTACHED` + a custom `onTimeUpdate` filter
  (since HLS.js doesn't expose ExoPlayer's `createMessage` API).
- **The cache TTLs** — 10 min for load, 20 min for episode links.
- **The provider-registry pattern** with an "after-plugins-loaded" event.

### What's different

| Concern                  | Android                                | Web                                            |
| ------------------------ | -------------------------------------- | ---------------------------------------------- |
| Language                 | Kotlin                                 | TypeScript 5                                   |
| Framework                | Native Android + Jetpack               | Next.js 16 (App Router) + React 19             |
| Player                   | ExoPlayer + Media3                     | HLS.js + native `<video>`                      |
| HTTP client              | nicehttp (`app` / `insecureApp`)       | `fetch` via `/api/proxy`                       |
| State (UI)               | `ViewModel` + `LiveData`               | Zustand                                        |
| State (server)           | `APIRepository.cache` + `RepoLinkGenerator.cache` | TanStack Query (`staleTime`)                   |
| Persistence              | SharedPreferences + DataStore          | `localStorage` (via Zustand `persist`)         |
| Plugin format            | `.cs3` (compiled `.dex` + Kotlin SPI)  | Native TS modules in `src/providers/` (no `.cs3` yet) |
| Cloudflare bypass        | `CloudflareKiller` + `WebViewResolver` | (not ported — needs Playwright)                |
| Torrent streaming        | TorrServer integration                 | (not ported)                                   |
| Chromecast / fcast       | CastHelper + MediaRouteProvider        | (not ported)                                   |
| Downloads to disk        | `DownloadWorkManager` + `VideoDownloadManager` | (not ported — would use File System Access API) |
| VideoSkip                | `VideoSkipManager` + AnimeSkip         | (not ported)                                   |
| Number of built-in extractors | 100+                                   | 3 (GenericM3U8, DirectVideo, YouTube)          |
| Number of sync providers | 5 (AniList, MAL, Kitsu, Simkl, LocalList) | 3 (AniList, MAL, LocalList)                    |
| NSFW handling             | `Prerelease` annotation + hidden toggle | `enabled` flag + user toggle in Settings       |

### What's missing (intentionally)

The web port deliberately omits:

- **CloudflareKiller / DdosGuardKiller** — see [BUGS.md](./BUGS.md) bug #19.
  These have zero instantiations in the Android public builds; porting them
  requires a headless-browser equivalent (Playwright) which is research-in-progress.
- **TorrServer** — the Android integration spins up a local TorrServer process
  and crashes on restart (see [BUGS.md](./BUGS.md) bug #28). The web port
  drops torrent/magnet links at the `LOADTYPE_INAPP` filter until a robust
  integration is designed.
- **NewPipeExtractor fork** — the Android app bundles a stale v0.22.1 fork
  (see [BUGS.md](./BUGS.md) bug #20) but actually uses upstream v0.26.3. The
  web port uses Invidious directly for YouTube, sidestepping the issue.
- **All 100+ community extractors** — these are the heart of the Android
  ecosystem but each one is a scraper for a specific copyrighted-content-hosting
  site. The web port ships only the three protocol-level extractors and leaves
  community extractors to community repos (and the user's own discretion).
- **DRM** — the Android app's ClearKey path is not yet ported.

### What's improved

- **The `episode_sync_enabled_key` bug** (Android bug #16) is fixed — the
  setting now gates the actual sync call, not just the local `maxEpisodeSet`.
- **No dead `insecureApp` client** (Android bug #18) — we never create one.
- **No dormant `CloudflareKiller` / `DdosGuardKiller`** (Android bug #19) — we
  don't ship interceptors we don't use.
- **No NewPipeExtractor fork** (Android bug #20) — no stale dependency.
- **No dead IPFS / Fleek / Freenom infrastructure** (Android bugs #21–23) — we
  don't ship dead mirrors.
- **No dormant Fastlane / Discord bot** (Android bugs #14, #24) — release
  engineering is `bun run build && vercel deploy`, period.
- **Subscription end-of-show detection** (Android bug #29) is on the roadmap to
  be implemented before subscriptions ship.
- **Subscription orphan cleanup** (Android bug #30) is on the same roadmap.

---

## How to write a new provider

### Step-by-step

1. **Create the file.**

   ```bash
   touch src/providers/my-provider.ts
   ```

2. **Implement the MainAPI contract.** Here's a complete, minimal example —
   a provider that lists public-domain movies from a hypothetical API:

   ```typescript
   // src/providers/my-provider.ts
   import { MainAPI, TvType, Qualities, ExtractorLinkType } from "@/lib/providers/types";
   import { providerRegistry } from "@/lib/providers/registry";

   export default class MyProvider extends MainAPI {
     override name = "MyProvider";
     override mainUrl = "https://api.example.com";
     override lang = ["en"];
     override supportedTypes = [TvType.Movie, TvType.TvSeries];

     override async search(query: string, page = 1) {
       const res = await fetch(
         `/api/proxy?u=${encodeURIComponent(
           `${this.mainUrl}/search?q=${encodeURIComponent(query)}&page=${page}`,
         )}`,
       );
       const json = await res.json();
       return {
         items: json.results.map((r: any) => ({
           name: r.title,
           url: r.id,
           apiName: this.name,
           type: TvType.Movie,
           posterUrl: r.poster,
         })),
         hasNextPage: json.has_next,
       };
     }

     override async load(url: string) {
       const res = await fetch(
         `/api/proxy?u=${encodeURIComponent(`${this.mainUrl}/item/${url}`)}`,
       );
       const json = await res.json();
       return {
         url,
         apiName: this.name,
         type: TvType.Movie,
         name: json.title,
         posterUrl: json.poster,
         synopsis: json.plot,
         episodes: [
           {
             episode: 1,
             season: 1,
             data: json.stream_id, // passed back to loadLinks
           },
         ],
       };
     }

     override async loadLinks(data, _isCasting, _onSub, onLink) {
       const res = await fetch(
         `/api/proxy?u=${encodeURIComponent(`${this.mainUrl}/stream/${data}`)}`,
       );
       const json = await res.json();
       onLink({
         name: this.name,
         type: ExtractorLinkType.M3U8,
         url: json.hls_url,
         quality: Qualities.Q1080,
         isM3u8: true,
       });
     }
   }
   ```

3. **Register the provider.**

   ```typescript
   // src/providers/index.ts
   import { providerRegistry } from "@/lib/providers/registry";
   import MyProvider from "./my-provider";

   providerRegistry.register(new MyProvider());
   ```

4. **Restart the dev server.** The provider appears in **Settings → Providers**
   and is immediately queryable from the search bar.

### Tips

- **Always go through `/api/proxy`.** Never `fetch()` a third-party host directly —
  the browser will block it on CORS, and you'd bypass SSRF protection.
- **Return `[]` rather than throwing** when a search has no results. TanStack
  Query treats thrown errors as failures; an empty array is a successful
  "nothing here."
- **Use `isCasting` to skip links you know won't work on a remote receiver.**
  Currently the web port doesn't have a remote-receiver path, but the flag is
  plumbed through so future fcast support can use it.
- **If your provider returns torrents or magnets, mark the link type
  `ExtractorLinkType.Torrent` / `Magnet`.** The web port drops these at the
  source-types filter (just like Android's `LOADTYPE_CHROMECAST`), so the user
  won't see them until TorrServer support ships.
- **Don't set `headers.Referer` directly on `ExtractorLink`.** Instead set
  `referer` (the lowercase ExtractorLink field). The HLS.js custom loader reads
  it and sets the `Referer` header on segment fetches through the proxy.

---

## How to write a new extractor

Extractors resolve *page URLs* (e.g. `https://example.com/embed/abc123`) into
*playable stream URLs* (e.g. `https://cdn.example.com/hls/master.m3u8`).

### Step-by-step

1. **Create the file.**

   ```bash
   touch src/extractors/my-extractor.ts
   ```

2. **Implement the ExtractorApi contract.**

   ```typescript
   // src/extractors/my-extractor.ts
   import { ExtractorApi, ExtractorLink, ExtractorLinkType, Qualities } from "@/lib/extractors/types";
   import { extractorRegistry } from "@/lib/extractors/registry";

   export default class MyExtractor extends ExtractorApi {
     override name = "MyExtractor";
     override mainUrl = "https://example.com";
     override requiresReferer = false;

     override async getUrl(url: string, _referer?: string): Promise<ExtractorLink[] | null> {
       const res = await fetch(`/api/proxy?u=${encodeURIComponent(url)}`);
       const html = await res.text();

       // Parse the embed page for the stream URL (regex / DOM parse / etc.)
       const match = html.match(/sources:\s*\[\{[^}]*file:\s*"([^"]+)"/);
       if (!match) return null;

       return [
         {
           name: this.name,
           type: ExtractorLinkType.M3U8,
           url: match[1],
           quality: Qualities.Q1080,
           isM3u8: true,
           headers: { Referer: this.mainUrl },
         },
       ];
     }
   }
   ```

3. **Register the extractor.**

   ```typescript
   // src/extractors/index.ts
   import { extractorRegistry } from "@/lib/extractors/registry";
   import MyExtractor from "./my-extractor";

   extractorRegistry.register(new MyExtractor());
   ```

4. **That's it.** The `loadExtractor()` dispatcher will now match any URL
   starting with `https://example.com` to your extractor, and fall back to it
   via Levenshtein for any `*.example.com` subdomain.

### Tips

- **Return `null` rather than `[]`** if your extractor can't handle the URL —
  this lets the dispatcher fall back to the next candidate. An empty array
  means "I handled this URL but found no streams."
- **Always include `headers.Referer`** if the stream URL requires it. Many
  CDNs check Referer; missing it produces 403s.
- **For multi-quality playlists**, return one `ExtractorLink` per quality. The
  source picker will let the user choose.
- **If the page requires JavaScript to construct the stream URL**, you'll need
  Playwright (not yet integrated). The Android app uses `WebViewResolver` for
  this; the web port will need a server-side equivalent.

---

## How to add a sync provider

Sync providers bridge CloudStream Web with a tracking service (AniList, MAL,
Kitsu, Simkl, Trakt, …). They implement `SyncAPI` (see
[the contract](#the-sync-provider-contract)).

### Step-by-step

1. **Create the file.**

   ```bash
   touch src/sync/my-sync.ts
   ```

2. **Implement the SyncAPI contract.** Here's a skeleton for an OAuth2-based
   provider (the most common shape):

   ```typescript
   // src/sync/my-sync.ts
   import { SyncAPI, SyncStatus, AuthData, AuthUser, LibraryList } from "@/lib/sync/types";

   export default class MySyncApi extends SyncAPI {
     override name = "MySync";
     override idPrefix = "mySyncId";
     override mainUrl = "https://my-sync.example.com";
     override hasOAuth2 = true;

     private clientId = process.env.NEXT_PUBLIC_MYSYNC_CLIENT_ID!;
     private clientSecret = process.env.MYSYNC_CLIENT_SECRET; // server-side only

     override async loginRedirect(): Promise<string> {
       const state = crypto.randomUUID();
       sessionStorage.setItem("my-sync-state", state);
       const params = new URLSearchParams({
         client_id: this.clientId,
         redirect_uri: `${window.location.origin}/api/sync/my-sync/callback`,
         response_type: "code",
         state,
       });
       return `${this.mainUrl}/oauth/authorize?${params}`;
     }

     override async handleLoginCallback(params: URLSearchParams): Promise<AuthUser> {
       // Verify state (CSRF protection).
       if (params.get("state") !== sessionStorage.getItem("my-sync-state")) {
         throw new Error("state mismatch");
       }
       // Exchange code for token (server-side, since it needs the secret).
       const res = await fetch("/api/sync/my-sync/token", {
         method: "POST",
         body: JSON.stringify({ code: params.get("code") }),
       });
       const auth: AuthData = await res.json();
       // Fetch user profile.
       const user = await this.fetchProfile(auth);
       return user;
     }

     override async refreshToken(auth: AuthData): Promise<AuthData> {
       const res = await fetch("/api/sync/my-sync/refresh", {
         method: "POST",
         body: JSON.stringify({ refresh_token: auth.refreshToken }),
       });
       return res.json();
     }

     override async library(): Promise<LibraryList> {
       const auth = await this.freshAuth();
       const res = await fetch(`/api/proxy?u=${encodeURIComponent(
         `${this.mainUrl}/api/library`,
       )}&headers=${encodeURIComponent(JSON.stringify({
         Authorization: `Bearer ${auth.accessToken}`,
       }))}`);
       return res.json();
     }

     override async status(id: string): Promise<SyncStatus | null> {
       const auth = await this.freshAuth();
       const res = await fetch(`/api/proxy?u=${encodeURIComponent(
         `${this.mainUrl}/api/status/${id}`,
       )}&headers=${encodeURIComponent(JSON.stringify({
         Authorization: `Bearer ${auth.accessToken}`,
       }))}`);
       if (res.status === 404) return null;
       return res.json();
     }

     override async updateStatus(id: string, status: SyncStatus): Promise<SyncStatus | null> {
       const auth = await this.freshAuth();
       const res = await fetch(`/api/proxy?u=${encodeURIComponent(
         `${this.mainUrl}/api/status/${id}`,
       )}&headers=${encodeURIComponent(JSON.stringify({
         Authorization: `Bearer ${auth.accessToken}`,
         "Content-Type": "application/json",
       }))}`, {
         method: "PUT",
         body: JSON.stringify(status),
       });
       return res.json();
     }

     private async freshAuth(): Promise<AuthData> {
       const auth = accountManager.getAuth(this.name);
       if (auth.isExpired()) {
         return await this.refreshToken(auth);
       }
       return auth;
     }

     private async fetchProfile(auth: AuthData): Promise<AuthUser> { /* ... */ }
   }
   ```

3. **Register the provider in `accountManager`.**

   ```typescript
   // src/lib/sync/account-manager.ts
   import MySyncApi from "@/sync/my-sync";
   // ...
   this.syncApis = [aniListApi, malApi, localList, new MySyncApi()];
   ```

4. **Add the OAuth callback route.**

   ```typescript
   // src/app/api/sync/my-sync/callback/route.ts
   import { NextResponse } from "next/server";
   import { accountManager } from "@/lib/sync/account-manager";

   export async function GET(req: Request) {
     const params = new URL(req.url).searchParams;
     const user = await accountManager.get("MySync")!.handleLoginCallback(params);
     return NextResponse.redirect(new URL("/settings/sync", req.url));
   }
   ```

5. **Add token-exchange and refresh routes** (`/api/sync/my-sync/token` and
   `/api/sync/my-sync/refresh`). These hold the client secret server-side and
   never expose it to the browser.

6. **Restart the dev server.** The provider appears in **Settings → Sync accounts**.

### Tips

- **Implicit OAuth (response_type=token) is fine for client-only providers** like
  AniList — no secret to leak. Use it whenever the provider supports it.
- **PKCE is required for MAL and any provider that doesn't support implicit
  flow.** Generate a `code_verifier` (random 43-128 char string), derive
  `code_challenge = base64url(sha256(code_verifier))`, send the challenge in the
  redirect, and send the verifier in the token-exchange POST.
- **Never put a client secret in `NEXT_PUBLIC_*`.** Anything with that prefix
  ships to the browser. Put secrets in `process.env.MYSYNC_CLIENT_SECRET`
  (server-side only) and exchange codes through an API route.
- **Make `updateStatus` idempotent.** The 80%-sync code path can re-fire if the
  user scrubs back and forth across the 80% mark (we mitigate with
  `maxEpisodeSet`, but defensive coding is cheap).
- **Return `null` from `status()` for "no entry"** — this lets the library view
  show "not in your list" rather than a fake 0-episode entry.
- **`LocalList` is read-only.** Don't implement `updateStatus()` — let the
  abstract class's `throw new Error(...)` propagate; the caller catches and
  skips, exactly like Android's `runCatching` + `.getOrNull() ?: return@let null`.

---

This concludes the architecture overview. For the catalog of known issues in the
original Android app (which informed many of the design decisions above), see
[BUGS.md](./BUGS.md).
