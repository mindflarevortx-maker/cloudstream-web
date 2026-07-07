# CloudStream Web — Extension Loader Design

> **Status:** Proposed (Phase 1 — runtime loader + repository manager).
> **Scope:** How third-party providers written for CloudStream Web are
> fetched, evaluated, sandboxed, and registered at runtime.
> **Out of scope:** The built-in TypeScript provider set
> (`InternetArchiveProvider`, `InvidiousProvider`, `IptvOrgProvider`) — those
> ship in the main bundle and are seeded by `initProviders()`.

---

## 0. Field research: how four real CloudStream repositories work

Before designing the web loader, we studied four community repositories that
target the Android CloudStream app. Their conventions drive the design below.

### 0.1 `self-similarity/MegaRepo` — the meta-installer

- `repo.json` lives on the **`builds` branch**, not `master`/`main`:
  ```json
  {
    "name": "Mega repository",
    "description": "Add all repositories easily.",
    "manifestVersion": 1,
    "pluginLists": ["https://raw.githubusercontent.com/self-similarity/MegaRepo/builds/plugins.json"]
  }
  ```
- `plugins.json` is an array with a **single** entry — `MegaProvider.cs3`.
- `MegaProvider/src/main/kotlin/com/mega/MegaPlugin.kt` is *not* a content
  provider; it's a meta-plugin that, on load, fetches the official
  `recloudstream/cs-repos` `repos-db.json`, parses every entry (entries may
  be either bare strings or `{ "url": "...", "verified": bool }` objects),
  and calls `RepositoryManager.addRepository(...)` for each one. It is a
  "pet the gorilla to install everything" installer — **not** a content
  source.
- **Lesson for web:** the `Plugin` shell (a class annotated
  `@CloudstreamPlugin` with a `load(context)` method) is just a host-side
  hook. The actual work happens in `registerMainAPI(SomeProvider())`. Web
  doesn't need the `Plugin` shell at all — providers can register
  themselves directly.

### 0.2 `phisher98/cloudstream-extensions-phisher` — the largest repo (78 providers, 463★)

- `repo.json` is on `master`, points at `plugins.json` on `builds`.
- The repo's default branch *is* `builds` — **the source code is private**;
  only compiled `.cs3` / `.jar` artifacts are published. (Source for
  phisher98's other providers can be found in the `phisher98/CSX` repo,
  which mirrors the same `Bollyflix`/`CineStream`/`VegaMovies` projects.)
- `plugins.json` schema (key fields):
  ```json
  {
    "url": ".../AllMovieLandProvider.cs3",
    "status": 1,
    "version": 19,
    "name": "AllMovieLandProvider",
    "internalName": "AllMovieLandProvider",
    "authors": ["Phisher98"],
    "language": "hi",
    "tvTypes": ["Movie", "TvSeries", "Cartoon"],
    "iconUrl": ".../icon.png",
    "apiVersion": 1,
    "fileHash": "sha256-…",
    "jarUrl": ".../AllMovieLandProvider.jar",
    "jarHash": "sha256-…"
  }
  ```
- **Languages:** 16 distinct (`hi`, `en`, `ta`, `de`, `fr`, `id`, `pt-br`,
  `ko`, `zh`, `mx`, `bn`, `te`, `fil`, `ru`, `tr`, `ar`) — mostly South Asian.
- **Content types:** `Movie`, `TvSeries`, `Anime`, `AnimeMovie`, `OVA`,
  `AsianDrama`, `Cartoon`, `Live`, `Torrent`, `Music`, `All`.
- **Special patterns:**
  - `StremioAddon` / `StremioX` speak the **Stremio catalog/meta/addons API**
    (cinemeta + kitsu + aiometadata), not a website scraper. Their `load()`
    issues `/{type}/{imdb_id}.json` and `loadLinks()` posts to a Stremio
    addon's `stream/{type}/{id}.json` endpoint.
  - `SuperStream`, `ShowBox`, `Jellyfin` talk to **dedicated backend APIs**
    (SuperStream's signed-URL API, Jellyfin's REST API) — there is no HTML
    scraping at all.
  - `YTS`, `TorraStream` carry `Torrent` in `tvTypes` and return magnet
    links directly.
  - IPTV providers (`CloudPlay`, `IPTVPlayer`, `QuickIPTV`, `PublicSportsIPTV`)
    parse M3U playlists with EPG metadata.
  - `fileHash` + `jarHash` (SHA-256, prefixed with `sha256-`) are checked
    at install time on Android — the web port should likewise pin hashes
    for user-installed plugins.

### 0.3 `SaurabhKaperwan/CSX` — `manifestVersion` 2

- The repo file is named `CS.json` (not `repo.json`) and lives on the
  `builds` branch:
  ```json
  {
    "name": "Megix Repo(Hindi & English)",
    "iconUrl": "https://wsrv.nl/?url=…&mask=circle",
    "manifestVersion": 2,
    "pluginLists": ["https://raw.githubusercontent.com/SaurabhKaperwan/CSX/builds/plugins.json"]
  }
  ```
