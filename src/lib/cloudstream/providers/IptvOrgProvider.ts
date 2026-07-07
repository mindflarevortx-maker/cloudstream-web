/**
 * CloudStream Web — IptvOrgProvider
 *
 * A new provider for the iptv-org.github.io public IPTV m3u playlist index.
 * (No Kotlin original — this is a from-scratch implementation per the task spec.)
 *
 * iptv-org maintains a public-domain catalog of freely-available IPTV channels
 * at https://iptv-org.github.io/. The catalog is exposed as JSON:
 *
 *   - GET /api/channels.json
 *     → array of channel objects with fields: id, name, alt_names, network,
 *       country, subdivision, city, categories (array), is_nsfw, launched,
 *       closed, replaced_by, website, logo. NOTE: channels.json itself does
 *       NOT contain stream URLs.
 *
 *   - GET /api/streams.json
 *     → array of `[channel, url, title]` triples — `channel` is the channel
 *       id matching channels.json, `url` is the m3u8 stream URL.
 *
 * The task spec describes channels.json as having `url`, `category`, etc. on
 * the channel object directly. We support that older shape (channel.url,
 * channel.category) as a fallback, but the real iptv-org API today splits
 * streams into streams.json and uses `categories` (plural, array). We handle
 * both shapes robustly so the provider works against either API version.
 *
 * Behavior:
 *   - getMainPage: fetch channels.json (cache 5 min), join with streams.json
 *     to get URLs, group by first category, render category rails.
 *   - search: filter channels.json by name (case-insensitive contains).
 *   - load: return a LiveStreamLoadResponse with name + posterUrl from the
 *     channel; dataUrl carries the m3u8 URL.
 *   - loadLinks: the channel's stream URL is already a direct m3u8 — return
 *     it as an ExtractorLink with isM3u8=true. No extractor needed.
 */

import { MainAPI } from "../MainAPI";
import {
  TvType,
  SearchResponse,
  LoadResponse,
  LiveStreamLoadResponse,
  HomePageResponse,
  HomePageList,
  MainPageRequest,
  ExtractorLink,
  SubtitleFile,
  ExtractorLinkType,
} from "../types";

// ---------------------------------------------------------------------------
// iptv-org JSON shapes
// ---------------------------------------------------------------------------

interface IptvChannel {
  id?: string;
  name?: string;
  alt_names?: string | string[];
  altNames?: string;
  network?: string;
  owners?: string | string[];
  country?: string;
  subdivision?: string;
  city?: string;
  // The modern API uses `categories` (plural, array); the task spec mentions
  // a single `category` string. We support both.
  category?: string;
  categories?: string | string[];
  is_nsfw?: boolean;
  launched?: string;
  closed?: string;
  replaced_by?: string;
  website?: string;
  logo?: string;
  // The task spec mentions `url` directly on the channel — older API shape.
  url?: string;
}

interface IptvStream {
  channel: string;
  url: string;
  title?: string;
}

interface CachedChannels {
  data: IptvChannel[];
  fetchedAt: number;
}

