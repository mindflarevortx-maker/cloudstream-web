/**
 * CloudStream Web — InternetArchiveProvider
 * Ported from repo/extensions-repo/InternetArchiveProvider/src/main/kotlin/recloudstream/InternetArchiveProvider.kt
 * (457 lines of Kotlin — see worklog Task E4 §6.2 for a thorough write-up.)
 *
 * Internet Archive is a public library at archive.org with no auth required.
 * It exposes:
 *   - GET /advancedsearch.php?q=<query>&fl[]=identifier&fl[]=title&fl[]=mediatype&rows=N&page=M&output=json
 *     → returns { response: { docs: [ { identifier, title, mediatype }, ... ] } }
 *   - GET /metadata/<identifier>
 *     → returns { metadata: { ... }, files: [ { name, format, length, size, height, ... }, ... ], dir, server }
 *   - GET /services/img/<identifier>
 *     → poster image
 *   - GET /download/<identifier>/<filename>  OR  https://<server><dir>/<filename>
 *     → direct media file (archive.org serves files directly — no extractor needed)
 *
 * Key Kotlin behaviors ported:
 *   1. Home page is multi-rail (Movies / Audio / Texts / Software — one rail per mediatype).
 *      (The Kotlin original only had a single "Featured" rail of movies; we generalize to four
 *      rails to surface the other mediatypes archive.org offers — see task spec.)
 *   2. Search uses `+mediatype:(movies OR audio)` so audio items are also searchable.
 *   3. Load re-fetches metadata for the identifier and decides single-file (Movie) vs
 *      multi-file (TvSeries-style playlist) by deduping files on a "unique name" key.
 *   4. loadLinks: for playlists, the episode `data` field carries a JSON-serialized
 *      LoadData { urlData: URLData[], type: "video-playlist" }. We filter out the auto-
 *      generated IA derivatives (format ending in "IA"), sort by size desc, and emit each
 *      as an ExtractorLink. For single-file items, `data` is the bare identifier — we
 *      re-fetch metadata and emit every video file as a direct link.
 *   5. archive.org's JSON is heterogeneous — `subject` and `creator` may be either a
 *      single string or an array. The Kotlin port handled this with Jackson's
 *      ACCEPT_SINGLE_VALUE_AS_ARRAY; here we normalize at parse time with `asArray()`.
 */

import { MainAPI } from "../MainAPI";
import {
  TvType,
  SearchResponse,
  LoadResponse,
  TvSeriesLoadResponse,
  HomePageResponse,
  HomePageList,
  MainPageRequest,
  ExtractorLink,
  SubtitleFile,
  Episode,
  ExtractorLinkType,
  Actor,
} from "../types";

// ---------------------------------------------------------------------------
// archive.org JSON shapes (subset of fields we actually use)
// ---------------------------------------------------------------------------

interface IASearchResponse {
  response?: {
    docs?: IASearchEntry[];
    numFound?: number;
  };
}

interface IASearchEntry {
  identifier: string;
  mediatype: string;
  title?: string;
}

interface IAMetadataResult {
  metadata?: IAMediaEntry;
  files?: IAMediaFile[];
  dir?: string;
  server?: string;
}

interface IAMediaEntry {
  identifier: string;
  mediatype?: string;
  title?: string;
  description?: string;
  subject?: string | string[];
  creator?: string | string[];
  date?: string;
}

interface IAMediaFile {
  name: string;
  format?: string;
  title?: string;
  original?: string;
  length?: string | number;
  size?: number;
  height?: number;
}

/** LoadData — payload serialized into Episode.data for playlist entries. */
interface LoadData {
  urlData: URLData[];
  type: string; // "video-playlist" for the multi-file branch
}

