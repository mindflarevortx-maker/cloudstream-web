/**
 * CloudStream Web — Core Type Definitions
 * Ported from library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt
 *
 * This is the TypeScript port of the CloudStream extension contract.
 * Extensions written in TS implement MainAPI and register with the provider registry.
 */

/** TvType enum — 18 values matching the original CloudStream */
export enum TvType {
  Movie = "Movie",
  Anime = "Anime",
  AsianDrama = "AsianDrama",
  TvSeries = "TvSeries",
  Torrent = "Torrent",
  Documentaries = "Documentaries",
  Live = "Live",
  NSFW = "NSFW",
  Others = "Others",
  Music = "Music",
  AudioBook = "AudioBook",
  CustomMedia = "CustomMedia",
  Audio = "Audio",
  Podcast = "Podcast",
  Audiobook = "Audiobook",
}

/** Score — fixed-point integer in [0, 10^9] to avoid float comparison bugs */
export class Score {
  private readonly value: bigint;
  static readonly MAX: bigint = BigInt(1_000_000_000);

  private constructor(value: bigint) {
    this.value = value < BigInt(0) ? BigInt(0) : value > Score.MAX ? Score.MAX : value;
  }

  static from(intValue: number): Score {
    return new Score(BigInt(Math.round(intValue)));
  }

  static fromFloat(floatValue: number): Score {
    // floatValue in [0, 10] → int in [0, 10^9]
    const clamped = Math.max(0, Math.min(10, floatValue));
    return new Score(BigInt(Math.round(clamped * 1e8)));
  }

  toInt(): number {
    return Number(this.value);
  }

  toFloat(): number {
    return Number(this.value) / 1e8;
  }

  compareTo(other: Score): number {
    if (this.value < other.value) return -1;
    if (this.value > other.value) return 1;
    return 0;
  }
}

/** DubStatus — for anime providers that support sub vs dub */
export enum DubStatus {
  None = "None",
  Subbed = "Subbed",
  Dubbed = "Dubbed",
}

/** DubProgress — optional progress annotation */
export interface DubProgress {
  status: DubStatus;
  episodes: number;
}

/** SearchResponse — base interface for search results */
export interface SearchResponse {
  name: string;
  url: string;
  apiName: string;
  type: TvType;
  posterUrl?: string;
  backgroundUrl?: string;
  logoUrl?: string;
  quality?: string;
  score?: Score;
  episodes?: DubProgress[];
  comingSoon?: boolean;
  syncData?: Record<string, string>;
}

/** Concrete search response subclasses */
export interface AnimeSearchResponse extends SearchResponse {
  type: TvType.Anime;
  dubStatus?: DubStatus[];
}

export interface MovieSearchResponse extends SearchResponse {
  type: TvType.Movie;
  year?: number;
  imdbId?: string;
  tmdbId?: string;
}

export interface LiveSearchResponse extends SearchResponse {
  type: TvType.Live;
  lang?: string;
}

export interface TorrentSearchResponse extends SearchResponse {
  type: TvType.Torrent;
  seeders?: number;
  size?: string;
  leechers?: number;
}

export interface TvSeriesSearchResponse extends SearchResponse {
  type: TvType.TvSeries;
  episodes?: DubProgress[];
}

/** Episode — represents a playable episode */
export interface Episode {
  name?: string;
  season: number;
  episode: number;
  data?: string;
  posterUrl?: string;
  rating?: number;
  description?: string;
  date?: string;
  airDate?: string;
  episodeIndex?: number;
  totalEpisodeIndex?: number;
  isUpcoming?: boolean;
}

/** EpisodeResponse — base interface for load responses */
export interface EpisodeResponse {
  episodes: Episode[];
  seasons?: SeasonData[];
}

/** SeasonData */
export interface SeasonData {
  name: string;
  season: number;
}

/** LoadResponse — base interface for full title detail */
export interface LoadResponse {
  name: string;
  url: string;
  apiName: string;
  type: TvType;
  dataUrl?: string;
  posterUrl?: string;
  backgroundUrl?: string;
  logoUrl?: string;
  plot?: string;
  rating?: number;
  tags?: string[];
  duration?: string;
  trailers?: string[];
  date?: string;
  syncData?: Record<string, string>;
  comingSoon?: boolean;
  recommendations?: SearchResponse[];
  actors?: Actor[];
}

