/**
 * CloudStream Web — Runtime `cs3` API for user-installed JS providers
 *
 * The `cs3` object is the *only* surface a JS provider sees. It is injected
 * into the sandboxed `Function` scope (see `JsProvider.ts`) as a free
 * variable named `cs3`. Plugins reference it directly:
 *
 *   async search(query, page) {
 *     const res  = await cs3.fetch(this.mainUrl + "/search?q=" + query);
 *     const doc  = cs3.parseHtml(res.body);
 *     return doc.querySelectorAll("a.title").map(el => ({
 *       name: el.text,
 *       url:  cs3.fixUrl(el.attr("href"), this.mainUrl),
 *       type: "Movie",
 *     }));
 *   }
 *
 * The API surface is deliberately small (six functions + a TvType constant).
 * Anything outside this list is `undefined` to the plugin — `window`,
 * `document`, `localStorage`, `fetch`, `process`, `require`, etc. are NOT
 * exposed. See `EXTENSION_LOADER_DESIGN.md` §5–6 for the rationale.
 */

import {
  TvType,
  ExtractorLink,
  ExtractorLinkType,
  SubtitleFile,
} from "../types";
import { createHttpClient } from "../http";
import type { HttpClient, HttpResponse } from "../MainAPI";
import { ExtractorRegistry } from "../ExtractorApi";

/* ------------------------------------------------------------------ */
/*  Public types (mirrored in the design doc §5)                       */
/* ------------------------------------------------------------------ */

export interface Cs3FetchOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
}

export interface Cs3FetchResponse {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isSuccess: boolean;
}

/** A tiny DOM-like wrapper that plugins use instead of `document`. */
export interface Cs3Element {
  /** Inner text content (textContent equivalent). */
  readonly text: string;
  /** Outer HTML (innerHTML). */
  readonly html: string;
  /** Attribute lookup, returns null if missing. */
  attr(name: string): string | null;
  querySelector(selector: string): Cs3Element | null;
  querySelectorAll(selector: string): Cs3Element[];
}

export interface Cs3Document extends Cs3Element {
  /** The original HTML source, useful for regex fallbacks. */
  readonly source: string;
}

export interface Cs3ExtractorLinkOptions {
  type?: "Video" | "M3u8" | "Dash" | "Torrent" | "Magnet";
  quality?: string;
  referer?: string;
  headers?: Record<string, string>;
  isM3u8?: boolean;
  isDash?: boolean;
}

export interface Cs3Runtime {
  fetch(url: string, options?: Cs3FetchOptions): Promise<Cs3FetchResponse>;
  parseHtml(html: string): Cs3Document;
  newExtractorLink(
    source: string,
    name: string,
    url: string,
    options?: Cs3ExtractorLinkOptions
  ): ExtractorLink;
  loadExtractor(
    url: string,
    referer?: string,
    subtitleCallback?: (sub: SubtitleFile) => void
  ): Promise<ExtractorLink[]>;
  fixUrl(url: string, base?: string): string;
  base64Decode(str: string): string;
  base64Encode(str: string): string;
  unpackJs(packedScript: string): string;
  /** Frozen object mirroring the TvType enum — `{ Movie: "Movie", ... }`. */
  readonly TvType: Readonly<Record<keyof typeof TvType, string>>;
  /** Convert a 0–10 float rating to a Score object (for SearchResponse.score). */
  scoreFromFloat(value: number): { toInt: () => number; toFloat: () => number; compareTo: (other: unknown) => number };
  /** Convert an integer rating (0–10) to a Score object. */
  scoreFromInt(value: number): { toInt: () => number; toFloat: () => number; compareTo: (other: unknown) => number };
}

/* ------------------------------------------------------------------ */
/*  HTML parsing — thin DOMParser wrapper                              */
/* ------------------------------------------------------------------ */

/**
 * Wrap a native `Element` so plugins see a clean, Array-returning API
 * instead of a live `NodeList`. We deliberately do NOT expose `Element`
 * itself — that would give plugins a path back to `document` via
 * `el.ownerDocument`.
 */
class Cs3ElementImpl implements Cs3Element {
  private readonly node: Element;

  constructor(node: Element) {
    this.node = node;
  }

  get text(): string {
    return this.node.textContent ?? "";
  }

  get html(): string {
    return this.node.innerHTML ?? "";
  }

  attr(name: string): string | null {
    const v = this.node.getAttribute(name);
    return v === null ? null : v;
  }

  querySelector(selector: string): Cs3Element | null {
    const found = this.node.querySelector(selector);
    return found ? new Cs3ElementImpl(found) : null;
  }