- 7 providers (`Bollyflix`, `CineStream`, `GDIndex`, `MoviesDrive`,
  `Moviesmod`, `OnlineMoviesHinditProvider`, `VegaMovies`).
- `Bollyflix/build.gradle.kts` shows the modern contract —
  `cloudstream { language; description; authors; status; tvTypes; iconUrl }`.
- `BollyflixProvider.kt` is a textbook CloudStream `MainAPI`:
  - extends `MainAPI()`,
  - sets `mainUrl`, `name`, `hasMainPage`, `lang`, `supportedTypes`,
  - declares `mainPage = mainPageOf("/movies/bollywood/" to "Bollywood Movies", ...)`,
  - implements `getMainPage`, `search`, `load`, `loadLinks`,
  - uses `app.get(url, interceptor = cfKiller).document` for Cloudflare-protected pages,
  - uses `loadExtractor(source, "", subtitleCallback, callback)` to delegate
    to `GDFlix`, `fastdlserver`, etc.
- `CineStreamProvider.kt` is a **meta-provider**: it doesn't scrape a single
  site — it queries Stremio's cinemeta catalog, kitsu, and aiometadata APIs
  to build home rails, then delegates `loadLinks` to its own
  `CineStreamExtractors.invokeAllSources(...)`. It uses
  `app.get("$url.json").text` + `tryParseJson<Home>(json)` — pure JSON,
  no HTML.
- `Bollyflix.kt` (the plugin shell) shows the standard 4-line registration:
  ```kotlin
  registerMainAPI(BollyflixProvider())
  registerExtractorAPI(GDFlix())
  registerExtractorAPI(fastdlserver())
  ```
- **Lesson for web:** `MainAPI` is a thin, ~5-method contract. The same
  contract maps cleanly to a TypeScript interface and (more importantly
  for this design) to a plain JavaScript object literal.

### 0.4 `NivinCNC/CNCVerse-Cloud-Stream-Extension` — multi-language, OTT-mirror heavy

- `CNC.json` is the repo file; `manifestVersion: 1`.
- 35 providers across 5 languages (`ta`, `en`, `bn`, `te`, `ru`) — mostly
  Tamil and other South-Asian languages.
- Provider types:
  - **OTT mirrors** (`CNC Verse`, `CNC Verse Mobile`) — mirror Netflix /
    Disney+ Hotstar / Prime Video / SonyLiv via `NetflixMirrorProvider`,
    `DisneyPlusProvider`, `PrimeVideoMirrorProvider`, etc.
  - **Live TV** (`Cricify`, `LivXow`, `PlayZTV`, `SKTech`, `Sportzx`,
    `TamilUltra`, `RadioIndia`) — sports + 24×7 channels.
  - **Anime** (`AnimeSuge`, `AniKoto`, `BilibiliProvider`).
  - **Audiobooks** (`GoldenAudiobook`, `LibriVoxAudiobook`) — uses
    `TvType.Others` (audiobook).
- `Tamilian.kt` extends `TmdbProvider` (a meta-provider that uses TMDB for
  metadata) and overrides only `loadLinks()`. It:
  1. Calls `app.get("$HOST/tamil/tmdb/${mediaData.tmdbId}")`,
  2. Selects `<script:containsData(function(p,a,c,k,e,d))>`,
  3. Calls `getAndUnpack(it)` — a **JavaScript packer unpacker** — to
     reverse the obfuscated `eval(p,a,c,k,e,d)` payload,
  4. Extracts a token, POSTs to `/player/index.php?data=$token&do=getVideo`
     with `X-Requested-With: XMLHttpRequest`,
  5. Wraps the returned `videoSource` HLS URL with `newExtractorLink(name,
     name, url, ExtractorLinkType.M3U8) { referer; quality; headers }`.
- It also does native Android UI work (Telegram popups, opening URLs in
  external browsers) — code that simply **doesn't exist on web**.
- `BilibiliProvider.kt` is multi-language despite `lang = "ta"`: it speaks
  to `api.bilibili.tv/intl/gateway/web/v2/...` which returns content in
  Hindi / Tagalog / English / Japanese depending on the dub track.

### 0.5 Cross-repo observations

1. **`.cs3` is a ZIP of Dalvik bytecode** — a renamed APK. Inside every
   `.cs3`: `classes.dex`, `AndroidManifest.xml`, `resources.arsc`,
   `META-INF/`. The Android app loads it with a `DexClassLoader`, scans
   for `@CloudstreamPlugin`-annotated `Plugin` subclasses, instantiates
   them, and calls `load(context)`, which then calls `registerMainAPI(...)`
   and `registerExtractorAPI(...)`.
2. **None of this can run in a browser.** There's no Dalvik, no JVM, no
   Android `Context`, no `WebView`, no `DexClassLoader`.
3. **The contract, however, is portable.** A `MainAPI` subclass is just:
   `name`, `mainUrl`, `lang`, `supportedTypes`, `hasMainPage`, `mainPage`,
   and four async methods (`getMainPage`, `search`, `load`, `loadLinks`).
   The runtime helpers it leans on (`app.get`, `loadExtractor`,
   `newExtractorLink`, `fixUrl`, `base64Decode`, `getAndUnpack`,
   `CloudflareKiller`) are also portable — they're HTTP + regex + a JS
   unpacker, all of which run fine in browser JS.
