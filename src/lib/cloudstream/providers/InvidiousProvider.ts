/**
 * CloudStream Web — InvidiousProvider
 * Ported from repo/extensions-repo/InvidiousProvider/src/main/kotlin/recloudstream/InvidiousProvider.kt
 * (146 lines of Kotlin — see worklog Task E4 §6.3 for a thorough write-up.)
 *
 * Invidious is an open-source YouTube frontend. The Kotlin plugin pins one instance
 * (`https://inv.nadeko.net`); we do the same. The plugin uses the public REST API:
 *
 *   - GET /api/v1/popular?fields=videoId,title,author         → list of popular videos
 *   - GET /api/v1/trending?fields=videoId,title,author        → list of trending videos
 *   - GET /api/v1/search?q=<q>&page=<n>&type=video&fields=... → search results
 *   - GET /api/v1/videos/<id>?fields=videoId,title,description,recommendedVideos,author,
 *                                  authorThumbnails,formatStreams,adaptiveFormats
 *     → video detail, including direct stream URLs
 *   - GET /vi/<videoId>/<quality>.jpg                          → thumbnail (YouTube thumbnail scheme)
 *   - GET /api/manifest/dash/id/<id>                           → DASH manifest
 *
 * Kotlin `loadLinks` behavior: it calls `loadExtractor("https://youtube.com/watch?v=$data")`
 * (which on Android delegates to NewPipeExtractor) AND pushes a second ExtractorLink of type
 * DASH pointing at the Invidious manifest endpoint.
 *
 * On web we don't have NewPipeExtractor — the registered YouTubeExtractor already uses the
 * Invidious API to fetch formatStreams/adaptiveFormats, so we'd be doing the same work twice.
 * Instead, we follow the task spec literally: emit `formatStreams` as direct MP4
 * (ExtractorLinkType.Video) and `adaptiveFormats` as HLS/DASH/Video links (auto-detected from
 * the URL/mimeType). Plus the always-available DASH manifest endpoint as a final fallback.
 *
 * Aggressive `?fields=` usage is preserved — it cuts payload size dramatically (the Invidious
 * API supports field projection, same pattern as Dailymotion's API).
 */

import { MainAPI } from "../MainAPI";
import {
  TvType,
  SearchResponse,
  LoadResponse,
  HomePageResponse,
  HomePageList,
  MainPageRequest,
  ExtractorLink,
  SubtitleFile,
  ExtractorLinkType,
  Actor,
} from "../types";

// ---------------------------------------------------------------------------
// Invidious JSON shapes (only fields we use)
// ---------------------------------------------------------------------------

interface InvidiousSearchEntry {
  title: string;
  videoId: string;
  author?: string;
  authorThumbnails?: InvidiousThumbnail[];
}

interface InvidiousThumbnail {
  url?: string;
  width?: number;
  height?: number;
}

interface InvidiousVideo {
  title: string;
  description?: string;
  videoId: string;
  author?: string;
  authorThumbnails?: InvidiousThumbnail[];
  recommendedVideos?: InvidiousSearchEntry[];
  formatStreams?: InvidiousFormatStream[];
  adaptiveFormats?: InvidiousAdaptiveFormat[];
  liveNow?: boolean;
  hlsUrl?: string;
}

interface InvidiousFormatStream {
  url: string;
  itag?: string;
  type?: string;
  quality?: string;
  container?: string;
  mimeType?: string;
}