  querySelectorAll(selector: string): Cs3Element[] {
    // Convert NodeList → Array<Cs3Element> so plugins can .map/.filter
    // directly without `[].slice.call(...)`.
    return Array.from(this.node.querySelectorAll(selector)).map(
      (n) => new Cs3ElementImpl(n as Element)
    );
  }
}

class Cs3DocumentImpl extends Cs3ElementImpl implements Cs3Document {
  private readonly htmlSource: string;

  constructor(doc: Document, htmlSource: string) {
    super(doc.documentElement);
    this.htmlSource = htmlSource;
  }

  get source(): string {
    return this.htmlSource;
  }
}

/* ------------------------------------------------------------------ */
/*  JavaScript packer unpacker                                         */
/* ------------------------------------------------------------------ */

/**
 * Port of the Kotlin `getAndUnpack()` utility used by Tamilian and many
 * phisher98 providers. Reverses the `eval(function(p,a,c,k,e,d){...})`
 * obfuscation pattern that ad-driven streaming sites use.
 *
 * The unpacker:
 *   1. Extracts the `p,a,c,k,e,d` arguments from the packed payload.
 *   2. Reconstructs the keyword list `k`.
 *   3. Substitutes keywords back into the template `p` (using base-`a`
 *      radix encoding for indices ≥ 10).
 *
 * Returns the unpacked source. If the input doesn't look like a packed
 * payload, returns it unchanged.
 */
function unpackJs(packed: string): string {
  if (!packed || typeof packed !== "string") return packed ?? "";

  // Match: eval(function(p,a,c,k,e,d){...}('payload', radix, count, 'kw0|kw1|...',0,{}))
  const header =
    /eval\s*\(\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\s*,\s*\d+\s*,\s*\{\s*\)\s*\)?/i;
  const m = packed.match(header);
  if (!m) return packed;

  const payload = m[2];
  const radix = parseInt(m[3], 10);
  const keywordStr = m[6];
  const keywords = keywordStr.split("|");

  // The substitution function from the packer — base-`radix` index → kw.
  function unpackToken(token: string): string {
    if (!token) return "";
    const idx = parseInt(token, radix);
    const kw = keywords[idx];
    // If keyword exists, use it; otherwise keep the original token.
    return kw || token;
  }

  // The payload template uses \b-word-boundary tokens. Replace each token
  // (runs of word chars) with the corresponding unpacked keyword.
  return payload.replace(/\b(\w+)\b/g, (_, tok: string) => unpackToken(tok));
}

/* ------------------------------------------------------------------ */
/*  Base64 utilities (UTF-8 safe)                                      */
/* ------------------------------------------------------------------ */