4. **The repo file format is consistent** across all four repos: a top-level
   `repo.json` (sometimes named `CS.json`/`CNC.json`) with `name`,
   `description`, `manifestVersion`, `pluginLists: [url...]`, and a
   `plugins.json` array where each entry has `name`, `internalName`,
   `version`, `authors`, `language`, `tvTypes`, `url`, `iconUrl`,
   `repositoryUrl`, `apiVersion`, `fileHash`, `fileSize`, `status`. The
   only field that points to *runnable* code is `url` — and on Android it
   always points at a `.cs3`.
5. **`manifestVersion` is repo-level (1 or 2)** and currently makes no
   practical difference — both versions use the same `plugins.json` shape.
   We'll honor `manifestVersion: 1` for web (we don't need v2 features).

These observations directly motivate Option D below.

---

## 1. The problem

Android CloudStream's plugin unit is the **`.cs3` file** — a ZIP containing:

```
myprovider.cs3
├── AndroidManifest.xml
├── classes.dex          ← Dalvik bytecode (compiled Kotlin)
├── resources.arsc
└── META-INF/
    ├── MANIFEST.MF
    ├── CLOUDSTREAM.SF
    └── CLOUDSTREAM.RSA  ← APK signature
```

The Android app loads each `.cs3` with a `dalvik.system.DexClassLoader`,
scans the resulting `Class<*>` objects for the `@CloudstreamPlugin`
annotation, instantiates the annotated `Plugin` subclass, and invokes
`Plugin.load(context: Context)`. The `load` body then calls
`registerMainAPI(MyProvider())` and `registerExtractorAPI(MyExtractor())`,
which mutate the global `APIHolder.providers` list.

**This entire pipeline is JVM-only.** Browsers cannot:

- run Dalvik bytecode (`classes.dex`) — V8 runs JavaScript / WebAssembly,
- instantiate Android `Context`, `WebView`, `PackageManager`, `SharedPreferences`,
- load signed APKs,
- use OkHttp interceptors like `CloudflareKiller` (which spawns a headless
  Android `WebView` to solve the CF challenge).

A web port that tried to "load Android `.cs3` files" would have to
**transpile Dalvik → JS at runtime** — there is no such transpiler, and
even if there were, the bytecode would call into `android.*` APIs that
don't exist in a browser.

So the question is not *how to load `.cs3` files in the browser* — it's
*how to let the same ecosystem of community authors write providers that
also work on the web*, without forking every repo.

---

## 2. Solution options

### Option A — TypeScript extensions (write new providers in TS, register at build time)

Authors write `MyProvider.ts` extending `MainAPI`. The provider ships in the
app bundle (or in a separate chunk loaded via `import()`).

- ✅ Type-safe, lint-clean, tree-shakeable.
- ✅ No `eval` — CSP-friendly.
- ❌ Requires every author to recompile the app to add a provider. **Kills
  the entire "Add Repository" UX** that makes CloudStream CloudStream.
- ❌ Authors can't ship updates without the web app shipping a new build.

This is fine for **built-in providers** (Internet Archive, Invidious,
iptv-org) but not for user-installed ones.

### Option B — JavaScript extensions via dynamic `import()` or `eval`

Authors publish `.js` files. The web app fetches the `.js` and either
`import(url)`s it (requires CORS + correct MIME) or `eval()`s it.

- ✅ Real, general-purpose JS — authors can do anything a browser can.
- ❌ `import()` requires the file to be served with
  `Content-Type: text/javascript` and permissive CORS — most static hosts
  (GitHub raw included) send `text/plain` and `access-control-allow-origin: *`,
  which works for `fetch` but **not** for `import()` (which is subject to
  stricter MIME checks). So `import()` is out for community-hosted repos.
- ❌ `eval()` (or `new Function()`) gives the plugin access to the entire
  browser global scope — `window`, `document`, `localStorage`, `fetch`,
  `IndexedDB`, every origin's cookies. A malicious plugin could read the
  user's sync tokens, hijack the player, exfiltrate the watch history.
  Unconstrained `eval` is a non-starter.
- ❌ No defined contract — every plugin author would invent their own
  "how do I make an HTTP request" idiom.

### Option C — JSON config extensions (declarative)

Authors publish a JSON file describing their site:

```json
{
  "name": "Foo Movies",
  "mainUrl": "https://foo.example",
  "search": { "url": "/search?q={query}&page={page}",
              "itemSelector": "div.result",
              "titleSelector": "h3 a", "hrefSelector": "h3 a", ... },
  "load": { ... },
  "loadLinks": { ... }
}
```

The web app interprets the JSON, runs CSS selectors, and synthesizes
`SearchResponse` / `LoadResponse` objects.

