/**
 * CloudStream Web — Extractor Registry
 *
 * Mirrors the Kotlin `extractorApis: AtomicMutableList<ExtractorApi>` seeded at app init
 * (see worklog D2 §3, ExtractorApi.kt lines 973-1321). On the JVM side the list is
 * hand-maintained with ~327 entries; on web we only register the handful that can
 * actually run without a JVM/JVM-only deps.
 *
 * Order matters: `ExtractorRegistry.loadExtractor` iterates in REVERSE so the
 * most-recently-registered extractor takes priority. Generic extractors
 * (DirectVideo, GenericM3U8) have mainUrl = "" so they match any URL — they MUST
 * be registered FIRST (so they're checked LAST in reverse iteration) so that
 * the YouTube extractor (with a specific mainUrl) gets a chance to match first.
 *
 * The initExtractors() function is idempotent — calling it more than once is a no-op.
 */

import { ExtractorRegistry } from "../ExtractorApi";
import { DirectVideoExtractor } from "./DirectVideoExtractor";
import { GenericM3U8Extractor } from "./GenericM3U8Extractor";
import { YouTubeExtractor } from "./YouTubeExtractor";

let initialized = false;

/**
 * Register all built-in extractors. Idempotent — safe to call from
 * multiple entry points (provider init, app boot, etc.).
 */
export function initExtractors(): void {
  if (initialized) return;
  initialized = true;

  // Generic fallbacks FIRST — they're checked last in reverse iteration.
  // DirectVideo handles .mp4/.webm/.mkv URLs (specific extensions).
  // GenericM3U8 handles .m3u8 URLs (specific extension).
  // Both have mainUrl = "" so they match any URL, but their getUrl() is
  // cheap and they're only invoked when no more-specific extractor matches.
  ExtractorRegistry.registerExtractor(new DirectVideoExtractor());
  ExtractorRegistry.registerExtractor(new GenericM3U8Extractor());

  // Specific extractors LAST — they're checked first in reverse iteration.
  // YouTubeExtractor has mainUrl = "https://www.youtube.com" so it'll only
  // match YouTube URLs and won't shadow the generic fallbacks.
  ExtractorRegistry.registerExtractor(new YouTubeExtractor());
}

/** Re-export all extractor classes for direct use / testing. */
export { DirectVideoExtractor, GenericM3U8Extractor, YouTubeExtractor };
export { detectQualityFromUrl } from "./GenericM3U8Extractor";
export { isDirectVideoUrl } from "./DirectVideoExtractor";
export { extractYouTubeId } from "./YouTubeExtractor";