export interface Actor {
  name: string;
  imageUrl?: string;
}

/** Concrete load response subclasses */
export interface AnimeLoadResponse extends LoadResponse, EpisodeResponse {
  type: TvType.Anime;
  dubStatus: DubStatus[];
  showStatus?: ShowStatus;
}

export interface MovieLoadResponse extends LoadResponse {
  type: TvType.Movie;
  year?: number;
  imdbId?: string;
  tmdbId?: string;
}

export interface LiveStreamLoadResponse extends LoadResponse {
  type: TvType.Live;
  lang?: string;
}

export interface TorrentLoadResponse extends LoadResponse {
  type: TvType.Torrent;
  seeders?: number;
  size?: string;
  leechers?: number;
  magnet?: string;
}

export interface TvSeriesLoadResponse extends LoadResponse, EpisodeResponse {
  type: TvType.TvSeries;
  showStatus?: ShowStatus;
}

/** ShowStatus */
export enum ShowStatus {
  Completed = "Completed",
  Ongoing = "Ongoing",
}

/** HomePageList — a rail on the home screen */
export interface HomePageList {
  name: string;
  list: SearchResponse[];
  hasNext?: boolean;
}

/** HomePageResponse — what getMainPage returns */
export interface HomePageResponse {
  items: HomePageList[];
}

/** MainPageRequest — a request for a specific home page section */
export interface MainPageRequest {
  name: string;
  url: string;
}

/** ExtractorLink — a playable video link */
export interface ExtractorLink {
  name: string;
  url: string;
  referer?: string;
  quality?: string;
  headers?: Record<string, string>;
  type?: ExtractorLinkType;
  source?: string;
  isM3u8?: boolean;
  isDash?: boolean;
  drmKey?: string;
  drmLicenseUri?: string;
  drmScheme?: string;
}

export enum ExtractorLinkType {
  Video = "Video",
  M3u8 = "M3u8",
  Dash = "Dash",
  Torrent = "Torrent",
  Magnet = "Magnet",
}

/** SubtitleFile — a subtitle track */
export interface SubtitleFile {
  name: string;
  url: string;
  language?: string;
  format?: string;
}

/** SyncIdName — identifiers for sync providers */
export enum SyncIdName {
  Anilist = "Anilist",
  MyAnimeList = "MyAnimeList",
  Kitsu = "Kitsu",
  Trakt = "Trakt",
  Imdb = "Imdb",
  Simkl = "Simkl",
  LocalList = "LocalList",
}

/** AbstractSyncStatus — watch progress from a sync provider */
export interface AbstractSyncStatus {
  status?: string;
  score?: number;
  watchedEpisodes?: number;
  isFavorite?: boolean;
  maxEpisodes?: number;
}

/** LibraryItem — an item in a sync provider's library */
export interface LibraryItem {
  id: string;
  title: string;
  posterUrl?: string;
  status?: string;
  score?: number;
  watchedEpisodes?: number;
  maxEpisodes?: number;
}

/** LibraryMetadata — metadata about a library */
export interface LibraryMetadata {
  name: string;
  items: LibraryItem[];
}

/** Tracker — anime ID mapping from APIHolder.getTracker */
export interface Tracker {
  malId?: number;
  kitsuId?: number;
  aniId?: number;
  image?: string;
  cover?: string;
}

/** QualityDataHelper — source/quality priority per profile */
export interface QualityProfile {
  id: number;
  name: string;
  priorities: Record<string, number>; // apiName → priority
  qualityPriorities: Record<string, number>; // quality label → priority
}

/** VideoClickAction — what happens when user clicks play */
export interface VideoClickAction {
  name: string;
  oneSource?: boolean;
  isPlayer?: boolean;
  sourceTypes?: string[];
  uniqueId?: string;
}

/** Event — pub/sub primitive (matches the Android Event<T>) */
export class Event<T> {
  private subscribers = new Set<(data: T) => void>();

  subscribe(handler: (data: T) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  invoke(data: T): void {
    this.subscribers.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error("[Event] subscriber threw:", e);
      }
    });
  }

  get hasSubscribers(): boolean {
    return this.subscribers.size > 0;
  }
}