- ✅ Zero code execution — trivially safe.
- ✅ Could be authored by non-programmers.
- ❌ **Cannot express** the things real CloudStream providers do:
  - JS packer unpacking (`getAndUnpack`) — Tamilian uses this;
  - base64-encoded URLs (AllMovieLand);
  - signature signing (SuperStream);
  - Stremio addon protocol negotiation;
  - Cloudflare challenge solving;
  - posting AJAX with custom headers (`X-Requested-With: XMLHttpRequest`);
  - JSON payloads with conditional field shapes (`subject` may be string
    *or* array — Internet Archive does this).
  A declarative format expressive enough to cover these becomes a Turing-
  complete DSL — at which point you've reinvented JavaScript badly.
- ❌ No existing community provider would convert to this format — defeats
  the "use the same ecosystem" goal.

### Option D — Hybrid: built-in TS providers + runtime JS provider loader (recommended)

- **Built-in providers** (the ones that ship with the app) are written in
  TypeScript and bundled at build time — Option A.
- **User-installed providers** are written in plain JavaScript, published
  as `.js` files, fetched at runtime, evaluated in a **constrained
  sandbox** that exposes only a small `cs3` runtime API, and wrapped in a
  `MainAPI` adapter before being registered with `APIHolder`.

This is the only option that:

1. Lets community authors ship updates without an app release,
2. Lets the same ecosystem support both Android (Kotlin `.cs3`) and web
   (JS `.js`) — authors can publish both files from the same source repo,
3. Keeps the security surface bounded — plugins see only the `cs3` API,
   not the browser global scope,
4. Reuses the existing `MainAPI` / `APIHolder` / `ExtractorRegistry`
   infrastructure on the web side.

The rest of this document specifies Option D in detail.

---

## 3. Recommended approach: Option D

Two layers:

```
┌──────────────────────────────────────────────────────────────────┐
│  src/lib/cloudstream/providers/*.ts   ← built-in TS providers    │
│  (InternetArchive, Invidious, IptvOrg, …)                        │
│  Seeded by initProviders() at app boot. Compile-time type-safe.  │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  src/lib/cloudstream/loader/         ← runtime loader (NEW)      │
│  ├── runtime.ts        ← the `cs3` API object exposed to JS      │
│  ├── JsProvider.ts     ← Function-eval + MainAPI adapter         │
│  ├── RepositoryManager.ts ← repo.json + plugins.json + localStorage │
│  └── index.ts          ← initUserRepositories() entry point      │
└──────────────────────────────────────────────────────────────────┘
```

Both layers feed into the same `APIHolder` registry, so the rest of the
app (home rails, search dispatch, result view, player) doesn't care
whether a provider is built-in or user-installed.

### 3.1 Why both built-in TS *and* runtime JS?

- **Built-in TS** is what makes the app useful out of the box. A user
  who never adds a repository should still get archive.org, Invidious,
  and iptv-org. These providers can lean on the full TypeScript type
  system and don't have to fit in the `cs3` sandbox.
- **Runtime JS** is what makes the app *extensible*. A user who wants
  `Bollyflix` (Hindi movies) or `Tamilian` (Tamil movies) pastes a repo
  URL, picks the provider from the list, and it's evaluated and
  registered. No app rebuild, no app store, no admin involvement.

The two layers share the same `MainAPI` contract, the same `ExtractorRegistry`,
the same `/api/proxy` HTTP backend, and the same `APIHolder`. The only
difference is *how the provider object comes into existence* — `new` at
boot vs `Function`-eval at runtime.

---

## 4. The runtime JS provider format

A CloudStream Web JS provider is a **plain JavaScript file** that, when
evaluated, returns a single object literal. The object literal implements
the same fields and methods as a Kotlin `MainAPI` subclass:

```javascript
// myprovider.js — a CloudStream Web provider
({
  // --- identity ---
  name: "My Provider",
  mainUrl: "https://example.com",
  lang: "en",
  supportedTypes: ["Movie", "TvSeries"],   // strings, not enum refs
  hasMainPage: true,
  hasDownloadSupport: true,

  // --- home rails (optional) ---
  mainPage: [
    { name: "Trending", url: "/trending" },
    { name: "Movies",   url: "/movies" },
  ],

  async getMainPage(page, request) {
    const res  = await cs3.fetch(this.mainUrl + request.url);
    const doc  = cs3.parseHtml(res.body);
    const items = doc.querySelectorAll("article.card").map(el => ({
      name:  el.querySelector("h3")?.text,
      url:   cs3.fixUrl(el.querySelector("a")?.href, this.mainUrl),
      posterUrl: cs3.fixUrl(el.querySelector("img")?.src, this.mainUrl),
    }));
    return { items: [{ name: request.name, list: items, hasNext: page < 5 }] };
  },

  async search(query, page) {
    const res = await cs3.fetch(`${this.mainUrl}/search?q=${encodeURIComponent(query)}&page=${page}`);
    const doc = cs3.parseHtml(res.body);
    return doc.querySelectorAll("article.card").map(el => ({
      name: el.querySelector("h3")?.text,
      url:  cs3.fixUrl(el.querySelector("a")?.href, this.mainUrl),
      type: "Movie",
      posterUrl: cs3.fixUrl(el.querySelector("img")?.src, this.mainUrl),
    }));
  },

  async load(url) {
    const res = await cs3.fetch(url);
    const doc = cs3.parseHtml(res.body);
    return {
      name: doc.querySelector("h1")?.text,
      url,
      type: "Movie",
      plot: doc.querySelector("meta[name=description]")?.attr("content"),
      posterUrl: cs3.fixUrl(doc.querySelector("img.poster")?.src, this.mainUrl),
      recommendations: [],
    };
  },

  async loadLinks(data, isCasting, subtitleCallback, callback) {
    // `data` is whatever string the load() put into `dataUrl` (often a JSON blob).
    const parsed = JSON.parse(data);
    for (const source of parsed.sources) {
      // Delegate to a built-in extractor (m3u8, filemoon, etc.)…
      const links = await cs3.loadExtractor(source.url, this.mainUrl, subtitleCallback);
      links.forEach(callback);
      // …or synthesize a direct link yourself:
      if (source.direct) {
        callback(cs3.newExtractorLink(
          this.name,                         // source
          source.label,                      // name
          source.url,                        // url
          { type: "M3u8", quality: "1080" }  // options
        ));
      }
    }
    return true;
  },
})
```