function base64Encode(str: string): string {
  // btoa() chokes on non-Latin1 chars; encode UTF-8 first.
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function base64Decode(str: string): string {
  // atob() returns Latin1; decode as UTF-8.
  const bin = atob(str);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/*  URL fixing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolve a possibly-relative URL against a base. Mirrors the Kotlin
 * `fixUrl` + `fixUrlNull` helpers.
 *
 *   cs3.fixUrl("/movies", "https://example.com") → "https://example.com/movies"
 *   cs3.fixUrl("//cdn.example.com/x", "https://example.com") → "https://cdn.example.com/x"
 *   cs3.fixUrl("https://other.com/y", "https://example.com") → "https://other.com/y"
 */
function fixUrl(url: string, base?: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

  // Already absolute.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Protocol-relative.
  if (trimmed.startsWith("//")) {
    return "https:" + trimmed;
  }

  // Otherwise resolve against `base`.
  const baseUrl = base || "";
  if (!baseUrl) {
    // No base — return as-is (best effort).
    return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    // base is invalid; best effort
    if (trimmed.startsWith("/")) return baseUrl.replace(/\/+$/, "") + trimmed;
    return baseUrl.replace(/\/+$/, "") + "/" + trimmed;
  }
}

/* ------------------------------------------------------------------ */
/*  cs3 factory                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build a `cs3` runtime object. A fresh instance is created per provider
 * load so that future per-provider state (rate-limit buckets, etc.) can
 * be attached without polluting a shared singleton.
 *
 * @param client Optional shared HttpClient — defaults to a new proxy client.
 */
export function createCs3Runtime(client?: HttpClient): Cs3Runtime {
  const http: HttpClient = client ?? createHttpClient();

  /** cs3.fetch — routes through the CORS proxy via http.ts. */
  async function fetch(
    url: string,
    options?: Cs3FetchOptions
  ): Promise<Cs3FetchResponse> {
    const method = options?.method ?? "GET";
    const headers = options?.headers ?? {};
    let res: HttpResponse;
    if (method === "GET") {
      res = await http.get(url, headers);
    } else if (method === "POST") {
      res = await http.post(url, options?.body, headers);
    } else if (method === "HEAD") {
      res = await http.head(url, headers);
    } else {
      // Exhaustive check — `method` is a union of three literals.
      throw new Error(`cs3.fetch: unsupported method "${method}"`);
    }
    return {
      url: res.url,
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body,
      isSuccess: res.isSuccess,
    };
  }

  /** cs3.parseHtml — DOMParser-based HTML parsing. */
  function parseHtml(html: string): Cs3Document {
    if (typeof DOMParser === "undefined") {
      // SSR / non-browser — return an empty doc that yields no elements.
      // Plugins are only ever loaded client-side, so this is defensive.
      const empty = {
        text: "",
        html: "",
        source: html,
        attr: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
      } as unknown as Cs3Document;
      return empty;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return new Cs3DocumentImpl(doc, html);
  }

  /** cs3.newExtractorLink — synthesize a playable ExtractorLink. */
  function newExtractorLink(
    source: string,
    name: string,
    url: string,
    options?: Cs3ExtractorLinkOptions
  ): ExtractorLink {
    let linkType: ExtractorLinkType | undefined;
    if (options?.type) {
      // Map string → enum (the plugin sends strings, the player wants enum).
      switch (options.type) {
        case "Video":
          linkType = ExtractorLinkType.Video;
          break;
        case "M3u8":
          linkType = ExtractorLinkType.M3u8;
          break;
        case "Dash":
          linkType = ExtractorLinkType.Dash;
          break;
        case "Torrent":
          linkType = ExtractorLinkType.Torrent;
          break;
        case "Magnet":
          linkType = ExtractorLinkType.Magnet;
          break;
      }
    }
    return {
      name,
      url,
      source,
      quality: options?.quality,
      referer: options?.referer,
      headers: options?.headers,
      type: linkType,
      isM3u8:
        options?.isM3u8 ??
        (linkType === ExtractorLinkType.M3u8 || url.includes(".m3u8")),
      isDash:
        options?.isDash ??
        (linkType === ExtractorLinkType.Dash || url.includes(".mpd")),
    };
  }

  /** cs3.loadExtractor — dispatch to the built-in ExtractorRegistry. */
  async function loadExtractor(
    url: string,
    referer?: string,
    subtitleCallback?: (sub: SubtitleFile) => void
  ): Promise<ExtractorLink[]> {
    return ExtractorRegistry.loadExtractor(url, referer, subtitleCallback);
  }

  // Frozen TvType mirror — plugins reference as `cs3.TvType.Movie`.
  const tvTypeMirror = Object.freeze({
    Movie: TvType.Movie,
    Anime: TvType.Anime,
    AsianDrama: TvType.AsianDrama,
    TvSeries: TvType.TvSeries,
    Torrent: TvType.Torrent,
    Documentaries: TvType.Documentaries,
    Live: TvType.Live,
    NSFW: TvType.NSFW,
    Others: TvType.Others,
    Music: TvType.Music,
    AudioBook: TvType.AudioBook,
    CustomMedia: TvType.CustomMedia,
    Audio: TvType.Audio,
    Podcast: TvType.Podcast,
    Audiobook: TvType.Audiobook,
  }) as Readonly<Record<keyof typeof TvType, string>>;

  // Score helpers — let JS providers build Score objects without importing the
  // Score class directly. Matches the Score API (toInt, toFloat, compareTo).
  const scoreFromFloat = (value: number) => {
    const clamped = Math.max(0, Math.min(10, value));
    const intVal = BigInt(Math.round(clamped * 1e8));
    return {
      toInt: () => Number(intVal),
      toFloat: () => Number(intVal) / 1e8,
      compareTo: (other: unknown) => {
        const otherInt = typeof other === "object" && other !== null && "toInt" in other
          ? BigInt((other as { toInt: () => number }).toInt())
          : 0n;
        if (intVal < otherInt) return -1;
        if (intVal > otherInt) return 1;
        return 0;
      },
    };
  };
  const scoreFromInt = (value: number) => {
    const intVal = BigInt(Math.round(value));
    return {
      toInt: () => Number(intVal),
      toFloat: () => Number(intVal) / 1e8,
      compareTo: (other: unknown) => {
        const otherInt = typeof other === "object" && other !== null && "toInt" in other
          ? BigInt((other as { toInt: () => number }).toInt())
          : 0n;
        if (intVal < otherInt) return -1;
        if (intVal > otherInt) return 1;
        return 0;
      },
    };
  };

  return {
    fetch,
    parseHtml,
    newExtractorLink,
    loadExtractor,
    fixUrl,
    base64Decode,
    base64Encode,
    unpackJs,
    TvType: tvTypeMirror,
    scoreFromFloat,
    scoreFromInt,
  };
}