interface URLData {
  url: string;
  format: string;
  size: number;
  quality: number;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class InternetArchiveProvider extends MainAPI {
  override name = "Internet Archive";
  override mainUrl = "https://archive.org";
  override lang = "en";
  override supportedTypes: TvType[] = [
    TvType.Movie,
    TvType.Documentaries,
    TvType.AudioBook,
    TvType.Others,
  ];
  override hasMainPage = true;

  /** One MainPageRequest per home rail — we surface 4 mediatypes. */
  override mainPage: MainPageRequest[] = [
    { name: "Movies", url: "movies" },
    { name: "Audio", url: "audio" },
    { name: "Texts", url: "texts" },
    { name: "Software", url: "software" },
  ];

  // ---- getMainPage ------------------------------------------------------

  override async getMainPage(
    page: number = 1,
    _request: MainPageRequest | null = null
  ): Promise<HomePageResponse> {
    const rails: { name: string; mediatype: string }[] = [
      { name: "Movies", mediatype: "movies" },
      { name: "Audio", mediatype: "audio" },
      { name: "Texts", mediatype: "texts" },
      { name: "Software", mediatype: "software" },
    ];

    const items: HomePageList[] = [];

    for (const rail of rails) {
      try {
        const url =
          `${this.mainUrl}/advancedsearch.php?q=mediatype:(${rail.mediatype})` +
          `&fl[]=identifier&fl[]=title&fl[]=mediatype&rows=26&page=${page}&output=json`;
        const res = await this.client.get(url);
        if (!res.isSuccess || !res.body) continue;
        const parsed = JSON.parse(res.body) as IASearchResponse;
        const docs = parsed?.response?.docs ?? [];
        const list: SearchResponse[] = docs.map((e) => this.toSearchResponse(e));
        items.push({ name: rail.name, list, hasNext: list.length >= 26 });
      } catch (e) {
        console.warn(`[InternetArchive] getMainPage rail ${rail.name} failed:`, e);
      }
    }

    return { items };
  }

  // ---- search -----------------------------------------------------------

  override async search(query: string, page: number = 1): Promise<SearchResponse[]> {
    const q = encodeURIComponent(query);
    const url =
      `${this.mainUrl}/advancedsearch.php?q=${q}+mediatype:(movies+OR+audio)` +
      `&fl[]=identifier&fl[]=title&fl[]=mediatype&rows=26&page=${page}&output=json`;
    try {
      const res = await this.client.get(url);
      if (!res.isSuccess || !res.body) return [];
      const parsed = JSON.parse(res.body) as IASearchResponse;
      const docs = parsed?.response?.docs ?? [];
      return docs.map((e) => this.toSearchResponse(e));
    } catch (e) {
      console.warn(`[InternetArchive] search failed:`, e);
      return [];
    }
  }

  // ---- load -------------------------------------------------------------

  override async load(url: string): Promise<LoadResponse> {
    const identifier = url.substring(url.lastIndexOf("/") + 1);
    const metaUrl = `${this.mainUrl}/metadata/${identifier}`;
    const res = await this.client.get(metaUrl);
    if (!res.isSuccess || !res.body) {
      throw new Error(`InternetArchive: metadata fetch failed (${res.statusCode})`);
    }
    let data: IAMetadataResult;
    try {
      data = JSON.parse(res.body) as IAMetadataResult;
    } catch (e) {
      throw new Error(`InternetArchive: invalid JSON response (${e})`);
    }
    return this.toLoadResponse(data);
  }

  // ---- loadLinks --------------------------------------------------------

  override async loadLinks(
    data: string,
    _isCasting: boolean,
    _subtitleCallback: (subtitle: SubtitleFile) => void,
    callback: (link: ExtractorLink) => void
  ): Promise<boolean> {
    let load: LoadData | null = null;
    try {
      const parsed = JSON.parse(data) as LoadData;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.urlData)) {
        load = parsed;
      }
    } catch {
      // not JSON — treat `data` as a bare identifier (single-file item)
    }