interface InvidiousAdaptiveFormat {
  url: string;
  itag?: string;
  type?: string;
  mimeType?: string;
  bitrate?: string;
  container?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class InvidiousProvider extends MainAPI {
  override name = "Invidious";
  override mainUrl = "https://inv.nadeko.net";
  override lang = "en";
  override supportedTypes: TvType[] = [TvType.Movie, TvType.Others];
  override hasMainPage = true;

  override mainPage: MainPageRequest[] = [
    { name: "Popular", url: "popular" },
    { name: "Trending", url: "trending" },
  ];

  // ---- getMainPage ------------------------------------------------------

  override async getMainPage(
    _page: number = 1,
    _request: MainPageRequest | null = null
  ): Promise<HomePageResponse> {
    const items: HomePageList[] = [];

    // Popular rail
    try {
      const res = await this.client.get(
        `${this.mainUrl}/api/v1/popular?fields=videoId,title,author`
      );
      if (res.isSuccess && res.body) {
        const arr = JSON.parse(res.body) as InvidiousSearchEntry[];
        items.push({
          name: "Popular",
          list: (arr ?? [])
            .filter((e) => e && e.videoId)
            .map((e) => this.toSearchResponse(e)),
          hasNext: true,
        });
      }
    } catch (e) {
      console.warn(`[Invidious] getMainPage popular failed:`, e);
    }

    // Trending rail
    try {
      const res = await this.client.get(
        `${this.mainUrl}/api/v1/trending?fields=videoId,title,author`
      );
      if (res.isSuccess && res.body) {
        const arr = JSON.parse(res.body) as InvidiousSearchEntry[];
        items.push({
          name: "Trending",
          list: (arr ?? [])
            .filter((e) => e && e.videoId)
            .map((e) => this.toSearchResponse(e)),
          hasNext: true,
        });
      }
    } catch (e) {
      console.warn(`[Invidious] getMainPage trending failed:`, e);
    }

    return { items };
  }

  // ---- search -----------------------------------------------------------

  override async search(query: string, page: number = 1): Promise<SearchResponse[]> {
    const q = encodeURIComponent(query);
    const url =
      `${this.mainUrl}/api/v1/search?q=${q}&page=${page}` +
      `&type=video&fields=videoId,title,author`;
    try {
      const res = await this.client.get(url);
      if (!res.isSuccess || !res.body) return [];
      const arr = JSON.parse(res.body) as InvidiousSearchEntry[];
      return (arr ?? [])
        .filter((e) => e && e.videoId)
        .map((e) => this.toSearchResponse(e));
    } catch (e) {
      console.warn(`[Invidious] search failed:`, e);
      return [];
    }
  }

  // ---- load -------------------------------------------------------------

  override async load(url: string): Promise<LoadResponse> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error(`Invidious: could not extract video ID from ${url}`);
    }
    const apiUrl =
      `${this.mainUrl}/api/v1/videos/${videoId}` +
      `?fields=videoId,title,description,recommendedVideos,author,authorThumbnails,formatStreams,adaptiveFormats`;
    const res = await this.client.get(apiUrl);
    if (!res.isSuccess || !res.body) {
      throw new Error(`Invidious: video fetch failed (${res.statusCode})`);
    }
    const v = JSON.parse(res.body) as InvidiousVideo;
    return this.toLoadResponse(v);
  }

  // ---- loadLinks --------------------------------------------------------

  override async loadLinks(
    data: string,
    _isCasting: boolean,
    _subtitleCallback: (subtitle: SubtitleFile) => void,
    callback: (link: ExtractorLink) => void
  ): Promise<boolean> {
    const videoId = data;
    if (!videoId) return false;

    // Always-available DASH manifest from Invidious.
    callback(
      this.newExtractorLink(
        this.name,
        `${this.name} (DASH)`,
        `${this.mainUrl}/api/manifest/dash/id/${videoId}`,
        {
          type: ExtractorLinkType.Dash,
          isDash: true,
          isM3u8: false,
          referer: "",
        }
      )
    );

    // Fetch the video metadata to harvest direct stream URLs.
    try {
      const apiUrl =
        `${this.mainUrl}/api/v1/videos/${videoId}` +
        `?fields=formatStreams,adaptiveFormats,liveNow,hlsUrl`;
      const res = await this.client.get(apiUrl);
      if (!res.isSuccess || !res.body) return true;
      const v = JSON.parse(res.body) as InvidiousVideo;

      // Live / HLS branch — if the video is live, prefer the HLS URL.
      if ((v.liveNow || v.formatStreams?.length === 0) && v.hlsUrl) {
        callback(
          this.newExtractorLink(
            this.name,
            `${this.name} (Live)`,
            v.hlsUrl,
            {
              type: ExtractorLinkType.M3u8,
              isM3u8: true,
              isDash: false,
              quality: "Live",
              referer: "",
            }
          )
        );
      }

      // formatStreams → progressive (muxed) MP4 streams — direct video URLs.
      for (const stream of v.formatStreams ?? []) {
        if (!stream.url) continue;
        const quality = this.normalizeQuality(stream.quality);
        const label = quality
          ? `${this.name} ${quality}`
          : this.name;
        callback(
          this.newExtractorLink(this.name, label, stream.url, {
            quality,
            type: ExtractorLinkType.Video,
            isM3u8: false,
            isDash: false,
            referer: "",
          })
        );
      }

      // adaptiveFormats → separate video-only / audio-only streams.
      // These are usually ITAG-tagged URLs from GoogleVideo. Detect HLS / DASH /
      // direct-video by URL extension + mimeType.
      for (const fmt of v.adaptiveFormats ?? []) {
        if (!fmt.url) continue;
        const mimeType = (fmt.mimeType || "").toLowerCase();
        const isM3u8 =
          fmt.url.includes(".m3u8") || mimeType.includes("mpegurl");
        const isDash =
          fmt.url.includes(".mpd") || mimeType.includes("dash");
        const type = isM3u8
          ? ExtractorLinkType.M3u8
          : isDash
            ? ExtractorLinkType.Dash
            : ExtractorLinkType.Video;
        const codecLabel = this.codecLabel(mimeType);
        const label = codecLabel
          ? `${this.name} (${codecLabel})`
          : `${this.name} (Adaptive)`;
        callback(
          this.newExtractorLink(this.name, label, fmt.url, {
            type,
            isM3u8,
            isDash,
            referer: "",
          })
        );
      }
    } catch (e) {
      console.warn(`[Invidious] loadLinks metadata fetch failed:`, e);
    }

    return true;
  }

  // ---- helpers ----------------------------------------------------------

  /** Extract the 11-char YouTube video ID from any Invidious watch URL. */
  private extractVideoId(url: string): string | null {
    if (!url) return null;
    // watch?v=ID
    const m1 = url.match(/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (m1) return m1[1];
    // /embed/ID, /shorts/ID, /live/ID
    const m2 = url.match(/\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
    if (m2) return m2[1];
    // Bare ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return url.trim();
    // Last-ditch: any 11-char [A-Za-z0-9_-] token in the URL
    const m3 = url.match(/([a-zA-Z0-9_-]{11})/);
    return m3 ? m3[1] : null;
  }

  /** Map an Invidious search entry → SearchResponse. */
  private toSearchResponse(e: InvidiousSearchEntry): SearchResponse {
    return {
      name: e.title,
      url: `${this.mainUrl}/watch?v=${e.videoId}`,
      apiName: this.name,
      type: TvType.Movie,
      // YouTube thumbnail scheme — Invidious serves these directly.
      posterUrl: `${this.mainUrl}/vi/${e.videoId}/mqdefault.jpg`,
    };
  }

  /** Build the LoadResponse for an Invidious video detail. */
  private toLoadResponse(v: InvidiousVideo): LoadResponse {
    const recommendations: SearchResponse[] = (v.recommendedVideos ?? [])
      .filter((e) => e && e.videoId)
      .map((e) => this.toSearchResponse(e));

    const actors: Actor[] | undefined = v.author
      ? [
          {
            name: v.author,
            imageUrl: v.authorThumbnails && v.authorThumbnails.length > 0
              ? v.authorThumbnails[v.authorThumbnails.length - 1]?.url
              : undefined,
          },
        ]
      : undefined;

    return {
      name: v.title,
      url: `${this.mainUrl}/watch?v=${v.videoId}`,
      apiName: this.name,
      type: TvType.Movie,
      plot: v.description,
      posterUrl: `${this.mainUrl}/vi/${v.videoId}/hqdefault.jpg`,
      // Pass the bare video ID to loadLinks.
      dataUrl: v.videoId,
      actors,
      recommendations,
    };
  }

  /**
   * Normalize an Invidious quality string ("720p", "1080p", "medium", "hd720")
   * into a uniform "NxP" form. Returns undefined for unknown values.
   */
  private normalizeQuality(q?: string): string | undefined {
    if (!q) return undefined;
    if (/^\d{3,4}p$/i.test(q)) return q;
    const m = q.match(/(\d{3,4})/);
    if (m) return `${m[1]}p`;
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

  /** Map a MIME type to a friendly codec label for display. */
  private codecLabel(mimeType: string): string | undefined {
    if (!mimeType) return undefined;
    if (mimeType.includes("av01") || mimeType.includes("av1")) return "AV1";
    if (mimeType.includes("vp9")) return "VP9";
    if (mimeType.includes("avc1") || mimeType.includes("h264") || mimeType.includes("h.264"))
      return "H264";
    if (
      mimeType.includes("hev1") ||
      mimeType.includes("hvc1") ||
      mimeType.includes("hevc") ||
      mimeType.includes("h265")
    )
      return "H265";
    if (mimeType.includes("mp4")) return "MP4";
    if (mimeType.includes("webm")) return "WebM";
    return undefined;
  }
}
