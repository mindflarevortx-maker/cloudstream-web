/**
 * CloudStream Web — YouTubeExtractor
 * Ported from library/src/jvmCommonMain/kotlin/com/lagradost/cloudstream3/extractors/YoutubeExtractor.jvmCommon.kt
 *
 * The Kotlin original uses NewPipeExtractor (`org.schabi.newpipe.extractor.stream.StreamInfo`)
 * which is a JVM-only library depending on Jsoup — it can't run on the web (no JVM, no DOM-less HTML parser).
 *
 * On web we substitute the **Invidious API** (https://inv.nadeko.net/api/v1/videos/<id>)
 * which returns the same kind of `formatStreams` array (direct progressive MP4 URLs) and
 * `adaptiveFormats` (separate video-only / audio-only streams) as NewPipeExtractor's
 * `StreamInfo.getVideoStreams()` / `getAudioStreams()`.
 *
 * The Kotlin regex for ID extraction is preserved verbatim (see worklog D2 §6):
 *   (?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:.*v=|v/|u/\w/|embed/|shorts/|live/))([\\w-]{11})
 *
 * For progressive VOD content we return formatStreams as ExtractorLink[] with type=Video
 * (matching the Kotlin behavior of returning a single muxed stream). For live content
 * with an hlsUrl we return one M3u8 link (matching the Kotlin LIVE_STREAM branch).
 *
 * NOTE: We do NOT emulate the Kotlin `audioTracks` field on ExtractorLink because
 * our web type doesn't define it. The adaptiveFormats are ignored for now — the
 * progressive formatStreams are sufficient for HLS.js / native video playback.
 */

import { ExtractorApi } from "../ExtractorApi";
import { ExtractorLink, ExtractorLinkType, SubtitleFile } from "../types";

const INVIDIOUS_API = "https://inv.nadeko.net/api/v1/videos/";

/** YouTube ID extraction regex — verbatim from the Kotlin source. */
const YOUTUBE_ID_REGEX =
  /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:.*v=|v\/|u\/\w\/|embed\/|shorts\/|live\/))([\w-]{11})/;

/** Fallback for bare IDs and watch?v= forms that the main regex might miss. */
const YOUTUBE_WATCH_V_REGEX = /[?&]v=([\w-]{11})/;

export class YouTubeExtractor extends ExtractorApi {
  override name = "YouTube";
  override mainUrl = "https://www.youtube.com";
  override requiresReferer = false;

  override async getUrl(
    url: string,
    _referer?: string,
    subtitleCallback?: (subtitle: SubtitleFile) => void
  ): Promise<ExtractorLink[]> {
    if (!url) return [];

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      console.warn(`[YouTubeExtractor] could not extract video ID from: ${url}`);
      return [];
    }

    // Subtitle callback support — pass through so callers can collect captions.
    // (We do extract them below and fire the callback.)
    const _ = subtitleCallback; // referenced for type completeness; not used yet