    if (load && load.type === "video-playlist") {
      // Playlist branch: the data field carries a pre-resolved Set<URLData>.
      // Filter out archive.org's auto-generated IA derivatives (low quality).
      const distinctURLData = (load.urlData ?? []).filter(
        (u) => !u.format.endsWith("IA")
      );
      const multi = distinctURLData.length > 1;
      // Sort by size descending — matches the Kotlin sort behavior.
      distinctURLData.sort((a, b) => b.size - a.size);
      for (const u of distinctURLData) {
        const name = multi ? `${this.name} (${u.format})` : this.name;
        const qualityStr = u.quality > 0 ? `${u.quality}p` : undefined;
        callback(
          this.newExtractorLink(this.name, name, u.url, {
            quality: qualityStr,
            referer: "",
            type: ExtractorLinkType.Video,
            isM3u8: u.url.includes(".m3u8"),
            isDash: u.url.includes(".mpd"),
          })
        );
      }
    } else {
      // Single-file branch: `data` is the identifier — re-fetch metadata
      // and emit every video file as a direct ExtractorLink. archive.org
      // serves files directly at https://<server><dir>/<name>.
      const identifier = data;
      try {
        const metaRes = await this.client.get(
          `${this.mainUrl}/metadata/${identifier}`
        );
        if (!metaRes.isSuccess || !metaRes.body) return true;
        const meta = JSON.parse(metaRes.body) as IAMetadataResult;
        const server = meta.server || "ia8001.us.archive.org";
        const dir = meta.dir || "";
        const videoFiles = (meta.files ?? []).filter((f) => this.isVideoFile(f));
        for (const f of videoFiles) {
          const fileUrl = `https://${server}${dir}/${f.name}`;
          const height = f.height ?? 0;
          const qualityStr = height > 0 ? `${height}p` : undefined;
          const label = f.format ? `${this.name} (${f.format})` : this.name;
          callback(
            this.newExtractorLink(this.name, label, fileUrl, {
              quality: qualityStr,
              referer: "",
              type: ExtractorLinkType.Video,
              isM3u8: fileUrl.includes(".m3u8"),
              isDash: fileUrl.includes(".mpd"),
            })
          );
        }
      } catch (e) {
        console.warn(`[InternetArchive] loadLinks single-file failed:`, e);
      }
    }
    return true;
  }

  // ---- helpers ----------------------------------------------------------

  /** Map an advancedsearch.php doc → SearchResponse. */
  private toSearchResponse(entry: IASearchEntry): SearchResponse {
    const type = entry.mediatype === "audio" ? TvType.Audio : TvType.Movie;
    return {
      name: entry.title || entry.identifier,
      url: `${this.mainUrl}/details/${entry.identifier}`,
      apiName: this.name,
      type,
      posterUrl: `${this.mainUrl}/services/img/${entry.identifier}`,
    };
  }

  /** Match the Kotlin file-format filter for "playable video files". */
  private isVideoFile(f: IAMediaFile): boolean {
    const fmt = (f.format || "").toLowerCase();
    return (
      fmt.includes("mpeg") ||
      fmt.startsWith("h.264") ||
      fmt.startsWith("matroska") ||
      fmt.startsWith("divx") ||
      fmt.startsWith("ogg video") ||
      fmt.startsWith("ogv")
    );
  }

  /** Parse archive.org's `length` field — can be a numeric string, "MM:SS", or "HH:MM:SS". */
  private lengthToSeconds(length?: string | number): number {
    if (length == null) return 0;
    if (typeof length === "number") return length;
    const f = parseFloat(length);
    if (!isNaN(f) && !length.includes(":")) return f;
    if (length.includes(":")) {
      const parts = length.split(":").map((p) => parseFloat(p) || 0);
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }

  /** Extract a 4-digit year from a date string (handles YYYY, YYYY-YYYY, free-form dates). */
  private extractYear(date?: string): number | undefined {
    if (!date || date.length < 4) return undefined;
    if (date.length === 4) {
      const y = parseInt(date, 10);
      return isNaN(y) ? undefined : y;
    }
    const rangeMatch = date.match(/\b(\d{4})-(\d{4})\b/);
    if (rangeMatch) return parseInt(rangeMatch[1], 10);
    const yearMatch = date.match(/\b(\d{4})\b/);
    if (yearMatch) return parseInt(yearMatch[1], 10);
    return undefined;
  }

  /**
   * Parse season/episode info from a filename. Mirrors the Kotlin
   * `seasonEpisodePatterns` list (5 regexes tried in order).
   * Returns { season?, episode? } — undefined fields if no pattern matched.
   */
  private extractEpisodeInfo(fileName: string): { season?: number; episode?: number } {
    const patterns: { regex: RegExp; mode: "S01E01" | "Episode" }[] = [
      { regex: /S(\d+)E(\d+)/i, mode: "S01E01" },
      { regex: /S(\d+)\s*E(\d+)/i, mode: "S01E01" },
      { regex: /Season\s*(\d+)\D*Episode\s*(\d+)/i, mode: "S01E01" },
      { regex: /Episode\s*(\d+)\D*Season\s*(\d+)/i, mode: "S01E01" },
      { regex: /Episode\s*(\d+)/i, mode: "Episode" },
    ];
    for (const p of patterns) {
      const m = fileName.match(p.regex);
      if (m) {
        if (p.mode === "S01E01") {
          return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
        } else {
          return { episode: parseInt(m[1], 10) };
        }
      }
    }
    return {};
  }

  /** Map a video height to a CloudStream Qualities integer. */
  private extractQuality(height?: number): number {
    if (height == null) return 0;
    const valid = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    return valid.includes(height) ? height : 0;
  }

  /**
   * Strip directory + extension + underscores → human-readable file name.
   * Matches the Kotlin `getCleanedName`.
   */
  private getCleanedName(fileName: string): string {
    const afterSlash = fileName.substring(fileName.lastIndexOf("/") + 1);
    const dotIdx = afterSlash.lastIndexOf(".");
    const noExt = dotIdx === -1 ? afterSlash : afterSlash.substring(0, dotIdx);
    return noExt.replace(/_/g, " ");
  }

  /**
   * Further normalize to dedupe "version" files (e.g. movie.512kb.mp4 vs
   * movie.mp4) so they count as one entry. Matches the Kotlin `getUniqueName`.
   */
  private getUniqueName(fileName: string): string {
    return this.getCleanedName(fileName)
      .replace(/512kb/g, "")
      .trim();
  }

  /** Normalize archive.org's sometimes-singleton `subject` / `creator` fields to arrays. */
  private asArray(v: string | string[] | undefined): string[] | undefined {
    if (v == null) return undefined;
    if (Array.isArray(v)) return v;
    if (typeof v === "string") return [v];
    return undefined;
  }

  /**
   * Convert the metadata response into a LoadResponse.
   * - Single video file (or any audio) → MovieLoadResponse-style, dataUrl = identifier
   * - Multiple video files (unique by name) → TvSeries-style playlist, episodes
   *   carry a JSON-serialized LoadData in their `data` field.
   */
  private toLoadResponse(data: IAMetadataResult): LoadResponse {
    const meta = data.metadata;
    if (!meta) {
      throw new Error("InternetArchive: metadata missing in response");
    }

    const isAudio = meta.mediatype === "audio";
    const type = isAudio ? TvType.Audio : TvType.Movie;

    const videoFiles = (data.files ?? []).filter(
      (f) => this.isVideoFile(f) && this.lengthToSeconds(f.length) >= 10
    );

    const actors: Actor[] | undefined = this.asArray(meta.creator)?.map((c) => ({
      name: c,
    }));

    const base: LoadResponse = {
      name: meta.title || meta.identifier,
      url: `${this.mainUrl}/details/${meta.identifier}`,
      apiName: this.name,
      type,
      plot: meta.description,
      posterUrl: `${this.mainUrl}/services/img/${meta.identifier}`,
      tags: this.asArray(meta.subject),
      actors,
    };

    const uniqueCount = new Set(
      videoFiles.map((f) => this.getUniqueName(f.original || f.name))
    ).size;

    if (uniqueCount <= 1 || isAudio) {
      // Single-file or audio → return a Movie-style LoadResponse with dataUrl = identifier.
      // (We use the base LoadResponse so we can carry type=Audio for audio items;
      // the strict MovieLoadResponse subtype requires type=TvType.Movie.)
      return { ...base, dataUrl: meta.identifier };
    }

    // Multi-file video item → TvSeries-style playlist.
    const urlMap = new Map<string, URLData[]>();
    for (const f of videoFiles) {
      const cleanedName = this.getCleanedName(f.original || f.name);
      const fileUrl = `https://${data.server || ""}${data.dir || ""}/${f.name}`;
      const quality = this.extractQuality(f.height);
      const urlData: URLData = {
        url: fileUrl,
        format: f.format || "",
        size: f.size ?? 0,
        quality,
      };
      const existing = urlMap.get(cleanedName);
      if (existing) existing.push(urlData);
      else urlMap.set(cleanedName, [urlData]);
    }

    const episodes: Episode[] = [];
    for (const [fileName, urlDataArr] of urlMap) {
      const file = videoFiles.find(
        (f) => this.getCleanedName(f.original || f.name) === fileName
      );
      const epInfo = file
        ? this.extractEpisodeInfo(file.original || file.name)
        : {};
      const loadData: LoadData = {
        urlData: urlDataArr,
        type: "video-playlist",
      };
      episodes.push({
        name: file?.title || fileName,
        season: epInfo.season ?? 0,
        episode: epInfo.episode ?? 0,
        data: JSON.stringify(loadData),
      });
    }
    episodes.sort(
      (a, b) => a.season - b.season || a.episode - b.episode
    );

    const seriesResponse: TvSeriesLoadResponse = {
      ...base,
      type: TvType.TvSeries,
      episodes,
    };
    return seriesResponse;
  }
}
