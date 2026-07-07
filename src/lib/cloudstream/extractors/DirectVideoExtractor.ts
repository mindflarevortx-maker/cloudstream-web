/**
 * CloudStream Web — DirectVideoExtractor
 *
 * Handles direct MP4 / WebM / MKV / OGG video URLs. mainUrl = "" so this is
 * the fallback for any URL ending in a video-file extension that no other
 * extractor claimed. Returns the URL as an ExtractorLink with type=Video.
 *
 * Mirrors the Kotlin pattern where `loadExtractor` ultimately falls through
 * to `newExtractorLink(source, "Direct", url, type = ExtractorLinkType.Video)`
 * if no extractor's mainUrl matches and the URL looks like a direct video file.
 */

import { ExtractorApi } from "../ExtractorApi";
import { ExtractorLink, ExtractorLinkType, SubtitleFile } from "../types";
import { detectQualityFromUrl } from "./GenericM3U8Extractor";

const VIDEO_EXTENSIONS = /\.(mp4|webm|mkv|ogv|ogg|avi|mov|m4v|ts)(\?|#|$)/i;

export class DirectVideoExtractor extends ExtractorApi {
  override name = "Direct Video";
  override mainUrl = "";
  override requiresReferer = false;

  override async getUrl(
    url: string,
    referer?: string,
    _subtitleCallback?: (subtitle: SubtitleFile) => void
  ): Promise<ExtractorLink[]> {
    if (!url) return [];

    const quality = detectQualityFromUrl(url);

    const link: ExtractorLink = {
      name: "Direct Video",
      url,
      source: this.name,
      quality,
      type: ExtractorLinkType.Video,
      isM3u8: false,
      isDash: false,
      referer,
    };

    return [link];
  }
}

/** Quick test: does this URL look like a direct video file? */
export function isDirectVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url);
}
