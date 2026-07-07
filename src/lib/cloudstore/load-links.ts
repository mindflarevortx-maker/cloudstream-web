/**
 * CloudStream Web — Episode link loader
 *
 * Mirrors the Android `RepoLinkGenerator` + `APIRepository.loadLinks` flow:
 *   1. Look up the provider by name from APIHolder.
 *   2. Call `provider.loadLinks(data, isCasting, subCb, linkCb)` — the
 *      provider streams ExtractorLink[] and SubtitleFile[] back via two
 *      callbacks (it may yield them incrementally as extractors resolve).
 *   3. Collect everything into two arrays and return.
 *
 * Used by the Result view (when the user clicks an episode) to gather
 * playable sources before handing them off to the player view via
 * `useAppStore.openPlayer(episode, links, metadata)`.
 *
 * Error policy mirrors the Android `safeApiCall`: any thrown error inside
 * `loadLinks` is propagated to the caller, which surfaces it as a toast.
 * Individual extractor failures are logged but not thrown (they happen
 * inside the provider's own try/catch, see ExtractorRegistry.loadExtractor).
 */

import { APIHolder } from "@/lib/cloudstream/MainAPI";
import type { ExtractorLink, SubtitleFile } from "@/lib/cloudstream/types";

export interface LoadEpisodeLinksResult {
  links: ExtractorLink[];
  subtitles: SubtitleFile[];
}

/**
 * Load all playable ExtractorLinks (and any SubtitleFiles) for an episode.
 *
 * @param apiName      The provider's display name (LoadResponse.apiName).
 * @param episodeData  The `Episode.data` payload (or LoadResponse.dataUrl for
 *                     a movie). This is the opaque string the provider's
 *                     `loadLinks` knows how to resolve into actual streams.
 * @param isCasting    Whether the user is Chromecast-ing. Passed through to
 *                     the provider so it can prefer cast-friendly formats.
 *                     Defaults to false on web.
 */
export async function loadEpisodeLinks(
  apiName: string,
  episodeData: string,
  isCasting: boolean = false
): Promise<LoadEpisodeLinksResult> {
  const provider = APIHolder.getApiByName(apiName);
  if (!provider) {
    throw new Error(`Provider not found: ${apiName}`);
  }

  if (!episodeData) {
    throw new Error(
      `Cannot load links: episode has no data payload (apiName=${apiName})`
    );
  }

  const links: ExtractorLink[] = [];
  const subtitles: SubtitleFile[] = [];

  // The provider calls these callbacks 0..N times as it discovers sources.
  // We just push into the arrays — order is preserved (provider-controlled).
  await provider.loadLinks(
    episodeData,
    isCasting,
    (sub) => {
      // Dedupe subtitles by (url) so two extractors advertising the same VTT
      // don't double up. Mirrors Android's HashSet in RepoLinkGenerator.
      if (!subtitles.some((s) => s.url === sub.url)) {
        subtitles.push(sub);
      }
    },
    (link) => {
      // Dedupe links by (url+quality) — same logic as Android.
      if (!links.some((l) => l.url === link.url && l.quality === link.quality)) {
        links.push(link);
      }
    }
  );

  return { links, subtitles };
}

/**
 * Sort links by quality label (descending). Mirrors QualityDataHelper's
 * resolution-priority sort: 1080p > 720p > 480p > unknown.
 *
 * The player view can call this to pick a sensible default source.
 */
export function sortLinksByQuality(links: ExtractorLink[]): ExtractorLink[] {
  const qualityRank = (q?: string): number => {
    if (!q) return 0;
    const m = q.match(/(\d{3,4})/);
    return m ? parseInt(m[1], 10) : 0;
  };
  return [...links].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
}
