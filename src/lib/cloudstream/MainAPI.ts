/**
 * CloudStream Web — MainAPI Base Class
 * Ported from library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt
 *
 * This is the abstract class every provider extends.
 */

import {
  TvType,
  SearchResponse,
  LoadResponse,
  HomePageResponse,
  HomePageList,
  MainPageRequest,
  ExtractorLink,
  SubtitleFile,
  Episode,
  Score,
} from "./types";

/** HTTP client wrapper — port of nicehttp's Requests */
export interface HttpClient {
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  post(url: string, body?: any, headers?: Record<string, string>): Promise<HttpResponse>;
  head(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
}

export interface HttpResponse {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  bodyBytes: Uint8Array;
  isSuccess: boolean;
}

/**
 * MainAPI — the abstract base class for all providers.
 * Extensions implement the abstract methods and register with the API registry.
 *
 * Mirrors the Kotlin MainAPI contract. Key methods:
 * - getMainPage(): returns home rails
 * - search(): returns search results
 * - quickSearch(): optional fast search (no UI)
 * - load(): returns full title detail (episodes, metadata)
 * - loadLinks(): returns playable video links for an episode
 */
export abstract class MainAPI {
  /** Display name shown in UI */
  abstract name: string;
  /** Base URL of the site */
  abstract mainUrl: string;
  /** Language code (2-letter ISO) */
  lang: string = "en";
  /** Content types this provider supports */
  supportedTypes: TvType[] = [TvType.Movie, TvType.TvSeries];
  /** Sync provider IDs this provider can map (e.g. ["MyAnimeList", "Anilist"]) */
  supportedSyncNames: string[] = [];
  /** Has quick search support */
  hasQuickSearch: boolean = false;
  /** Has main page (home rails) support */
  hasMainPage: boolean = false;
  /** Supports download */
  hasDownloadSupport: boolean = true;
  /** Supports Chromecast */
  hasChromecastSupport: boolean = true;
  /** Uses WebView (always false on web — no WebView) */
  usesWebView: boolean = false;
  /** Instant link loading (no extractor needed) */
  instantLinkLoading: boolean = false;
  /** Sequential main page loading (vs parallel) */
  sequentialMainPage: boolean = false;
  /** Delay between sequential main page calls */
  sequentialMainPageDelay: number = 0;
  /** Home page sections */
  mainPage: MainPageRequest[] = [];

  /** The HTTP client (injected by the framework) */
  protected _client?: HttpClient;
  get client(): HttpClient {
    if (!this._client) throw new Error("MainAPI: client not initialized");
    return this._client;
  }
  setClient(client: HttpClient): void {
    this._client = client;
  }

  /** Get the home page rails (optional — implement if hasMainPage=true) */
  async getMainPage(page: number = 1, request: MainPageRequest | null = null): Promise<HomePageResponse> {
    throw new Error(`${this.name}: getMainPage not implemented`);
  }

  /** Search the site for a query */
  async search(query: string, page: number = 1): Promise<SearchResponse[]> {
    throw new Error(`${this.name}: search not implemented`);
  }

  /** Quick search (instant, autocomplete-style) */
  async quickSearch(query: string): Promise<SearchResponse[]> {
    throw new Error(`${this.name}: quickSearch not implemented`);
  }

  /** Load full title detail (episodes, metadata) */
  async load(url: string): Promise<LoadResponse> {
    throw new Error(`${this.name}: load not implemented`);
  }

  /** Load playable video links for an episode or data payload */
  async loadLinks(
    data: string,
    isCasting: boolean,
    subtitleCallback: (subtitle: SubtitleFile) => void,
    callback: (link: ExtractorLink) => void
  ): Promise<boolean> {
    throw new Error(`${this.name}: loadLinks not implemented`);
  }

  /** Get sync locations (for sync providers to match against) */
  getSyncLocations?: (syncData: Record<string, string>) => string[];

  /** Get video interceptor (optional, for anti-bot — no-op on web) */
  getVideoInterceptor?(): null { return null; }

  /** Get load URL (for sync URL → provider URL translation) */
  async getLoadUrl(syncName: string, url: string): Promise<string | null> {
    return null;
  }

  /** Helper: fix a relative URL against mainUrl */
  protected fixUrl(url: string): string {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return this.mainUrl + url;
    return this.mainUrl + "/" + url;
  }

  /** Helper: create a new ExtractorLink */
  protected newExtractorLink(
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
      referer: options?.referer || this.mainUrl,
      headers: options?.headers,
      type: options?.type,
      isM3u8: options?.isM3u8 || url.includes(".m3u8"),
      isDash: options?.isDash || url.includes(".mpd"),
      ...options,
    };
  }

  /** Helper: convert a rating float (0-10) to Score */
  protected toScore(rating?: number): Score | undefined {
    if (rating == null || isNaN(rating)) return undefined;
    return Score.fromFloat(rating);
  }
}

/** APIHolder — the global provider registry (mirrors Android APIHolder) */
export class APIHolder {
  static providers: MainAPI[] = [];
  static providerMap: Map<string, MainAPI> = new Map();

  /** Register a provider (called by plugins / built-in providers) */
  static registerProvider(provider: MainAPI): void {
    if (APIHolder.providerMap.has(provider.name)) {
      console.warn(`[APIHolder] Overwriting provider: ${provider.name}`);
      const existing = APIHolder.providerMap.get(provider.name)!;
      APIHolder.providers = APIHolder.providers.filter((p) => p.name !== provider.name);
    }
    APIHolder.providers.push(provider);
    APIHolder.providerMap.set(provider.name, provider);
  }

  /** Get a provider by name */
  static getApiByName(name: string): MainAPI | null {
    return APIHolder.providerMap.get(name) || null;
  }

  /** Get a provider by URL (first whose mainUrl is a prefix) */
  static getApiFromUrl(url: string): MainAPI | null {
    for (const provider of APIHolder.providers) {
      if (url.startsWith(provider.mainUrl)) return provider;
    }
    return null;
  }

  /** Get all providers */
  static getAllProviders(): MainAPI[] {
    return [...APIHolder.providers];
  }

  /** Get all enabled providers (for now, all are enabled) */
  static getEnabledProviders(): MainAPI[] {
    return APIHolder.getAllProviders();
  }

  /** Unregister a provider by name (mirrors Android's plugin unload path). */
  static unregisterProvider(name: string): boolean {
    const provider = APIHolder.providerMap.get(name);
    if (!provider) return false;
    APIHolder.providerMap.delete(name);
    APIHolder.providers = APIHolder.providers.filter((p) => p.name !== name);
    return true;
  }
}
