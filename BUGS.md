# BUGS — CloudStream Android (Original) — 30-Item Inventory

This document catalogs 30 bugs / dead-code items / security concerns found in the
**original CloudStream Android app** (the upstream
[`recloudstream/cloudstream`](https://github.com/recloudstream/cloudstream) repo)
during Task F-series exploration (F1–F12).

The CloudStream **Web** port (this repo) inherits awareness of these issues and
deliberately does **not** reproduce them. Each entry below describes the issue in
the Android original and notes whether the web port sidesteps, fixes, or is
unaffected.

> Paths are relative to the Android repo root
> (`repo/cloudstream/` in the worklog's exploration tree). Line numbers refer to
> the version of the source the F-series agents read.

---

## Table of contents

- [Severity legend](#severity-legend)
- [Category legend](#category-legend)
- [Bugs #1 – #30](#bugs)
- [Summary by category](#summary-by-category)
- [Summary by severity](#summary-by-severity)
- [What the web port does about these](#what-the-web-port-does-about-these)

---

## Severity legend

| Severity  | Meaning                                                                |
| --------- | ---------------------------------------------------------------------- |
| Critical  | Crashes the app, leaks secrets, or breaks a core feature for all users |
| High      | Breaks a feature for some users, or wastes significant resources        |
| Medium    | Degrades UX, or breaks a feature only edge-case users hit               |
| Low       | Minor annoyance, dead code with no runtime impact                       |
| Info      | Documentation / metadata issue, no runtime impact at all                |

## Category legend

| Category       | Meaning                                                       |
| -------------- | ------------------------------------------------------------- |
| Bug            | A runtime defect — wrong behavior, crash, or stuck state      |
| Dead Code      | Code that's defined but never called / never reachable        |
| Security       | Vulnerability, exposure, or footgun                          |
| Documentation  | Wrong / missing / outdated docs                               |
| Maintenance    | Stale dependency, dormant infra, future-rot risk              |

---

## Bugs

### Bug #1: `MainActivity.kt` in the library is misnamed (it's a global HTTP client holder, not an Activity)
- **Severity:** Low
- **Category:** Maintenance
- **Location:** `library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainActivity.kt:25-50`
- **Description:** The `library` module's `MainActivity.kt` file declares the global `app` and `insecureApp` `Requests` instances (the project-wide OkHttp holders / nicehttp clients). The class is named `MainActivity` and lives in a file named `MainActivity.kt`, but it is **not** an Android `Activity` — it has no `onCreate`, no `Activity` superclass, and is not registered in any manifest. The name was carried over from an early prototype where the HTTP clients did live in the real `MainActivity`, and the file was never renamed when they were extracted into the library module.
- **Impact:** Purely a naming / discoverability problem. New contributors searching for "where is the HTTP client set up" naturally look for `HttpClient.kt` or `Network.kt`; the actual file is hidden behind an Activity-shaped name. It also confuses static-analysis tools (any rule keyed on "files named `*Activity.kt` must extend `Activity`" fires false positives).
- **Suggested Fix:** Rename the file (and the class) to `HttpClient.kt` / `HttpClient`. Update the ~30 call-sites that import `com.lagradost.cloudstream3.MainActivity.app`. The web port sidesteps this entirely — there is no `MainActivity`; the HTTP egress is the `/api/proxy` route handler.

---

### Bug #2: `VideoDownloadRestartReceiver` is `enabled="false"` in the manifest — dead code
- **Severity:** Low
- **Category:** Dead Code
- **Location:** `app/src/main/AndroidManifest.xml` (the `<receiver android:name=".receivers.VideoDownloadRestartReceiver" android:enabled="false">` entry); receiver class at `app/src/main/java/com/lagradost/cloudstream3/receivers/VideoDownloadRestartReceiver.kt`
- **Description:** The manifest declares `VideoDownloadRestartReceiver` with `android:enabled="false"`. A `BroadcastReceiver` declared with `enabled="false"` in the manifest is **never instantiated by the system** — `PackageManager.setComponentEnabledSetting()` would need to be called at runtime to enable it, but no such call exists in the app. The receiver is dead: it has an `onReceive` that listens for `BOOT_COMPLETED` to restart interrupted downloads, but the system never delivers the broadcast.
- **Impact:** The "restart downloads after device reboot" feature silently does not work. Users who reboot mid-download lose their progress (the partial file is orphaned but never resumed). The receiver also adds ~50 lines of unreachable code that must be maintained.
- **Suggested Fix:** Either delete the receiver and its manifest entry (accept the lost-feature cost), or wire up `setComponentEnabledSetting(..., ENABLED, ...)` from `DownloadWorkManager.enqueue()` so the receiver is enabled only while a download is in progress (the standard pattern for boot-receivers that should be dormant most of the time). The web port doesn't have downloads at all, so this is moot.

---

### Bug #3: `TvFocus` object (~270 lines) — `ANIMATED_OUTLINE = false` disables the entire subsystem
- **Severity:** Medium
- **Category:** Dead Code
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/ui/tv/TvFocus.kt` (the `object TvFocus` declaration; the `const val ANIMATED_OUTLINE = false` constant near the top)
- **Description:** `TvFocus` is a 270-line object that implements an animated focus-outline system for TV remote navigation — custom `OnFocusChangeListener`s, `ViewTreeObserver.OnGlobalFocusChangeListener`s, animated stroke drawables, etc. The whole thing is gated behind `const val ANIMATED_OUTLINE = false`, which means none of the listeners are ever attached. Every `TvFocus.bind(view)` call short-circuits at the constant check and does nothing.
- **Impact:** 270 lines of dead code that must be maintained. Worse, every developer reading `TvFocus.bind(someView)` in the TV fragments reasonably assumes *something* is happening — but nothing is. The TV focus outline reverts to the default Android `focusable`-on-`CardView` styling, which is fine but undocumented. The subsystem was clearly an experiment that was disabled (probably due to performance) but never removed.
- **Suggested Fix:** Either delete the object entirely (and remove all `TvFocus.bind()` call sites — they're no-ops anyway), or wire the constant to a BuildConfig flag / runtime setting so users on high-end TV hardware can opt in. The web port uses CSS focus rings (`focus-visible:ring-2`), which gives the equivalent behavior with zero dead code.

---

### Bug #4: `CenterZoomLayoutManager` + `LinearRecycleViewLayoutManager` — zero references, dead
- **Severity:** Low
- **Category:** Dead Code
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/ui/CenterZoomLayoutManager.kt` and `app/src/main/java/com/lagradost/cloudstream3/ui/LinearRecycleViewLayoutManager.kt`
- **Description:** Both files define custom `RecyclerView.LayoutManager` subclasses (a center-zoom carousel layout and a horizontal linear layout with focus-aware centering, respectively). A repo-wide search finds **zero** `LayoutManager` instantiation sites that reference either class. Every `RecyclerView` in the app uses either `GridLayoutManager`, `LinearLayoutManager`, or the home-screen's `HomeFragment`-specific layout managers — never these two.
- **Impact:** ~400 lines of dead code. The `CenterZoomLayoutManager` in particular is non-trivial (it implements `scrollHorizontallyBy` + child scale-on-scroll, which is fiddly to get right) — maintaining dead fiddly code is a tax on contributors who might wonder "should I use this?".
- **Suggested Fix:** Delete both files. The web port uses CSS `scroll-snap-type: x mandatory` for carousel centering, which is built-in to the browser.

---

### Bug #5: `SubSourceApi` — instantiated but not registered, users can't reach it
- **Severity:** Medium
- **Category:** Dead Code
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/subtitles/SubSourceApi.kt` (the class definition); instantiation site is in `AccountManager` or `SubtitlesManager` (the F5 trace confirms the `SubSourceApi` constructor is called)
- **Description:** `SubSourceApi` is a `SubtitleProvider`-style class that's instantiated at app startup but **never added to the subtitle-provider registry**. As a result, no UI flow can reach it: the subtitle search dialog iterates the registered providers, and `SubSourceApi` is not in the list. The class's `search()` and `load()` methods are reachable only by direct method call, which nothing in the app does.
- **Impact:** Users can't use whatever subtitle source `SubSourceApi` was supposed to provide (the F5 trace notes it appears to be a local sidecar-file-only subtitle provider — i.e. it would surface locally-stored `.srt` files alongside the video). The feature is silently absent. The dead instance also leaks memory (it holds a context reference).
- **Suggested Fix:** Either register it (`subtitleRegistry.register(subSourceApi)`) if the feature is wanted, or delete the class and its instantiation. The web port handles sidecar subtitles in the player directly (file-input element + WebVTT conversion), so no `SubSourceApi` equivalent is needed.

---

### Bug #6: `Filegram.kt` — unregistered extractor, dead
- **Severity:** Medium
- **Category:** Dead Code
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/extractors/Filegram.kt`
- **Description:** `Filegram` is a fully-implemented `ExtractorApi` subclass (it scrapes `filegram.xyz` embed pages for the underlying video URL) that is **not registered** in the extractor registry (`APIHolder.extractorApis` / wherever the extractor list is built). Because the `loadExtractor` dispatcher only iterates registered extractors, `Filegram` is unreachable — even when a provider returns a `filegram.xyz` URL, the dispatcher's Levenshtein fallback picks a *different* extractor (whichever has the closest `mainUrl`), and `Filegram` is never called.
- **Impact:** Users who install a provider that returns `filegram.xyz` embed URLs get broken playback (the wrong extractor is selected, fails, the link is dropped). The `Filegram.kt` source itself is wasted maintenance.
- **Suggested Fix:** Add `Filegram()` to the extractor registry's initialization list. Or delete `Filegram.kt` if the site is dead / unreliable. (Many such one-off extractors in the Android repo are abandoned by their original authors.)

---

### Bug #7: `Streamhub` is shadowed by `Streamhub2`
- **Severity:** Low
- **Category:** Dead Code
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/extractors/Streamhub.kt` (the `Streamhub` class) and `app/src/main/java/com/lagradost/cloudstream3/extractors/Streamhub2.kt` (the `Streamhub2` class); both register in the extractor list, with `Streamhub2` registered later
- **Description:** `Streamhub` (the original extractor for `streamhub.gg`) and `Streamhub2` (a re-implementation that handles the site's updated page structure) are **both** registered. The `loadExtractor` dispatcher's prefix-match logic picks the **first** registered extractor whose `mainUrl` is a prefix of the input URL — and because both classes declare `mainUrl = "https://streamhub.gg"`, whichever is registered **first** wins. The registration order puts `Streamhub2` *after* `Streamhub`, so `Streamhub` (the old, broken one) wins, and `Streamhub2` is never called.
- **Impact:** Users get the broken old extractor for `streamhub.gg` URLs. `Streamhub2` is dead weight. (Either the registration order is wrong, or the original `Streamhub` should have been deleted when `Streamhub2` was added.)
- **Suggested Fix:** Delete `Streamhub.kt`. The `2` suffix on `Streamhub2` was presumably intended as a temporary "v2 alongside v1" but the migration was never finished.

---

### Bug #8: `Vids.kt` — leading-space typo in `mainUrl`
- **Severity:** High
- **Category:** Bug
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/extractors/Vids.kt` (the `override val mainUrl: String = " https://vids.xxx"` line — note the leading space)
- **Description:** `Vids`'s `mainUrl` is declared with a **leading space** (`" https://..."` instead of `"https://..."`). This breaks the `loadExtractor` dispatcher's prefix match in two ways: (1) `url.startsWith(mainUrl)` never returns true because real URLs never start with a space; (2) the Levenshtein fallback computes distance against `" https://vids.xxx"`, which is 1 greater than it should be, potentially pushing it past the similarity threshold. The extractor is effectively unreachable for the prefix match path and only spuriously reachable via Levenshtein fallback.
- **Impact:** Extractor dispatch silently fails for `vids.xxx` URLs in the common case. Users see "no sources found" for content that should be playable.
- **Suggested Fix:** Remove the leading space. Add a unit test that asserts every extractor's `mainUrl` starts with `http://` or `https://`.

---

### Bug #9: `VidStack.kt` — local `object AesHelper` shadows helper version
- **Severity:** Medium
- **Category:** Bug
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/extractors/VidStack.kt` (the `private object AesHelper { ... }` declaration near the top of the file)
- **Description:** `VidStack.kt` declares its own `private object AesHelper` (a small AES-CBC encrypt/decrypt helper) that **shadows** the project-wide `AesHelper` from `com.lagradost.cloudstream3.utils.AesHelper`. The two implementations are *slightly different* — the local one uses a hardcoded IV and the helper one uses a per-call IV. Inside `VidStack.kt`, calls to `AesHelper.encrypt(...)` resolve to the local one (because Kotlin's name resolution picks the closest scope), while everywhere else in the project they resolve to the helper.
- **Impact:** Crypto behavior is inconsistent and surprising. A developer reading `VidStack.kt`'s `AesHelper.encrypt` call assumes it's the standard helper — but it's not. If the helper's behavior is ever fixed (e.g. to use a properly-random IV), `VidStack` won't pick up the fix. The local copy also re-implements crypto, which is a security anti-pattern.
- **Suggested Fix:** Delete the local `AesHelper` and use the project-wide one. If the hardcoded-IV behavior is load-bearing for `VidStack` (because the site's crypto requires it), make that explicit by passing the IV as a parameter to the helper, not by forking the whole class.

---

### Bug #10: `Zplayer.kt`'s `Upstream` shadows `UpstreamExtractor`
- **Severity:** Medium
- **Category:** Bug
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/extractors/Zplayer.kt` (the `class Upstream : ExtractorApi() { ... }` declaration); shadowed class at `app/src/main/java/com/lagradost/cloudstream3/extractors/UpstreamExtractor.kt`
- **Description:** `Zplayer.kt` declares an inner class named `Upstream` (an extractor for the upstream player at `upstream.to`). There is also a separate top-level class `UpstreamExtractor` for the same site. Both are registered in the extractor list. The dispatcher picks whichever is registered first; depending on init order, one of them is dead. The F9 trace (which cataloged extractors) flagged this as a duplicate-shadow.
- **Impact:** Duplicate extractors for the same site, with the dispatcher silently picking one. The dead one is wasted maintenance. Worse, if the two implementations diverge (one is updated to handle a site change, the other isn't), users get whichever the dispatcher picks — flaky behavior.
- **Suggested Fix:** Delete the duplicate. Keep whichever implementation is more recent / more correct; rename it to a single canonical name (`UpstreamExtractor` is the better name — it follows the project's `*Extractor` convention).

---

### Bug #11: `AnimeSkip.name = "AniSkip"` — typo kept for cache-key stability
- **Severity:** Info
- **Category:** Maintenance
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/ui/player/VideoSkipManager.kt` (or wherever the `AnimeSkip` provider class is declared — the `override val name = "AniSkip"` line)
- **Description:** The `AnimeSkip` provider class declares `override val name = "AniSkip"` (with an "i" instead of the second "e"). This is a typo of the service's actual name, "AnimeSkip". The typo is **deliberately preserved** because `name` is used as a cache key (in `DataStoreHelper`'s skip-stamp cache), and renaming it would invalidate every existing cached stamp — forcing a re-fetch from AnimeSkip for every episode.
- **Impact:** No runtime impact. The displayed name in the UI is also "AniSkip" (the `name` is used directly), which is misleading for users trying to google the service. New contributors reading the source reasonably assume it's a typo and try to "fix" it, breaking the cache.
- **Suggested Fix:** Add a `// Intentional: do not rename — used as cache key` comment on the line. Better long-term fix: introduce a separate `cacheKey` field that's stable, and rename `name` to the correct `"AnimeSkip"`. The web port doesn't yet implement VideoSkip — when it does, it should use a separate `cacheKey` from the start.

---

### Bug #12: `FillerEpisodeCheck.Int.calc()` — anti-tamper decoy (returns 10, sleeps forever)
- **Severity:** Medium
- **Category:** Dead Code
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/ui/player/FillerEpisodeCheck.kt` (an `Int.calc()` extension function — note the receiver-type mismatch: it's declared as `Int.calc()` but the body ignores the receiver)
- **Description:** `FillerEpisodeCheck.Int.calc()` is a decoy / trap function. Its body is something like `fun Int.calc(): Int { Thread.sleep(Long.MAX_VALUE); return 10 }`. The `return 10` is unreachable because `Thread.sleep(Long.MAX_VALUE)` blocks forever. The function is never called by the app's main code path — it appears to exist as an anti-tamper tripwire: a scraper / repackager trying to invoke it (perhaps via reflection, having seen the name in a decompile) hangs the calling thread.
- **Impact:** Dead code. Maintenance burden (anyone reading the file is confused). If a tooling-driven refactor accidentally calls it (e.g. an IDE "auto-extract method" suggestion), the build doesn't fail but the runtime hangs.
- **Suggested Fix:** Delete the function. Anti-tamper through obscurity in an open-source app provides no real protection and confuses contributors.

---

### Bug #13: `AcraApplication.kt` — deprecated stub forwarding to `CloudStreamApp`
- **Severity:** Low
- **Category:** Maintenance
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/AcraApplication.kt`
- **Description:** `AcraApplication.kt` is an empty subclass of `CloudStreamApp` whose only role is to be annotated with ACRA's `@AcraCore` config (the crash-reporting framework). It exists because the project migrated from `AcraApplication` (the older "ACRA-annotated Application subclass") to `CloudStreamApp` (the modern, ACRA-aware Application subclass with its own annotation), but kept the old file as a deprecated stub that just `super`-calls into the new one. The manifest still references `AcraApplication` as the application class — so the stub is load-bearing for nothing but historical compatibility.
- **Impact:** ~30 lines of dead code, plus an indirection layer on the Application class that confuses new contributors ("which Application class is the real one?"). ACRA config is split across two files for no functional reason.
- **Suggested Fix:** Migrate the manifest to point at `CloudStreamApp` directly, move any remaining `@AcraCore` config into `CloudStreamApp`, and delete `AcraApplication.kt`. The web port doesn't use ACRA — errors go to the browser console and Next.js's server logs.

---

### Bug #14: Fastlane is dormant — 49 locale folders but only `changelogs/2.txt`
- **Severity:** Info
- **Category:** Maintenance
- **Location:** `fastlane/` directory tree (`fastlane/metadata/android/en-US/`, etc.) — 49 locale subfolders; `fastlane/metadata/android/en-US/changelogs/` contains only `2.txt` (a single changelog entry for version code 2)
- **Description:** The `fastlane/` directory is set up for F-Droid + Play Store automated metadata (the standard `fastlane/metadata/<locale>/{title,short_description,full_description,changelogs,images}/...` layout), with 49 locale subfolders. But only the `en-US` changelog folder has any content, and that content is a single file (`2.txt`) corresponding to an early version code. No subsequent release has shipped a fastlane changelog entry. The other 48 locale folders contain only the locale's default `title` / `short_description` / `full_description` (no per-release updates, no localized changelogs).
- **Impact:** Fastlane-based release tooling (which the project uses — see bug #15) has nothing to publish. F-Droid users see a stale "version 2" changelog forever. The 49 locale folders create the *impression* of a localization effort that isn't actually maintained.
- **Suggested Fix:** Either commit to maintaining fastlane changelogs (add a `release-notes.md` step to the release checklist that generates `<version>.txt` per locale), or delete the `fastlane/` directory and ship release notes through GitHub Releases only. The web port uses GitHub Releases / Vercel deployment logs — no fastlane equivalent.

---

### Bug #15: `marvinpinto/action-automatic-releases@latest` — archived upstream
- **Severity:** High
- **Category:** Maintenance
- **Location:** `.github/workflows/*.yml` (whichever workflow file drives release automation — the `uses: marvinpinto/action-automatic-releases@latest` line)
- **Description:** The release workflow uses `marvinpinto/action-automatic-releases@latest`, a GitHub Action that auto-creates GitHub Releases on tag push. The action was **archived by its author in 2023** — it's frozen, no longer maintained, and GitHub periodically warns about its use (and may eventually disable it). The `@latest` tag is also a bad practice for CI dependencies (it means "re-run the workflow at HEAD of the action's default branch" — every workflow run could pull a different version).
- **Impact:** A future GitHub Actions runner update may break the workflow entirely (archived actions sometimes stop working when GitHub changes the runner API). The `@latest` tag means the workflow's behavior is non-reproducible — a release today might behave differently from a release yesterday. There's no fix path because the action won't get updates.
- **Suggested Fix:** Replace with one of: (a) `softprops/action-gh-release@v2` (actively maintained, equivalent functionality), (b) `gh release create` in a script step (no third-party action dependency), or (c) `release-drafter/release-drafter@v6` for draft-only releases. Pin to a specific version, not `@latest`. The web port uses Vercel's release flow — no GitHub Action needed.

---

### Bug #16: `episode_sync_enabled_key` only guards `maxEpisodeSet`, NOT the actual sync call (F4)
- **Severity:** High
- **Category:** Bug
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/ui/player/GeneratorPlayer.kt:1659-1728` (specifically the `playerPositionChanged` block — see the F4 trace in the worklog for the exact line-by-line)
- **Description:** The `episode_sync_enabled_key` user preference (default `true`) is intended to let users disable automatic episode-progress syncing to AniList/MAL/Kitsu/Simkl. The relevant block in `GeneratorPlayer.playerPositionChanged`:

  ```kotlin
  if (percentage >= UPDATE_SYNC_PROGRESS_PERCENTAGE && (maxEpisodeSet ?: -1) < meta.episode) {
      context?.let { ctx ->
          val settingsManager = PreferenceManager.getDefaultSharedPreferences(ctx)
          if (settingsManager.getBoolean(ctx.getString(R.string.episode_sync_enabled_key), true))
              maxEpisodeSet = meta.episode    // ← only this assignment is gated
          sync.modifyMaxEpisode(meta.totalEpisodeIndex ?: meta.episode)  // ← NOT gated
      }
  }
  ```

  The `if (episode_sync_enabled_key)` only wraps the local `maxEpisodeSet = meta.episode` assignment — it does **not** wrap the `sync.modifyMaxEpisode(...)` call. So even when the user has disabled episode sync, the call to `sync.modifyMaxEpisode` still fires, which fans out to all logged-in sync providers (`AniList`, `MAL`, `Kitsu`, `Simkl`) and updates their `watchedEpisodes` to the current episode number.

  The `if` does gate the local anti-double-fire guard (`maxEpisodeSet`), which means the disabled-setting path has the *opposite* bug: without `maxEpisodeSet` being set, the sync call fires on **every** position event past 80% (not just once) — until the user crosses back below 80% and re-crosses. With the setting on, it fires exactly once because the second crossing is blocked by `maxEpisodeSet`.

- **Impact:** Users who explicitly disable episode sync (because they don't want their tracker updated, e.g. they're re-watching and don't want to reset their progress) get their tracker updated anyway. Worse, when sync is disabled, the sync fires *multiple times* per episode (every position event past 80%), hammering the tracker APIs.
- **Suggested Fix:** Move the `sync.modifyMaxEpisode(...)` call *inside* the `if (episode_sync_enabled_key)` block. The corrected code should be:

  ```kotlin
  if (percentage >= UPDATE_SYNC_PROGRESS_PERCENTAGE && (maxEpisodeSet ?: -1) < meta.episode) {
      context?.let { ctx ->
          val settingsManager = PreferenceManager.getDefaultSharedPreferences(ctx)
          if (settingsManager.getBoolean(ctx.getString(R.string.episode_sync_enabled_key), true)) {
              maxEpisodeSet = meta.episode
              sync.modifyMaxEpisode(meta.totalEpisodeIndex ?: meta.episode)
          }
      }
  }
  ```

  The web port implements this correctly from the start — see `ARCHITECTURE.md`'s "Watch Progress Sync" section.

---

### Bug #17: Three `Event<T>`s have zero subscribers
- **Severity:** Low
- **Category:** Dead Code
- **Location:**
  - `onAudioFocusEvent` — declared in `app/src/main/java/com/lagradost/cloudstream3/ui/player/IPlayer.kt` (or a sibling events file); the F-series trace found zero `+=` subscription sites anywhere in the repo
  - `applyStyleEvent` (chromecast) — `app/src/main/java/com/lagradost/cloudstream3/ui/subtitles/SubtitlesFragment.kt:99` (`val applyStyleEvent = Event<SaveCaptionStyle>()`); the F5 trace noted that the *local* `applyStyleEvent` is subscribed by `PlayerView` (`PlayerView.kt:394`/`:484`), but the *chromecast-side* `applyStyleEvent` (a separate `Event<T>` declared in `CastHelper` or similar) has no subscribers — chromecast subtitle styling isn't applied
  - `downloadDeleteEvent` — declared in the download subsystem; the F6 trace found zero subscribers
- **Description:** The project's `Event<T>` pub/sub type is the standard way to broadcast cross-component events. Three distinct `Event<T>` instances are declared but **never subscribed to** — meaning `event.invoke(...)` calls to them go nowhere. They're effectively no-ops.
- **Impact:** Dead code in three places. `applyStyleEvent` (chromecast) is the worst of the three: users on Chromecast don't get their subtitle styling applied, because the event the `SubtitlesFragment` fires to communicate style changes to the chromecast renderer has no listener on the chromecast side. The other two (`onAudioFocusEvent`, `downloadDeleteEvent`) appear to be reserved-for-future-use stubs.
- **Suggested Fix:** Delete the truly-unused ones (`onAudioFocusEvent`, `downloadDeleteEvent`). For `applyStyleEvent` (chromecast): either delete (and document that chromecast subtitle styling isn't supported), or wire up the chromecast-side subscriber. The web port has no chromecast support, so this is moot.

---

### Bug #18: `insecureApp` — initialized but NEVER called (unused escape hatch)
- **Severity:** Low
- **Category:** Dead Code
- **Location:** `library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainActivity.kt:30` (the `val insecureApp = Requests(...)` declaration); the F9 trace confirmed zero call sites via grep for `insecureApp` across both the cloudstream repo and the extensions-repo
- **Description:** `insecureApp` is a `Requests` instance (nicehttp wrapper around OkHttp) configured with a relaxed SSL trust manager (it accepts any server cert). It's intended as an escape hatch for providers that hit sites with self-signed or broken TLS — the provider would call `insecureApp.get(url)` instead of `app.get(url)`. The instance is initialized at app startup, but a repo-wide grep for `insecureApp` finds **zero call sites**. No provider or extractor ever uses it.
- **Impact:** ~5 lines of dead code, plus a configured-but-unused OkHttp client (a few KB of memory). Worse, the dead client is a security smell — anyone reading the source assumes it's used somewhere and may copy the pattern into a new provider without realizing the security implications.
- **Suggested Fix:** Delete the `insecureApp` declaration. If a provider ever genuinely needs relaxed SSL (which would be a red flag in itself — most "broken SSL" sites are malicious), it should construct its own one-off client with explicit `// SECURITY: this provider connects to <site> which has <reason> for broken TLS` documentation. The web port has no `insecureApp` equivalent — `/api/proxy` uses the browser's native TLS handling.

---

### Bug #19: `CloudflareKiller` + `DdosGuardKiller` — defined but ZERO instantiations in public builds
- **Severity:** Medium
- **Category:** Dead Code
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/network/CloudflareKiller.kt` (138 lines) and `app/src/main/java/com/lagradost/cloudstream3/network/DdosGuardKiller.kt` (57 lines); the F9 trace grep'd for `CloudflareKiller(`, `DdosGuardKiller(`, `addInterceptor(CloudflareKiller`, `addInterceptor(DdosGuardKiller`, `interceptor\s*=\s*CloudflareKiller|interceptor\s*=\s*DdosGuardKiller` across both `cloudstream` and `extensions-repo` — zero matches
- **Description:** `CloudflareKiller` and `DdosGuardKiller` are `okhttp3.Interceptor` subclasses that solve Cloudflare's "Just a moment…" interstitial and DDoS-Guard's challenge page respectively. They work by spinning up a headless Android `WebView`, loading the protected URL, waiting for the challenge to solve, and extracting the resulting `cf_clearance` / `__ddg1` cookies to attach to subsequent OkHttp requests. The intended opt-in pattern is for a provider to call `app.get(url, interceptor = CloudflareKiller())` — but **no in-tree extension does this**. The two classes are dormant in every public build.
- **Impact:** ~200 lines of dead code. Users assume the app "handles Cloudflare" because the classes exist, but it doesn't (for any built-in provider). Community providers that *would* benefit from Cloudflare bypass can't easily wire it up because there's no working example to copy from.
- **Suggested Fix:** Either (a) delete both classes (acknowledge that Cloudflare bypass is unsupported in the public builds), or (b) wire up at least one provider as a reference example so contributors can copy the pattern. The web port will need a `playwright`-based equivalent (research in progress) — the headless-WebView approach doesn't work in a Node.js server environment.

---

### Bug #20: NewPipeExtractor fork — STALE v0.22.1 from April 2022, app uses upstream v0.26.3
- **Severity:** Medium
- **Category:** Maintenance
- **Location:** `library/build.gradle` (the `implementation "com.github.recloudstream:NewPipeExtractor:..."` line — references the recloudstream fork at v0.22.1); `app/build.gradle` (the `implementation "com.github.TeamNewPipe:NewPipeExtractor:0.26.3"` line — the upstream version actually used)
- **Description:** The project bundles **two** NewPipeExtractor dependencies simultaneously. The `library` module pulls in the recloudstream fork (frozen at v0.22.1, last commit April 2022), and the `app` module pulls in the upstream TeamNewPipe version (v0.26.3, current as of 2024). The two versions coexist on the classpath — Gradle's conflict resolution picks the higher one (v0.26.3) for classes present in both, but any class only in the fork is also available. The fork is essentially dead — it was the project's temporary branch while waiting for upstream to merge a PR, and the PR was merged years ago.
- **Impact:** Stale dependency in the build. The fork adds ~500KB to the build artifact for no benefit. Anyone reading the build files assumes the fork is needed; debugging classpath conflicts (when the fork and upstream disagree on a signature) is wasted time.
- **Suggested Fix:** Drop the fork from `library/build.gradle`. Use upstream NewPipeExtractor everywhere. The web port doesn't use NewPipeExtractor at all — YouTube is handled via Invidious directly.

---

### Bug #21: IPFS / Fleek mirror — dead (DNSLink gone, domain suspended)
- **Severity:** Low
- **Category:** Maintenance
- **Location:** README / docs references to the IPFS / Fleek-hosted mirror (the `cloudstream-on-fleek` / IPFS gateway URLs); also any code that constructs these URLs
- **Description:** The project's docs (and possibly the in-app "About" screen) advertised an IPFS-hosted mirror of the project site, deployed via Fleek's DNSLink integration. The Fleek-hosted DNSLink is gone (Fleek's free tier was deprecated) and the domain was suspended. The URLs in the docs are dead — clicking them returns NXDOMAIN or a Fleek 404.
- **Impact:** Dead documentation links. Users trying to access the IPFS mirror get errors. The IPFS mirror was probably never meaningfully used (the project's main distribution is GitHub Releases + F-Droid), but the dead links are noise.
- **Suggested Fix:** Delete all references to the IPFS / Fleek mirror from the docs and from any code that constructs those URLs. The web port has no IPFS mirror.

---

### Bug #22: `cloudstream.cf` domain — Freenom suspended 2024
- **Severity:** Low
- **Category:** Maintenance
- **Location:** Any code / docs referencing `cloudstream.cf` (Freenom `.cf` TLD)
- **Description:** The project previously owned `cloudstream.cf` (a free Freenom `.cf` domain) — likely for a redirect to the GitHub repo or a docs site. Freenom suspended all `.cf` / `.tk` / `.ml` free domains in 2024 (following a court ruling). `cloudstream.cf` no longer resolves.
- **Impact:** Dead documentation links. Any in-app URL pointing at `cloudstream.cf` returns NXDOMAIN. Users following the docs hit a dead end.
- **Suggested Fix:** Delete all references to `cloudstream.cf`. Replace with the canonical `recloudstream.github.io` (or wherever the docs actually live now). The web port uses the GitHub Pages URL for any cross-references.

---

### Bug #23: `cloudflare-ipfs.com` gateway — Cloudflare shut it down 2022
- **Severity:** Low
- **Category:** Maintenance
- **Location:** Any code / docs referencing `https://cloudflare-ipfs.com/ipfs/...` (the Cloudflare-operated IPFS gateway)
- **Description:** The Cloudflare-operated public IPFS gateway at `cloudflare-ipfs.com` was shut down by Cloudflare in 2022 (the service was deprecated, then removed). Any URL pointing at it returns a Cloudflare 404 / "service discontinued" page. The project's docs (and possibly some hardcoded URLs in the code, e.g. for default poster images) reference this gateway.
- **Impact:** Dead links / broken images. Any IPFS content the docs reference via this gateway is unreachable (the content may still exist on the IPFS network — only the gateway is gone — but the user has no way to find it from the dead URL).
- **Suggested Fix:** Delete all references to `cloudflare-ipfs.com`. If the IPFS content is still needed, use `ipfs.io` (the Protocol Labs gateway) or `dweb.link` (Cloudflare's own replacement). Better: stop depending on IPFS for any user-facing content. The web port has no IPFS dependencies.

---

### Bug #24: `cs-bot` + `discord-commands` — dormant since 2023, reference dead URLs
- **Severity:** Info
- **Category:** Maintenance
- **Location:** `cs-bot/` directory (the Discord bot companion project) and `discord-commands/` directory; referenced URLs in their README / source
- **Description:** The project includes two companion projects — a Discord bot (`cs-bot`) and a Discord slash-commands service (`discord-commands`) — that were last touched in 2023. Both reference Discord application URLs, webhook URLs, and API endpoints that have either changed (Discord's API has evolved) or been revoked (the bot tokens / application IDs in the docs are stale). Neither project is deployed anywhere reachable.
- **Impact:** Two dormant subprojects in the repo, with dead documentation. Contributors who stumble into either directory reasonably assume the project "has a Discord bot" and try to set it up — wasting hours on broken instructions. The dead URLs in the READMEs are also a security smell (revoked tokens shouldn't be in source even as examples).
- **Suggested Fix:** Either archive both directories (move to a separate `archive/` folder or a separate repo with an "unmaintained" note), or delete them. Update the main README to remove any reference to "Discord bot" / "Discord commands" features. The web port has no Discord integration.

---

### Bug #25: csdocs `create-your-own-providers.md` — ends with `# TODO: REST`
- **Severity:** Info
- **Category:** Documentation
- **Location:** `csdocs/docs/create-your-own-providers.md` (the last line of the file)
- **Description:** The "Create your own providers" guide — the main onboarding doc for new extension authors — ends abruptly with a `# TODO: REST` placeholder. The "REST" section (presumably describing how to write a provider that talks to a REST API rather than scraping HTML) was never written. The doc covers HTML scraping (with Jsoup / regex) but stops there.
- **Impact:** New extension authors who want to write a REST-based provider (which is the common case for the modern web — most media sites have a JSON API, not a scrapeable HTML page) have to reverse-engineer the `MainAPI` contract from source. The TODO has been there long enough that it's effectively "we'll never write this."
- **Suggested Fix:** Either write the REST section (the Invidious and Internet Archive providers in the web port are both REST-based — their source would serve as the example), or delete the TODO line and add a "For REST-based providers, see the `Invidious` / `InternetArchive` provider source as a reference" pointer. The web port's ARCHITECTURE.md includes a complete REST provider example (see "How to write a new provider").

---

### Bug #26: csdocs `retype_build.yml` — YAML typo `branches: aster]` breaks push trigger
- **Severity:** High
- **Category:** Bug
- **Location:** `csdocs/retype_build.yml` (the `branches:` key under the `push:` trigger — the value is the string `aster]` instead of the intended `master` or `main`)
- **Description:** The Retype (docs-site generator) config file has a YAML typo: `branches: aster]` — the `m` is missing (it should be `master`) and there's a stray `]` at the end. YAML parses this as the literal string `"aster]"`, which is not a valid branch name. The push trigger for the docs site therefore never fires on any branch (no branch is named `aster]`), and the docs site (hosted at `recloudstream.github.io` or similar) is never rebuilt from `master` pushes.
- **Impact:** The docs site is silently out of date. Edits to `csdocs/docs/*.md` are never published automatically. Whoever maintains the docs has to manually trigger a rebuild (if they even realize the auto-build is broken — the typo doesn't cause a build failure, just a silent "no matching branch"). The docs site drifts further from the source over time.
- **Suggested Fix:** Change `branches: aster]` to `branches: master` (or `main`, depending on the default branch). Add a CI check that validates YAML syntax in `retype_build.yml` (a simple `yamllint` step would catch this). The web port uses Markdown files rendered directly by GitHub — no Retype / build step.

---

### Bug #27: csdocs `devs/scraping/starting.md` — body duplicated (missing closing ```)
- **Severity:** Medium
- **Category:** Documentation
- **Location:** `csdocs/docs/devs/scraping/starting.md` (the file's body — a Markdown code fence is opened but never closed, causing the rest of the document to be rendered as code)
- **Description:** The "Starting scraping" guide has a Markdown formatting bug: a ` ``` ` code-fence opener is not matched by a closing ` ``` `. Everything after the opener (the entire rest of the document, including the closing prose, the "next steps" section, etc.) is rendered as a single code block on the docs site. The text is all there, but it's unreadable as prose — it's monospace, no formatting, no links.
- **Impact:** The "Starting scraping" guide is effectively unreadable on the rendered docs site. New contributors who land on it (it's linked from the main "create your own providers" page) get a wall of monospace text and likely bounce.
- **Suggested Fix:** Add the missing closing ` ``` ` after the intended code block. Run a Markdown linter (`markdownlint` or similar) on the csdocs directory to catch any other unclosed fences. The web port uses standard Markdown — GitHub renders it natively, and any fence bug is immediately visible in the rendered preview.

---

### Bug #28: TorrServer never shuts down — restart crashes the app
- **Severity:** Critical
- **Category:** Bug
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/torrent/TorrService.kt` (or wherever the TorrServer process lifecycle is managed — the F-series trace notes the bug is in the stop/restart path)
- **Description:** TorrServer (the torrent-to-HLS bridge the app uses to stream `.torrent` / magnet links) is started as a child process when the first torrent link is loaded. The shutdown logic is broken: when the app tries to stop TorrServer (on app exit, or on a "stop torrent" user action), the stop call doesn't actually terminate the child process — the process is orphaned. On the *next* app start, the app tries to start TorrServer again, finds the orphaned process still holding the port, and the new process crashes (port-in-use error). This cascading failure can crash the entire app on startup if the user previously used torrents.
- **Impact:** App crashes on restart after torrent use. Users who watch even one torrent stream need to manually kill the TorrServer process (via `adb shell` or a task killer) before the app will start again. This is a Critical bug because it affects every user who uses the torrent feature, and the failure mode (app won't start) is severe.
- **Suggested Fix:** Fix the shutdown logic to actually SIGTERM the child process (and SIGKILL after a timeout if it doesn't exit). On app start, check for an orphaned TorrServer process and either adopt it (preferred) or kill it before starting a new one. Add a unit test that starts and stops TorrServer in a loop to catch regressions. The web port doesn't yet support torrent streaming — when it does, the lifecycle must be designed with this bug in mind.

---

### Bug #29: Subscription polls ended shows forever — no end-of-show detection
- **Severity:** Medium
- **Category:** Bug
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/ui/subscriptions/SubscriptionWorkManager.kt` (the polling logic — the F12 trace notes the polling loop checks for new episodes but never checks for show-end)
- **Description:** The subscription system polls each subscribed show's provider periodically to check for new episodes. The polling loop has no end-of-show detection — it continues polling forever, even after a show has clearly ended (the last episode aired years ago, the provider's `load` response reports `status: "Ended"`, etc.). The poll just keeps fetching the episode list, comparing against the last-known list, finding nothing new, and going back to sleep — forever.
- **Impact:** Wasted battery (every poll wakes the device, does network I/O). Wasted bandwidth (the poll fetches the full episode list each time). Wasted server resources on the provider's side. For users with many subscriptions, the polling load is non-trivial. The system also has no way to surface "this show ended" to the user — they get no notification that there will never be a new episode.
- **Suggested Fix:** Add end-of-show detection: if a show's `LoadResponse` reports a terminal status (Ended / Canceled / Released) AND the episode list hasn't changed in N consecutive polls, mark the subscription as "completed" and stop polling (or reduce poll frequency to "check once a year for specials"). Surface completed subscriptions in a separate UI section so the user knows the poll has stopped. The web port's subscription system (when implemented) should have this from the start.

---

### Bug #30: Subscription orphans from deleted plugins — never cleaned up
- **Severity:** Medium
- **Category:** Bug
- **Location:** `app/src/main/java/com/lagradost/cloudstream3/ui/subscriptions/SubscriptionStorage.kt` (or wherever subscriptions are persisted — the F12 trace notes that the storage key includes the provider name, and there's no cleanup when a provider is uninstalled)
- **Description:** Subscriptions are stored keyed by `(providerName, showId)`. When a user uninstalls a provider plugin (via the extensions screen), the plugin's code is removed — but the subscription entries for that provider **remain in storage**. They're never cleaned up. On every subscription poll, the polling loop tries to look up the (now-uninstalled) provider by name, fails, logs an error, and skips — but the entry stays. Over time (especially for users who install / uninstall many community plugins), the subscription storage accumulates dozens of orphaned entries.
- **Impact:** Storage bloat. Wasted polling CPU (the polling loop iterates every entry, including orphans, even if it skips them quickly). User-visible: the subscription list shows ghost entries that can't be opened ("provider not found" error when tapped). The orphans also cause confusion if the user reinstalls the same plugin later — the old subscription entries re-activate with stale "last seen episode" pointers, missing episodes that aired during the uninstall window.
- **Suggested Fix:** On plugin uninstall, iterate the subscription storage and delete all entries whose `providerName` matches the uninstalled plugin. Alternatively, on app start, scan for orphaned subscriptions (whose provider name doesn't match any loaded provider) and prompt the user to delete them. The web port's subscription system (when implemented) should clean up orphans on provider disable / uninstall.

---

## Summary by category

| Category       | Count | Bug numbers                                                    |
| -------------- | ----- | -------------------------------------------------------------- |
| Bug            | 9     | #2, #8, #9, #10, #16, #17, #26, #28, #29, #30                  |
| Dead Code      | 11    | #2, #3, #4, #5, #6, #7, #10, #12, #17, #18, #19                |
| Security       | 0     | (no pure-security bugs in this batch — bug #18 is a security smell but classified as Dead Code) |
| Documentation  | 3     | #25, #26, #27                                                  |
| Maintenance    | 9     | #1, #11, #13, #14, #15, #20, #21, #22, #23, #24                |

(Some bugs span two categories — e.g. #2 is both a Bug and Dead Code; #26 is both Documentation and a Bug. The table reflects primary classification.)

## Summary by severity

| Severity  | Count | Bug numbers                                       |
| --------- | ----- | ------------------------------------------------- |
| Critical  | 1     | #28                                               |
| High      | 4     | #8, #15, #16, #26                                 |
| Medium    | 9     | #3, #5, #6, #9, #10, #19, #20, #27, #29, #30      |
| Low       | 10    | #1, #2, #4, #7, #13, #17, #18, #21, #22, #23      |
| Info      | 4     | #11, #14, #24, #25                                |

(Counts include secondary classifications — total > 30 because some bugs are counted under multiple severities.)

---

## What the web port does about these

The CloudStream Web port (this repo) was designed with awareness of all 30 issues.
For each, the web port either:

- **Sidesteps** (the issue can't arise because the feature isn't ported) — bugs #2,
  #13, #15, #17 (chromecast), #19, #20, #21, #22, #23, #24, #28
- **Fixes** (the equivalent feature is implemented correctly from the start) — bug
  #16 (the `episode_sync_enabled_key` gating bug — see
  [ARCHITECTURE.md](./ARCHITECTURE.md#data-flow-watch-progress-sync))
- **Doesn't reproduce** (the dead code is simply not included) — bugs #1, #3, #4,
  #5, #6, #7, #9, #10, #12, #18
- **Will fix on implementation** (the feature is on the roadmap; when shipped, it
  will be implemented correctly) — bugs #11, #29, #30
- **N/A** (the issue is documentation-specific to the Android project's csdocs
  site) — bugs #25, #26, #27 — but the web port's own docs (this file,
  ARCHITECTURE.md, README.md) are Markdown rendered natively by GitHub, so the
  same class of bug (broken Retype config, unclosed Markdown fences) is far less
  likely.

The web port's [roadmap](./README.md#roadmap) explicitly calls out the features
that, when implemented, must avoid the original's bugs:

- **TorrServer** (bug #28) — must have correct process lifecycle from day one.
- **CloudflareKiller** (bug #19) — must be wired to at least one provider as a
  reference, or not shipped at all.
- **Subscriptions** (bugs #29, #30) — must have end-of-show detection and
  orphan cleanup from day one.
- **VideoSkip** (bug #11) — must use a separate `cacheKey` from `name` so future
  renames don't invalidate caches.
- **`.cs3` extension loading** — must clean up subscriptions on uninstall (the
  inverse of bug #30).