    let data: InvidiousVideo | null = null;
    try {
      const res = await fetch(`${INVIDIOUS_API}${videoId}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        },
        // 30s timeout via AbortController — matches the proxy route's timeout.
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        console.warn(`[YouTubeExtractor] Invidious returned ${res.status} for ${videoId}`);
        return [];
      }
      data = (await res.json()) as InvidiousVideo;
    } catch (e) {
      console.warn(`[YouTubeExtractor] Invidious fetch failed for ${videoId}:`, e);
      return [];
    }

    const links: ExtractorLink[] = [];

    // Live / HLS branch — match the Kotlin LIVE_STREAM handling.
    if (
      data.liveNow ||
      data.isPremiere ||
      (data.formatStreams?.length === 0 && data.hlsUrl)
    ) {
      if (data.hlsUrl) {
        links.push({
          name: "YouTube Live",
          url: data.hlsUrl,
          source: this.name,
          type: ExtractorLinkType.M3u8,
          isM3u8: true,
          isDash: false,
          quality: "Live",
        });
      }
    }

    // Progressive VOD branch — emit formatStreams as direct Video links.
    // Each formatStream has { quality, url, mimeType, container, ... }
    for (const stream of data.formatStreams ?? []) {
      if (!stream.url) continue;
      const qualityStr = normalizeQuality(stream.quality);
      const codecLabel = normalizeContainer(stream.container || stream.mimeType);
      links.push({
        name: codecLabel ? `YouTube ${codecLabel}` : "YouTube",
        url: stream.url,
        source: this.name,
        quality: qualityStr,
        type: ExtractorLinkType.Video,
        isM3u8: false,
        isDash: false,
      });
    }

    // Fire subtitle callback for any captions present (best-effort).
    if (subtitleCallback && data.captions?.length) {
      for (const cap of data.captions) {
        if (!cap.url) continue;
        subtitleCallback({
          name: cap.label || cap.languageCode || "Unknown",
          url: cap.url,
          language: cap.languageCode,
          format: cap.mimeType?.includes("vtt")
            ? "vtt"
            : cap.mimeType?.includes("srt")
              ? "srt"
              : undefined,
        });
      }
    }

    return links;
  }
}

/**
 * Extract an 11-char YouTube video ID from any URL form.
 * Handles: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed/ID,
 *          youtube.com/shorts/ID, youtube.com/live/ID, youtube-nocookie.com/embed/ID
 */
export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();

  // Bare 11-char ID
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  // Primary Kotlin regex
  const m1 = trimmed.match(YOUTUBE_ID_REGEX);
  if (m1) return m1[1];

  // Fallback: watch?v=ID
  const m2 = trimmed.match(YOUTUBE_WATCH_V_REGEX);
  if (m2) return m2[1];

  return null;
}

/** Normalize an Invidious quality string ("720p", "1080p", "medium", "hd720") into "NxP" form. */
function normalizeQuality(q?: string): string | undefined {
  if (!q) return undefined;
  // Already in "720p" form
  if (/^\d{3,4}p$/i.test(q)) return q;
  // "hd720" → "720p"
  const hdMatch = q.match(/(\d{3,4})/);
  if (hdMatch) return `${hdMatch[1]}p`;
  switch (q.toLowerCase()) {
    case "4k":
    case "2160p":
      return "2160p";
    case "hd":
      return "720p";
    case "sd":
      return "480p";
    default:
      return q;
  }
}

/** Map an Invidious container/mimeType to a friendly codec label (av01→AV1, vp9→VP9, etc.). */
function normalizeContainer(containerOrMime?: string): string | undefined {
  if (!containerOrMime) return undefined;
  const lower = containerOrMime.toLowerCase();
  if (lower.includes("av01") || lower.includes("av1")) return "AV1";
  if (lower.includes("vp9")) return "VP9";
  if (lower.includes("avc1") || lower.includes("h264") || lower.includes("h.264"))
    return "H264";
  if (lower.includes("hev1") || lower.includes("hvc1") || lower.includes("hevc") || lower.includes("h265"))
    return "H265";
  if (lower.includes("mp4")) return "MP4";
  if (lower.includes("webm")) return "WebM";
  return undefined;
}

/** Minimal Invidious video response shape (only fields we use). */
interface InvidiousVideo {
  videoId: string;
  title?: string;
  liveNow?: boolean;
  isPremiere?: boolean;
  hlsUrl?: string;
  formatStreams?: InvidiousFormatStream[];
  adaptiveFormats?: InvidiousAdaptiveFormat[];
  captions?: InvidiousCaption[];
}

interface InvidiousFormatStream {
  url: string;
  itag: string;
  type: string;
  quality: string;
  container?: string;
  mimeType?: string;
}

interface InvidiousAdaptiveFormat {
  url: string;
  itag: string;
  type: string;
  mimeType?: string;
  bitrate?: string;
}

interface InvidiousCaption {
  label?: string;
  languageCode?: string;
  url?: string;
  mimeType?: string;
}