### 4.1 Contract details

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | ✅ | Display name; must be unique in `APIHolder`. |
| `mainUrl` | `string` | ✅ | Origin URL; used by `fixUrl` and `APIHolder.getApiFromUrl`. |
| `lang` | `string` | ❌ | ISO 639-1 (`"en"`, `"hi"`, `"ta"`, …). Default `"en"`. |
| `supportedTypes` | `string[]` | ❌ | Strings matching `TvType` enum names. Default `["Movie", "TvSeries"]`. |
| `hasMainPage` | `boolean` | ❌ | Whether home rails are supported. |
| `hasDownloadSupport` | `boolean` | ❌ | Default `true`. |
| `mainPage` | `{name,url}[]` | ❌ | Static home rails. |
| `getMainPage(page, request)` | `async` | ❌ | Returns `{ items: HomePageList[] }`. |
| `search(query, page)` | `async` | ❌ | Returns `SearchResponse[]`. |
| `load(url)` | `async` | ❌ | Returns `LoadResponse`. |
| `loadLinks(data, isCasting, subCb, linkCb)` | `async` | ❌ | Returns `boolean`. |

The shape mirrors `MainAPI` one-to-one. The only difference from the
Kotlin/TS contract is that `supportedTypes` is an array of **strings**
(`"Movie"`, `"TvSeries"`, …) rather than references to a `TvType` enum —
because the JS sandbox doesn't see the TS enum. The `JsProvider` adapter
converts these strings to `TvType` values before registering.

### 4.2 Why an object literal and not a class?

Three reasons:

1. **No `extends` needed.** A class-based plugin would have to do
   `class MyProvider extends MainAPI { ... }` — but `MainAPI` is a TS
   abstract class with private fields and getter/setter injection. We'd
   have to expose it as a global, which leaks implementation details.
   An object literal is a plain bag of methods; the `JsProvider` adapter
   re-binds `this` correctly.
2. **Authoring is simpler.** Authors copy-paste a template, fill in five
   methods, and they're done. No build step, no TypeScript, no
   `tsconfig.json`, no `package.json`.
3. **The sandbox is simpler.** The sandbox `return`s whatever the
   plugin expression evaluates to. If the plugin source is
   `({ ... })`, the sandbox returns that object. If we required a class,
   the plugin would have to `return MyProvider` at the end — easy to
   forget, and the failure mode ("plugin didn't return anything") is
   cryptic.

### 4.3 What about `request` in `getMainPage`?

`request` is the `{name, url}` from `mainPage[i]`. It tells the provider
which rail to fetch. This matches the Kotlin `MainPageRequest` shape
exactly. `page` is 1-indexed.

---

## 5. The `cs3` runtime API

Every JS provider gets a single global named **`cs3`** injected into its
scope. The API surface is deliberately small — six functions plus a
handful of constants. Anything outside this list is `undefined` to the
plugin.

### 5.1 `cs3.fetch(url, options?)` — HTTP via the proxy

```typescript
cs3.fetch(url: string, options?: {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isSuccess: boolean;
}>
```

- Routes through the existing `/api/proxy` backend (server-side `fetch`,
  bypasses CORS, can spoof `User-Agent`).
- All requests are logged + size-capped server-side (1 MiB body).
- A plugin can call `cs3.fetch` thousands of times — the proxy is the
  choke point for abuse prevention.

### 5.2 `cs3.parseHtml(html)` — DOMParser-based HTML parsing

```typescript
cs3.parseHtml(html: string): {
  querySelector(sel: string): Element | null;
  querySelectorAll(sel: string): Element[];
  text: string;
  html: string;
  attr(name: string): string | null;
}
interface Element {
  text: string;
  html: string;
  attr(name: string): string | null;
  querySelector(sel: string): Element | null;
  querySelectorAll(sel: string): Element[];
}
```

This is a thin wrapper over the browser-native `DOMParser`. Plugins do
**not** get a reference to `document` or `window` — they only get the
parsed tree of the HTML they fetched. The wrapper also patches
`querySelectorAll` to return a real `Array` (so `.map`/`.filter` work
without `[].slice.call(...)`).

