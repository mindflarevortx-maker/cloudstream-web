/**
 * CloudStream Web — GenericM3U8Extractor
 * Ported from library/src/commonMain/kotlin/com/lagradost/cloudstream3/extractors/GenericM3U8.kt
 *
 * The simplest extractor: handles direct m3u8 URLs. mainUrl = "" so the registry's
 * prefix match passes through any URL containing ".m3u8" (or any URL the dispatcher
 * hands us after more-specific extractors fail to match).
 *
 * On the JVM (Android) side, GenericM3U8 spawns a headless WebView and intercepts
 * the master.m3u8 request via WebViewResolver. On the web we don't have that luxury,
 * so we just trust the caller: if a provider hands us a URL that ends in .m3u8
 * (or contains "m3u8" anywhere), we return it as an ExtractorLink with isM3u8=true.
 *
 * Quality detection: scans the URL path for tokens like "1080p", "720p", "480p",
 * "4k", "2160p", etc. Falls back to undefined if nothing detectable is present.
 */

import { ExtractorApi } from "../ExtractorApi";
import { ExtractorLink, ExtractorLinkType, SubtitleFile } from "../types";

export class GenericM3U8Extractor extends ExtractorApi {
  override name = "GenericM3U8";
  override mainUrl = "";
  override requiresReferer = false;

  override async getUrl(
    url: string,
    _referer?: string,
    _subtitleCallback?: (subtitle: SubtitleFile) => void
  ): Promise<ExtractorLink[]> {
    if (!url) return [];

    const quality = detectQualityFromUrl(url);

    const link: ExtractorLink = {
      name: "Generic M3U8",
      url,
      source: this.name,
      quality,
      type: ExtractorLinkType.M3u8,
      isM3u8: true,
      isDash: false,
      referer: _referer,
    };

    return [link];
  }
}

/**
 * Detect a quality string from a URL path.
 * Looks for common patterns: "1080p", "720p", "480p", "2160p", "4k", "4K", "1440p".
 * Returns undefined if nothing detectable.
 *
 * Mirrors the Kotlin `getQualityFromName` + URL-regex heuristics used by
 * Mediafire, Gofile, Krakenfiles, InternetArchive, etc. (see worklog D2 §10).
 */
export function detectQualityFromUrl(url: string): string | undefined {
  if (!url) return undefined;

  // Case-insensitive scan for the first NxP token in the URL.
  // \b prevents matching "1080p" inside "x1080pxfoo" nonsense.
  const match = url.match(/\b(2160|1440|1080|720|576|480|360|240|144)\s*p?\b/i);
  if (match) {
    return `${match[1]}p`;
  }

  // "4k" / "4K" as a standalone token.
  if (/\b4k\b/i.test(url)) return "4K";
  // "8k" / "8K"
  if (/\b8k\b/i.test(url)) return "8K";

  return undefined;
}