interface CachedStreams {
  data: IptvStream[];
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNELS_URL = "https://iptv-org.github.io/api/channels.json";
const STREAMS_URL = "https://iptv-org.github.io/api/streams.json";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Display order for known categories — anything else goes after these. */
const PREFERRED_CATEGORY_ORDER = [
  "News",
  "Sports",
  "Movies",
  "Entertainment",
  "Kids",
  "Music",
  "Education",
  "Documentary",
  "Business",
  "General",
  "Religious",
  "Culture",
  "Lifestyle",
  "Travel",
  "Auto",
  "Cooking",
  "Outdoor",
  "Relax",
  "Shop",
  "Weather",
  "Animation",
  "Classic",
  "Comedy",
  "Family",
  "Legislative",
  "Series",
];

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class IptvOrgProvider extends MainAPI {
  override name = "IPTV (iptv-org)";
  override mainUrl = "https://iptv-org.github.io";
  override lang = "en";
  override supportedTypes: TvType[] = [TvType.Live];
  override hasMainPage = true;

  override mainPage: MainPageRequest[] = [
    { name: "News", url: "category:News" },
    { name: "Sports", url: "category:Sports" },
    { name: "Movies", url: "category:Movies" },
    { name: "Entertainment", url: "category:Entertainment" },
    { name: "Kids", url: "category:Kids" },
  ];

  private channelsCache: CachedChannels | null = null;
  private streamsCache: CachedStreams | null = null;

  // ---- getMainPage ------------------------------------------------------

  override async getMainPage(
    _page: number = 1,
    _request: MainPageRequest | null = null
  ): Promise<HomePageResponse> {
    const [channels, streams] = await Promise.all([
      this.getChannels(),
      this.getStreams(),
    ]);
    const urlByChannelId = this.buildUrlMap(streams);

    // Group channels by their first category.
    const byCategory = new Map<string, IptvChannel[]>();
    for (const c of channels) {
      const cats = this.getCategories(c);
      if (cats.length === 0) {
        this.pushToCategory(byCategory, "Other", c);
        continue;
      }
      // Bucket the channel into its first category — keeps the rail counts sane.
      this.pushToCategory(byCategory, cats[0], c);
    }

    // Build rails in the preferred order, then any remaining categories.
    const seenCats = new Set<string>();
    const items: HomePageList[] = [];

    for (const cat of PREFERRED_CATEGORY_ORDER) {
      const list = byCategory.get(cat);
      if (!list || list.length === 0) continue;
      seenCats.add(cat);
      items.push({
        name: cat,
        list: list.slice(0, 50).map((c) =>
          this.toSearchResponse(c, urlByChannelId.get(c.id || "") || c.url || "")
        ),
        hasNext: list.length > 50,
      });
    }

    // Sort remaining categories alphabetically for stable output.
    const remaining = Array.from(byCategory.keys())
      .filter((c) => !seenCats.has(c))
      .sort((a, b) => a.localeCompare(b));
    for (const cat of remaining) {
      const list = byCategory.get(cat) || [];
      if (list.length === 0) continue;
      items.push({
        name: cat,
        list: list.slice(0, 50).map((c) =>
          this.toSearchResponse(c, urlByChannelId.get(c.id || "") || c.url || "")
        ),
        hasNext: list.length > 50,
      });
    }

    return { items };
  }

  // ---- search -----------------------------------------------------------

  override async search(query: string, page: number = 1): Promise<SearchResponse[]> {
    const [channels, streams] = await Promise.all([
      this.getChannels(),
      this.getStreams(),
    ]);
    const urlByChannelId = this.buildUrlMap(streams);

    const q = query.toLowerCase().trim();
    if (!q) return [];

    // Filter channels by name (case-insensitive contains) — matches the
    // task spec. We also match against alt_names for better discoverability.
    const filtered = channels.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const alt = this.asString(c.alt_names ?? c.altNames).toLowerCase();
      return name.includes(q) || alt.includes(q);
    });

    // Only return channels that actually have a stream URL — otherwise loadLinks
    // has nothing to play.
    const playable = filtered.filter(
      (c) => (c.id && urlByChannelId.has(c.id)) || c.url
    );