### 5.3 `cs3.newExtractorLink(source, name, url, options?)` — synthesize a playable link

```typescript
cs3.newExtractorLink(
  source: string,           // provider name (for UI grouping)
  name: string,             // quality label, e.g. "1080p"
  url: string,              // playable URL
  options?: {
    type?: "Video" | "M3u8" | "Dash" | "Torrent" | "Magnet";
    quality?: string;       // "1080", "720", …
    referer?: string;
    headers?: Record<string, string>;
    isM3u8?: boolean;
    isDash?: boolean;
  }
): ExtractorLink
```

Returns a plain object shaped like the TS `ExtractorLink` interface —
the player knows how to consume it.

### 5.4 `cs3.loadExtractor(url, referer?, subtitleCallback?)` — dispatch to built-in extractors

```typescript
cs3.loadExtractor(
  url: string,
  referer?: string,
  subtitleCallback?: (sub: SubtitleFile) => void
): Promise<ExtractorLink[]>
```

Delegates to `ExtractorRegistry.loadExtractor(url, referer, subtitleCallback)`,
which reverse-iterates the registered extractors (`GenericM3U8Extractor`,
`DirectVideoExtractor`, `YouTubeExtractor`, …) and returns the first
match. This lets a plugin say "I don't know what host this is — figure
it out."

### 5.5 `cs3.fixUrl(url, base)` — resolve relative URLs

```typescript
cs3.fixUrl(url: string, base?: string): string
```

Wraps `new URL(url, base || this.mainUrl).toString()`, with fallbacks
for protocol-relative (`//host/...`) and root-relative (`/path`) URLs.
This is the single most-used helper in real CloudStream providers —
every provider calls it dozens of times.

### 5.6 `cs3.base64Decode(str)` / `cs3.base64Encode(str)` — base64 utilities

```typescript
cs3.base64Decode(str: string): string
cs3.base64Encode(str: string): string
```

