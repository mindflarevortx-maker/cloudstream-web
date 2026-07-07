/**
 * CloudStream Web — ExtractorApi Base Class
 * Ported from library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt
 */

import { ExtractorLink, SubtitleFile } from "./types";

/** ExtractorApi — abstract base class for video extractors */
export abstract class ExtractorApi {
  abstract name: string;
  abstract mainUrl: string;
  requiresReferer: boolean = false;

  /** Extract video links from a URL */
  abstract getUrl(
    url: string,
    referer?: string,
    subtitleCallback?: (subtitle: SubtitleFile) => void
  ): Promise<ExtractorLink[]>;
}

/** ExtractorRegistry — the global extractor registry */
export class ExtractorRegistry {
  static extractors: ExtractorApi[] = [];

  /** Register an extractor */
  static registerExtractor(extractor: ExtractorApi): void {
    ExtractorRegistry.extractors.push(extractor);
  }

  /**
   * Load extractor — dispatch a URL to the matching extractor.
   * Mirrors the Kotlin loadExtractor: reverse-iteration prefix match → Levenshtein >80% fallback.
   */
  static async loadExtractor(
    url: string,
    referer?: string,
    subtitleCallback?: (subtitle: SubtitleFile) => void
  ): Promise<ExtractorLink[]> {
    if (!url) return [];

    // Pass 1: reverse-iteration prefix match
    for (let i = ExtractorRegistry.extractors.length - 1; i >= 0; i--) {
      const extractor = ExtractorRegistry.extractors[i];
      if (url.startsWith(extractor.mainUrl)) {
        try {
          return await extractor.getUrl(url, referer, subtitleCallback);
        } catch (e) {
          console.warn(`[ExtractorRegistry] ${extractor.name} failed for ${url}:`, e);
        }
      }
    }

    // Pass 2: Levenshtein >80% fallback (for mirror domains)
    for (const extractor of ExtractorRegistry.extractors) {
      const ratio = levenshteinRatio(url, extractor.mainUrl);
      if (ratio > 0.8) {
        try {
          return await extractor.getUrl(url, referer, subtitleCallback);
        } catch (e) {
          console.warn(`[ExtractorRegistry] ${extractor.name} (fuzzy) failed for ${url}:`, e);
        }
      }
    }

    return [];
  }
}

/** Levenshtein distance ratio — for fuzzy URL matching */
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(a, b);
  return 1.0 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

/** Helper: create a direct ExtractorLink (no extractor needed) */
export function newExtractorLink(
  source: string,
  name: string,
  url: string,
  options?: Partial<ExtractorLink>
): ExtractorLink {
  return {
    name,
    url,
    source,
    quality: options?.quality,
    referer: options?.referer,
    headers: options?.headers,
    type: options?.type,
    isM3u8: options?.isM3u8 || url.includes(".m3u8") || url.includes("m3u8"),
    isDash: options?.isDash || url.includes(".mpd"),
    ...options,
  };
}
