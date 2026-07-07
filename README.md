# CloudStream for Web

> **CloudStream for Web — extension-based media center, ported from the Android app.**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-GPLv3-blue?logo=gnu&logoColor=white)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

CloudStream Web is a faithful port of the Android
[CloudStream](https://github.com/recloudstream/cloudstream) app architecture to the
web. It preserves the original's core design — a small host shell plus a registry of
loadable providers — and re-implements the **MainAPI contract**, the **ExtractorApi
contract**, and the **SyncAPI contract** in TypeScript on top of Next.js 16.

The UI is a TV-style 10-foot layout: home rails, multi-provider search, a result page
with episode lists, an HLS.js player with a source picker, subtitle support, and a
library backed by sync providers.

---

## Table of contents

- [What is CloudStream Web?](#what-is-cloudstream-web)
- [Features](#features)
- [Architecture](#architecture)
- [Built-in Providers](#built-in-providers)
- [Built-in Extractors](#built-in-extractors)
- [Sync Providers](#sync-providers)
- [Run locally](#run-locally)
- [Deploy](#deploy)
- [Write an extension](#write-an-extension)
- [Settings guide](#settings-guide)
- [Roadmap](#roadmap)
- [Credits](#credits)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## What is CloudStream Web?

CloudStream Web is **not** a streaming site and **not** a re-implementation of the
CloudStream UI in the browser. It is a port of the *architecture* of the original
Android CloudStream app: a thin host shell that hosts **providers**, each of which
implements the **MainAPI** contract (search, load, loadLinks), and a registry that
discovers and instantiates them.

The Android app's value proposition was:

> "Bring your own providers. The app stays clean and legal; the community writes the
> scrapers."

CloudStream Web keeps that exact value proposition — but on the web:

- The host shell is a Next.js 16 application.
- Providers are TypeScript modules that implement the `MainAPI` interface.
- Extractors are TypeScript modules that implement the `ExtractorApi` interface.
- Sync providers (AniList, MAL, …) implement the `SyncAPI` abstract class.
- A built-in HTTP proxy routes all provider traffic so browser CORS restrictions and
  SSRF exposure are handled in one place.

The UI is a TV-first layout: home rails of posters, a multi-provider search bar, a
result page with episode lists, and an HLS.js-backed player with a source picker,
subtitle track selection, and watch-progress sync. The visual language mirrors the
Android app's `GeneratorPlayer`/`ResultFragmentPhone`/`SearchFragment` screens but is
rebuilt from scratch in React + Tailwind + shadcn/ui.

---

## Features

- **Home rails** — provider-supplied lists (trending, popular, new releases) rendered
  as horizontal poster rails, exactly like the Android `HomeFragment`.
- **Multi-provider search** — query all enabled providers in parallel, then group
  results per provider with an "all" view, mirroring `SearchViewModel` +
  `APIRepository.search`.
- **Result page** — poster, backdrop, synopsis, episode list, season switcher,
  tracker badges (AniList/MAL IDs), and a "play" CTA, mirroring
  `ResultFragmentPhone`.
- **HLS.js player with source picker** — every episode yields zero or more
  `ExtractorLink`s; the picker shows them sorted by quality + source priority, exactly
  like `QualityDataHelper` + `selectSourceDialog`.
- **Subtitle support** — sidecar + embedded subtitle tracks surfaced in the player's
  track menu. Language-to-flag resolution uses the same 200-entry IETF map as the
  Android app.
- **Sync providers** — AniList (implicit OAuth), MAL (PKCE), LocalList. Watch progress
  is pushed at 80% playback, mirroring `UPDATE_SYNC_PROGRESS_PERCENTAGE = 80` and the
  `SyncViewModel.modifyMaxEpisode` fan-out.
- **Library** — backed by sync providers' `library()` calls; pulled on app start and
  refreshed after every write.
- **Settings** — provider enable/disable, default quality profile, subtitle styling,
  preferred audio language, sync account management. Persisted via Zustand
  `persist` middleware to `localStorage`.
- **HTTP proxy** — a single Next.js Route Handler (`/api/proxy`) that forwards all
  provider HTTP traffic, adds per-request timeouts, and runs an SSRF allow-list.
  This is the web equivalent of nicehttp's `app`/`insecureApp` client pair.
- **TV-style 10-foot layout** — focus rings, oversized hit targets, a 16:9 backdrop
  hero, and a 4-column poster grid. Works equally well with a mouse, a remote, or a
  keyboard.

---

## Architecture

The port preserves the original's three-layer contract surface:

| Layer               | Android (Kotlin)                                  | Web (TypeScript)                                            |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Provider contract   | `MainAPI` (abstract class, ~2200 lines)           | `MainAPI` (interface + abstract class in `lib/providers/`)  |
| Extractor contract  | `ExtractorApi` (abstract class) + `loadExtractor` | `ExtractorApi` (interface) + `loadExtractor()` dispatcher   |
| Sync contract       | `SyncAPI` (abstract class)                        | `SyncAPI` (abstract class in `lib/sync/`)                   |
| Provider registry   | `APIHolder.allProviders` + `afterPluginsLoadedEvent` | `providerRegistry` (Zustand store) + TanStack Query invalidation |
| State management    | `ViewModel` + `LiveData`                          | Zustand (UI) + TanStack Query (server state)                |
| HTTP client         | nicehttp `app` / `insecureApp`                    | `fetch` via `/api/proxy`                                    |
| Player              | ExoPlayer + Media3                                | HLS.js + native `<video>`                                   |
| Cache               | `APIRepository.cache` (10-min) + `RepoLinkGenerator.cache` (20-min) | TanStack Query `staleTime` (10 min) + per-episode link cache (20 min) |

A deep dive — including the MainAPI, ExtractorApi, and SyncAPI contracts in full, the
data-flow traces for search / playback / extension install / watch-progress sync, and
a side-by-side comparison with the Android app — lives in
**[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Built-in Providers

Three providers ship with the web port, chosen because they need no scraping of
third-party copyrighted content:

| Provider          | Source                              | Content type           | Notes                                                              |
| ----------------- | ----------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| **InternetArchive** | archive.org's advanced search API | Public-domain movies, TV, live music archives | Mirrors the Android `ArchiveProvider` pattern; uses the `metadata` API + `downloads` manifest. |
| **Invidious**       | any public Invidious instance      | YouTube videos, channel rails, search | Configurable instance URL in Settings. No API key needed.          |
| **IPTV-org**        | iptv-org/iptv M3U playlists        | Live TV channels by country | Lazy-loads the per-country M3U; converts each entry to a `LoadResponse` with a single `ExtractorLink` of type `M3U8`. |

Community providers for streaming sites (the kind the original Android app's
ecosystem ships) are intentionally **not** included in this repo. See
[Disclaimer](#disclaimer).

---

## Built-in Extractors

| Extractor         | Purpose                                                         | Android equivalent                          |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------- |
| **GenericM3U8**   | Returns the input URL verbatim if it ends in `.m3u8` / has the right content-type. | `GenericM3U8.kt`                            |
| **DirectVideo**   | Returns the input URL verbatim if it's a direct mp4/mkv/webm.  | (Bundled into `GenericM3U8` on Android)     |
| **YouTube**       | Resolves a YouTube watch URL to a playable stream via Invidious' `latest_url` endpoint. | (Replaces `NewPipeExtractor` on the web)    |

The `loadExtractor()` dispatcher picks the right extractor by URL match (with a
Levenshtein-distance fallback against each extractor's `mainUrl`, exactly like the
Android dispatcher in `APIHolder.loadExtractor`).

The Android app ships 100+ extractors (`Voe`, `Filemoon`, `StreamWish`, `Gdriveplayer`,
`Vidmoly`, etc.). Those are **not** ported — see [Roadmap](#roadmap).

---

## Sync Providers

Sync providers implement the `SyncAPI` abstract class (see
[ARCHITECTURE.md](./ARCHITECTURE.md#the-sync-provider-contract)). Three ship with the
web port:

| Sync provider | Auth flow                       | Write support | Notes                                                        |
| ------------- | ------------------------------- | ------------- | ------------------------------------------------------------ |
| **AniList**   | Implicit OAuth (no client secret on web) | ✅ SaveMediaListEntry mutation via GraphQL | The web port's primary tracker.                              |
| **MAL**       | PKCE OAuth                      | ✅ PUT `/v2/anime/{id}/my_list_status` | Requires a registered MAL OAuth client (client id in Settings). |
| **LocalList** | None — local-only               | ❌ (read-only aggregator, like the Android `LocalList`) | Aggregates the other two into a unified library view.       |

`Kitsu`, `Simkl`, and `Trakt` are **not yet ported** — see [Roadmap](#roadmap).

---

## Run locally

```bash
# 1. Install dependencies
bun install

# 2. Push the Prisma schema to SQLite (used for library cache + HTTP proxy allow-list)
bun run db:push

# 3. Start the dev server (port 3000)
bun run dev
```

Open the **Preview Panel** on the right side of your IDE, or click **"Open in New
Tab"** above it. (Do not try to visit `http://localhost:3000` directly — the sandbox
only exposes the app through the preview gateway.)

Environment variables (all optional, see `.env.example`):

```bash
# Invidious instance to use by default
INVIDIOUS_INSTANCE=https://invidious.fdn.fr

# MAL OAuth client id (required for MAL sync to work)
MAL_CLIENT_ID=your_client_id_here

# HTTP proxy SSRF allow-list (comma-separated CIDRs / host globs)
PROXY_ALLOW_LIST=*.archive.org,*.invidious.io,*.iptv-org.github.io
```

---

## Deploy

### Vercel (recommended)

```bash
vercel deploy --prod
```

- Set the environment variables above in **Project → Settings → Environment Variables**.
- No build step customization is needed — Vercel auto-detects Next.js 16.
- The Prisma SQLite database is replaced with Vercel Postgres in production; the
  schema is unchanged.

### Self-hosted Node

```bash
bun install --production
bun run build
bun run start   # listens on $PORT (default 3000)
```

Reverse-proxy with Caddy / nginx / Traefik. Terminate TLS, set
`X-Forwarded-Proto`, and forward to the Node process.

### Docker

```dockerfile
FROM oven/bun:1.1 AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.1-slim
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "run", "start"]
```

```bash
docker build -t cloudstream-web .
docker run -p 3000:3000 --env-file .env.production cloudstream-web
```

---

## Write an extension

CloudStream Web follows the Android app's "provider as a self-contained module"
pattern. To write a new provider:

1. Create `src/providers/my-provider.ts`.
2. `export default class MyProvider implements MainAPI { … }` — implement `search`,
   `load`, and `loadLinks`. (See the `InternetArchive` provider for a reference.)
3. Register it in `src/providers/index.ts` (the provider registry).
4. Restart the dev server — the provider appears in **Settings → Providers**.

A full step-by-step guide with code, including how to write extractors and sync
providers, is in **[ARCHITECTURE.md](./ARCHITECTURE.md)** under
["How to write a new provider"](/ARCHITECTURE.md#how-to-write-a-new-provider).

---

## Settings guide

Open **Settings** from the top-right gear icon. The panels are:

- **Providers** — toggle each provider on/off. Disabled providers are skipped during
  search and home rails.
- **Quality profiles** — define named profiles (e.g. "Best 1080p", "Mobile data")
  that pin source priorities and preferred resolutions. Mirrors the Android
  `QualityDataHelper.getProfiles()`.
- **Subtitles** — preferred language, font family, font size, outline color,
  background opacity. Live preview attached.
- **Sync accounts** — sign in/out of AniList and MAL, see your library, force a
  refresh.
- **Network** — proxy timeout, SSRF allow-list override, user-agent override.
- **About** — version, links to this README and ARCHITECTURE.md, link to BUGS.md.

All settings persist to `localStorage` via the Zustand `persist` middleware.

---

## Roadmap

What's **in** the web port:

- ✅ MainAPI contract (search / load / loadLinks)
- ✅ ExtractorApi contract + dispatcher
- ✅ SyncAPI contract + AniList/MAL/LocalList
- ✅ HLS.js player with source picker + subtitle menu
- ✅ Watch-progress sync at 80% playback
- ✅ HTTP proxy with SSRF protection
- ✅ Home rails, multi-provider search, result page with episodes
- ✅ Library view backed by sync providers

What's **not yet** ported (in rough priority order):

- ⬜ **`.cs3` extension loading** — the Android app's hot-loadable compiled plugin
  format. The web port currently ships providers as native TS modules; a WebAssembly
  / QuickJS-based `.cs3` loader is planned but not started.
- ⬜ **TorrServer torrent streaming** — the Android app integrates
  [TorrServer](https://github.com/YouROK/TorrServer) to stream `.torrent` / magnet
  links as HLS. The web port drops these links at the `LOADTYPE_INAPP` filter (just
  like `LOADTYPE_CHROMECAST` does on Android).
- ⬜ **DRM (Widevine L3 / ClearKey)** — the Android app's `CLEARKEY_DRM_UUID` path
  (`CS3IPlayer.kt`) is not yet ported; HLS.js supports ClearKey natively but the
  `MainAPI.getVideoInterceptor`-style key callback is not wired up.
- ⬜ **CloudflareKiller / DdosGuardKiller** — the two `okhttp3.Interceptor` subclasses
  exist in the Android source but have **zero instantiations in public builds** (see
  [BUGS.md](./BUGS.md) bug #19). The web port will need a `playwright`-based
  equivalent — research in progress.
- ⬜ **fcast / Chromecast** — the web port does not yet support casting to a remote
  receiver. The Android `CastHelper` flow is documented but the receiver-side
  implementation is non-trivial.
- ⬜ **Downloads to disk** — the Android app's `DownloadWorkManager` + `VideoDownloadManager`
  pipeline (a multi-mirror, multi-thread, resumable downloader) is not ported. The web
  port would use the File System Access API or Service Worker.
- ⬜ **VideoSkip (skip OP/ED)** — the Android app's `VideoSkipManager` integrates
  AnimeSkip + a community stamp API. Not yet ported.
- ⬜ **All 100+ extractors** — `Voe`, `Filemoon`, `StreamWish`, `Vidmoly`, `Gdriveplayer`,
  `Filesim`, `Zplayer`, `Upstream`, `Streamhub2`, `Vidoza`, `LuluStream`, `OkRu`,
  `ByseSX`, … — not ported. The `loadExtractor` dispatcher is in place; community
  extractor modules can be added one-by-one without touching the host.
- ⬜ **Kitsu / Simkl / Trakt sync** — `LocalList` aggregates only AniList + MAL today.

The 30 known bugs / dead-code items in the *original* Android app — which the web port
inherits awareness of — are catalogued in **[BUGS.md](./BUGS.md)**.

---

## Credits

CloudStream Web is a port of, and stands on the shoulders of, the
[**recloudstream**](https://github.com/recloudstream) team's
[CloudStream Android app](https://github.com/recloudstream/cloudstream). All credit
for the original architecture — the MainAPI contract, the ExtractorApi dispatcher, the
SyncAPI design, the quality-profile system, the 80%-sync threshold, the
`requestedListeningPercentages` ExoPlayer Messages, the `Event<T>` pub/sub, the
`ProviderRepository` registry pattern — belongs to them.

This web port:

- Reuses the conceptual architecture (the contracts and the registry).
- Reuses the IETF-language-to-flag map (~200 entries).
- Reuses the `SimklScoreBuilder` delta logic (in the Simkl sync provider, when ported).
- Reuses the `QualityDataHelper` priority formula.
- Reuses the 80% / 90% / 50% playback-percentage constants.

It does **not** bundle any of the Android app's community providers, extractors, or
scrapers. The three built-in providers (InternetArchive, Invidious, IPTV-org) were
chosen because they point at public-domain or first-party content.

---

## License

Copyright (C) 2024–present CloudStream Web contributors.

This program is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later version**.

This program is distributed in the hope that it will be useful, but **without any
warranty**; without even the implied warranty of **merchantability** or **fitness for
a particular purpose**. See the [LICENSE](./LICENSE) file for the full text.

---

## Disclaimer

CloudStream Web is a port of an architecture, not a content source. The application
itself contains **no** content. It is a host shell into which users can install
providers of their choosing.

The three built-in providers point exclusively at public-domain archives
(Internet Archive), first-party APIs (Invidious for YouTube), and openly-licensed
playlists (IPTV-org). Any community-built provider a user installs is their own
responsibility.

**Do not use this software to access content you do not have the legal right to
access.** The authors of CloudStream Web do not host, distribute, or endorse any
content, and accept no liability for how users configure or extend the application.
If your use of this software infringes the copyright of any party, that is solely
your responsibility and your liability — not the authors'.

This disclaimer mirrors the original CloudStream Android project's disclaimer.