Many providers (AllMovieLand, Bollyflix's `bypass()` helper) store
obfuscated URLs as base64. These wrap `atob`/`btoa` with UTF-8 safety.

### 5.7 `cs3.unpackJs(packedScript)` — JavaScript packer unpacker

```typescript
cs3.unpackJs(packedScript: string): string
```

Port of the Kotlin `getAndUnpack()` utility — reverses the
`eval(function(p,a,c,k,e,d){...})` obfuscation used by ad-driven
streaming sites. Tamilian (and many phisher98 providers) need this.

### 5.8 Constants

`cs3.TvType` — a frozen object mirroring the `TvType` enum:
`{ Movie: "Movie", TvSeries: "TvSeries", Anime: "Anime", ... }`.
Plugins that want to be explicit about types can use
`cs3.TvType.Movie` instead of the string `"Movie"`.

### 5.9 What's intentionally NOT in `cs3`

- **`fetch`** (the browser global) — plugins must go through `cs3.fetch`
  so the proxy sees every request.
- **`window`, `document`, `localStorage`** — none of these are exposed.
- **`eval`, `Function`** — nested code eval is blocked.
- **`import`, `require`** — no module system. A plugin is one file.
- **`process`, `global`** — no Node.js surface.
- **`XMLHttpRequest`** — superseded by `cs3.fetch`.
- **`IndexedDB`, `Cookies`, `cache`** — plugins are stateless across
  reloads; persistence is the app's job, not the plugin's.

---

## 6. Security

### 6.1 Sandbox construction

The plugin source is evaluated in a `Function` constructor:

```typescript
const fn = new Function(
  "cs3",            // the runtime API object
  "console",        // sandboxed console (log/warn/error → window.console)
  "JSON", "Math", "Date", "RegExp", "Error", "Promise",
  "Array", "Object", "String", "Number", "Boolean",
  `"use strict";\nreturn (${pluginSource});`
);
const providerObject = fn(cs3, sandboxConsole, JSON, Math, Date, RegExp, Error, Promise, Array, Object, String, Number, Boolean);
```

Because the only free variables in the function body are the named
parameters, the plugin **cannot see** `window`, `document`, `globalThis`,
`localStorage`, `fetch`, `XMLHttpRequest`, `process`, `require`, or any
other ambient global. If it tries to reference one, it gets a
`ReferenceError`.

This is not a perfect sandbox — a determined attacker could escape via
prototype-chain walks (`({}).constructor.constructor("return globalThis")()`),
but:

1. We freeze `Object`, `Function`, `Array` prototypes at app boot to
   close the obvious escape hatches,
2. The plugin can only do what `cs3.fetch` lets it do — and `cs3.fetch`
   is server-side proxied, logged, and rate-limited,
3. The plugin runs in the same origin as the app, so the worst it can
   do is mess with the in-memory `APIHolder` registry — which is reset
   on every page reload,
4. **User-installed plugins are opt-in.** A user who pastes a repo URL
   is implicitly trusting that repo. The sandbox protects against
   *bugs* (a plugin that accidentally clobbers a global) and *casual*
   abuse (a plugin that tries `localStorage.getItem("anilist-token")`),
   not against a determined attacker who has convinced the user to
   install their plugin. Same trust model as browser extensions.

### 6.2 Content Security Policy

The app's CSP includes `'unsafe-eval'` only on routes that need to load
plugins (the settings page). The player and home pages have a stricter
CSP. This is enforced by the Next.js middleware.

### 6.3 Hash pinning (optional, recommended)

When a user installs a plugin, the `plugins.json` entry may include a
`fileHash` field (`"sha256-..."`). The loader computes the SHA-256 of
the fetched `.js` and refuses to register it on mismatch. This is the
same model Android uses for `.cs3` files. Repos without `fileHash` are
allowed but the UI shows a "⚠ unsigned" badge.

### 6.4 Rate limiting

`cs3.fetch` is rate-limited per-provider in the proxy layer (default:
30 requests / minute / provider). A plugin that hammers a host gets
throttled, not blocked — the user sees slower results, not an error.

---

## 7. The "Add Repository" flow

```
┌─────────────────────────────────────────────────────────────────┐
│  User pastes repo.json URL in Settings → Repositories          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  RepositoryManager.addRepository(url)                          │
│  1. normalizeRepoUrl (strip cloudstreamrepo://)                │
│  2. cs3.fetch(url) → repo.json                                 │
│  3. parse: name, description, manifestVersion, pluginLists[]   │
│  4. for each pluginLists[i]:                                  │
│       cs3.fetch(pluginLists[i]) → plugins.json                 │
│       parse: name, internalName, version, language, tvTypes,   │
│               url (must end in .js), iconUrl, fileHash         │
│  5. persist to localStorage["cloudstream-repos"]               │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  UI shows the plugin list with icons, names, languages.        │
│  Each row has an "Install" button.                            │
└─────────────────────────────────────────────────────────────────┘
                            │
              user clicks "Install" on a plugin
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  RepositoryManager.installPlugin(repoUrl, internalName)        │
│  1. look up entry in cached plugins.json                      │
│  2. cs3.fetch(entry.url) → plugin .js source                   │
│  3. (optional) verify SHA-256 against entry.fileHash           │
│  4. JsProvider.loadFromSource(source) → MainAPI instance       │
│  5. APIHolder.registerProvider(provider)                       │
│  6. persist to localStorage["cloudstream-installed"]           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
            The provider now appears in Home / Search / etc.
```

### 7.1 Cold-start re-hydration

On a page reload, the live `MainAPI` instances are gone (they were
in-memory). `initUserRepositories()` runs at boot, reads the persisted
list of installed plugins, re-fetches each `.js` file, re-evaluates, and
re-registers. This mirrors the existing `repository-store.ts`
re-hydration logic but for the new `cs3`-style plugins.

---

## 8. The repository format for web

A **web repository** is a directory (or GitHub branch) containing:

1. **`repo.json`** — repository manifest.
2. **`plugins.json`** — array of plugin entries.
3. **One `.js` file per plugin** — the actual provider source.

### 8.1 `repo.json`

```json
{
  "name": "My Web Repo",
  "description": "CloudStream Web extensions",
  "manifestVersion": 1,
  "pluginLists": ["https://example.com/plugins.json"]
}
```

- `manifestVersion: 1` — we honor v1 only. (v2 adds per-plugin
  `requiresResource` etc.; not needed on web.)
- `pluginLists` is an array — usually one entry, but the spec allows
  multiple (e.g. a "stable" list and a "beta" list).

### 8.2 `plugins.json`

```json
[
  {
    "name": "MyProvider",
    "internalName": "myprovider",
    "version": 1,
    "description": "Example provider",
    "authors": ["me"],
    "language": "en",
    "tvTypes": ["Movie"],
    "url": "https://example.com/providers/myprovider.js",
    "iconUrl": "https://example.com/icon.png",
    "fileHash": "sha256-abc123...",
    "status": 1
  }
]
```

Field-by-field:

| Field | Required | Notes |
|---|---|---|
| `name` | ✅ | Display name. |
| `internalName` | ✅ | Stable ID for install/uninstall tracking. |
| `version` | ✅ | Integer; bumped on every release. |
| `description` | ❌ | One-liner. |
| `authors` | ❌ | For UI credit. |
| `language` | ❌ | ISO 639-1. Default `"en"`. |
| `tvTypes` | ❌ | Array of `TvType` strings. |
| `url` | ✅ | **Must end in `.js`.** `.cs3` URLs are rejected. |
| `iconUrl` | ❌ | Square PNG/SVG, shown in the plugin list. |
| `fileHash` | ❌ | `sha256-<hex>`. If present, enforced. |
| `status` | ❌ | `0`=down, `1`=ok, `2`=slow, `3`=beta. |
| `apiVersion` | ❌ | Reserved for future API versioning. |

### 8.3 Backwards-compatibility with Android repos

**None, by design.** An Android repo's `plugins.json` points at `.cs3`
files, which the web port can't load. The web port will *refuse* to
install any plugin whose `url` doesn't end in `.js`, and show a
helpful error: "This is an Android-only repository. Web providers must
be `.js` files — see the [Web Provider Authoring Guide]."

This is the right call because:

- Pretending to support `.cs3` and silently failing is worse than a
  clear error.
- The Android and web ecosystems will diverge anyway — web providers
  use `cs3.fetch`, Android providers use `app.get`. A single file that
  works on both would need a polyglot prelude, which is fragile.
- Authors who want to support both platforms publish *two* `plugins.json`
  files — `plugins.android.json` (pointing at `.cs3`) and
  `plugins.web.json` (pointing at `.js`) — and list both in
  `pluginLists`. The web loader skips entries whose URL doesn't end in
  `.js`, so a single mixed list also works.

### 8.4 Sample web repository layout

```
my-web-repo/
├── repo.json
├── plugins.json
├── icons/
│   ├── myprovider.png
│   └── another.png
└── providers/
    ├── myprovider.js
    └── another.js
```

`repo.json`:
```json
{
  "name": "My Web Repo",
  "description": "CloudStream Web extensions",
  "manifestVersion": 1,
  "pluginLists": ["https://example.com/plugins.json"]
}
```

`plugins.json`:
```json
[
  {
    "name": "MyProvider",
    "internalName": "myprovider",
    "version": 1,
    "description": "Example provider",
    "authors": ["me"],
    "language": "en",
    "tvTypes": ["Movie"],
    "url": "https://example.com/providers/myprovider.js",
    "iconUrl": "https://example.com/icons/myprovider.png"
  }
]
```

---

## 9. Implementation map

| File | Responsibility |
|---|---|
| `src/lib/cloudstream/loader/runtime.ts` | The `cs3` API object: `fetch`, `parseHtml`, `newExtractorLink`, `loadExtractor`, `fixUrl`, `base64Decode`, `base64Encode`, `unpackJs`, `TvType`. |
| `src/lib/cloudstream/loader/JsProvider.ts` | `JsProvider.loadFromSource(source, displayName)` — `Function`-eval, sandbox wiring, validation, `MainAPI` adapter wrapping. |
| `src/lib/cloudstream/loader/RepositoryManager.ts` | `addRepository(url)`, `removeRepository(url)`, `installPlugin(...)`, `uninstallPlugin(...)`, `getRepositories()`, `getInstalledPlugins()`. Persists to `localStorage`. |
| `src/lib/cloudstream/loader/index.ts` | `initUserRepositories()` — called at app boot to re-hydrate installed plugins. |

The existing `src/lib/cloudstream/loader.ts` (class-based loader) and
`src/lib/cloudstream/store/repository-store.ts` (Zustand store) remain
untouched — they serve the legacy class-based plugin format. The new
`loader/` directory is the **recommended** path going forward; the
legacy loader is kept for backwards compatibility with any existing
class-based plugins.

---

## 10. Open questions / future work

1. **WebWorker isolation.** Today the plugin runs on the main thread. A
   misbehaving plugin (infinite loop in `loadLinks`) freezes the UI. We
   could run each plugin in a Web Worker with `postMessage`-based
   `cs3.fetch` — adds latency but improves resilience. Defer until we
   see a real freeze in production.
2. **TypeScript authoring support.** Authors who want types can write
   `.ts` and compile to `.js` themselves; we don't need to ship a
   TS compiler in the browser. But we *should* publish a `@cloudstream/web-provider-types`
   npm package with the `MainAPI` interface and the `cs3` API types, so
   authors get autocomplete.
3. **Extractor plugins.** The current design only loads `MainAPI`
   providers. The Kotlin `Plugin.load` can also `registerExtractorAPI(...)`.
   Web extractors are currently all built-in; we may want to allow
   user-installed extractors in the future. Same mechanism — just a
   different sandbox shape.
4. **Plugin permissions.** A plugin that only needs `cs3.fetch` to one
   host shouldn't be able to fetch arbitrary URLs. We could add a
   `permissions: ["fetch:example.com"]` field to `plugins.json` and
   enforce it in the proxy. Defer until we see abuse.
5. **Signing.** `fileHash` pins a specific version. For author-verified
   updates, we could add Ed25519 signing (`signature` field in
   `plugins.json`, public key in `repo.json`). Defer.

---

## 11. Summary

The Android `.cs3` format cannot run in a browser — Dalvik bytecode,
JVM-only libraries, and Android `Context` dependencies make it
fundamentally incompatible with the web runtime. Rather than attempt an
impossible transpiler, CloudStream Web introduces a **parallel `.js`
provider format** that mirrors the Kotlin `MainAPI` contract in plain
JavaScript. A small, security-bounded `cs3` runtime API gives plugins
the HTTP, HTML-parsing, extractor-dispatch, and URL-fixing utilities
they need without exposing the browser global scope. A `Function`-based
sandbox evaluates plugin source at runtime, wraps the resulting object
literal in a `MainAPI` adapter, and registers it with the same
`APIHolder` used by built-in TypeScript providers. Repositories follow
the same `repo.json` + `plugins.json` shape as Android repos, with the
single constraint that `url` must point at a `.js` file. This lets the
existing community ecosystem extend the web port without forking every
provider — authors publish a `.js` alongside their `.cs3`, and users
install them with the same "Add Repository" UX they already know.