    const pageSize = 50;
    const start = (page - 1) * pageSize;
    const slice = playable.slice(start, start + pageSize);
    return slice.map((c) =>
      this.toSearchResponse(c, urlByChannelId.get(c.id || "") || c.url || "")
    );
  }

  // ---- load -------------------------------------------------------------

  override async load(url: string): Promise<LoadResponse> {
    // The search/home URL we emit encodes the channel id:
    //   <mainUrl>?channel=<channelId>
    const channelId = this.extractChannelId(url);

    if (!channelId) {
      throw new Error(`IptvOrg: could not extract channel id from ${url}`);
    }

    const [channels, streams] = await Promise.all([
      this.getChannels(),
      this.getStreams(),
    ]);

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      throw new Error(`IptvOrg: channel not found: ${channelId}`);
    }

    const streamUrl =
      streams.find((s) => s.channel === channelId)?.url || channel.url || "";

    const response: LiveStreamLoadResponse = {
      name: channel.name || channelId,
      url: `${this.mainUrl}/?channel=${encodeURIComponent(channelId)}`,
      apiName: this.name,
      type: TvType.Live,
      lang: channel.country || this.lang,
      posterUrl: channel.logo,
      logoUrl: channel.logo,
      // The stream URL is passed through to loadLinks via dataUrl.
      dataUrl: streamUrl,
    };
    return response;
  }

  // ---- loadLinks --------------------------------------------------------

  override async loadLinks(
    data: string,
    _isCasting: boolean,
    _subtitleCallback: (subtitle: SubtitleFile) => void,
    callback: (link: ExtractorLink) => void
  ): Promise<boolean> {
    // `data` is the m3u8 stream URL we stored in dataUrl at load() time.
    const streamUrl = data;
    if (!streamUrl) {
      console.warn("[IptvOrg] loadLinks: no stream URL provided");
      return false;
    }

    const isM3u8 = /\.m3u8(\?|#|$)/i.test(streamUrl) || streamUrl.includes("m3u8");
    const isDash = /\.mpd(\?|#|$)/i.test(streamUrl);
    const type = isM3u8
      ? ExtractorLinkType.M3u8
      : isDash
        ? ExtractorLinkType.Dash
        : ExtractorLinkType.Video;

    callback(
      this.newExtractorLink(this.name, this.name, streamUrl, {
        type,
        isM3u8,
        isDash,
        quality: "Live",
        referer: "",
      })
    );
    return true;
  }

  // ---- helpers ----------------------------------------------------------

  /** Fetch channels.json with a 5-minute in-memory cache. */
  private async getChannels(): Promise<IptvChannel[]> {
    if (this.channelsCache && Date.now() - this.channelsCache.fetchedAt < CACHE_TTL_MS) {
      return this.channelsCache.data;
    }
    const res = await this.client.get(CHANNELS_URL);
    if (!res.isSuccess || !res.body) {
      throw new Error(`IptvOrg: channels.json fetch failed (${res.statusCode})`);
    }
    const arr = JSON.parse(res.body) as IptvChannel[];
    this.channelsCache = { data: arr, fetchedAt: Date.now() };
    return arr;
  }

  /** Fetch streams.json with a 5-minute in-memory cache. */
  private async getStreams(): Promise<IptvStream[]> {
    if (this.streamsCache && Date.now() - this.streamsCache.fetchedAt < CACHE_TTL_MS) {
      return this.streamsCache.data;
    }
    const res = await this.client.get(STREAMS_URL);
    if (!res.isSuccess || !res.body) {
      // streams.json is optional — if it fails, return an empty list and
      // fall back to channel.url (older API shape).
      this.streamsCache = { data: [], fetchedAt: Date.now() };
      return [];
    }

    let arr: IptvStream[];
    try {
      const raw = JSON.parse(res.body);
      if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
        // Format: [[channel, url, title?], ...]
        arr = (raw as unknown[][]).map((r) => ({
          channel: String(r[0] || ""),
          url: String(r[1] || ""),
          title: r[2] != null ? String(r[2]) : undefined,
        }));
      } else {
        // Object form: [{ channel, url, title }, ...]
        arr = (raw as IptvStream[]) || [];
      }
    } catch {
      arr = [];
    }
    this.streamsCache = { data: arr, fetchedAt: Date.now() };
    return arr;
  }

  /** Build a Map<channelId, streamUrl> — first URL wins (skip duplicates). */
  private buildUrlMap(streams: IptvStream[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const s of streams) {
      if (s.channel && s.url && !m.has(s.channel)) {
        m.set(s.channel, s.url);
      }
    }
    return m;
  }

  /** Add a channel to a category bucket in the byCategory map. */
  private pushToCategory(
    byCategory: Map<string, IptvChannel[]>,
    category: string,
    channel: IptvChannel
  ): void {
    const list = byCategory.get(category);
    if (list) list.push(channel);
    else byCategory.set(category, [channel]);
  }

  /** Normalize the `categories` / `category` field to a string array. */
  private getCategories(c: IptvChannel): string[] {
    const cats = c.categories ?? c.category;
    if (cats == null) return [];
    if (Array.isArray(cats)) {
      return cats
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0);
    }
    if (typeof cats === "string") {
      // Some channels use ";" or "," as a separator.
      return cats
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  }

  /** Normalize alt_names (string | string[]) to a single string for search. */
  private asString(v: string | string[] | undefined): string {
    if (v == null) return "";
    if (Array.isArray(v)) return v.join(" ");
    return String(v);
  }

  /** Build a SearchResponse for a channel — encodes the channel id in the URL. */
  private toSearchResponse(c: IptvChannel, streamUrl: string): SearchResponse {
    const channelId = c.id || c.name || "";
    return {
      name: c.name || channelId,
      url: `${this.mainUrl}/?channel=${encodeURIComponent(channelId)}`,
      apiName: this.name,
      type: TvType.Live,
      posterUrl: c.logo,
      logoUrl: c.logo,
      // Stash the stream URL in syncData so load() can skip the streams.json
      // lookup if needed (small optimization).
      syncData: streamUrl ? { streamUrl } : undefined,
    };
  }

  /** Pull the channel id out of a URL we emitted via toSearchResponse(). */
  private extractChannelId(url: string): string | null {
    if (!url) return null;
    const m = url.match(/[?&]channel=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    // Fallback: last path segment
    const seg = url.substring(url.lastIndexOf("/") + 1);
    return seg || null;
  }
}
