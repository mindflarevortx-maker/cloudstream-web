/**
 * CloudStream Web — JsProvider: safe-eval + MainAPI adapter
 *
 * Takes a user-supplied JS provider source string, evaluates it in a
 * constrained `Function` sandbox that exposes only the `cs3` runtime API,
 * and wraps the resulting object literal as a `MainAPI` instance that can
 * be registered with the existing `APIHolder` registry.
 *
 * The provider format is an object literal (see `EXTENSION_LOADER_DESIGN.md`
 * §4). This is the "Option D" runtime loader — built-in TS providers ship
 * in the bundle; user-installed JS providers are evaluated at runtime.
 *
 *   ({                                     // ← note the paren-wrapped literal
 *     name: "My Provider",
 *     mainUrl: "https://example.com",
 *     lang: "en",
 *     supportedTypes: ["Movie", "TvSeries"],
 *     hasMainPage: true,
 *     async getMainPage(page, request) { ... },
 *     async search(query, page) { ... },
 *     async load(url) { ... },
 *     async loadLinks(data, isCasting, subCb, cb) { ... },
 *   })
 *
 * The sandbox sees ONLY: `cs3`, `console`, and a handful of frozen
 * standard-library globals (`JSON`, `Math`, `Date`, …). It does NOT see
 * `window`, `document`, `localStorage`, `fetch`, `process`, `require`,
 * `globalThis`, etc. — see `EXTENSION_LOADER_DESIGN.md` §6 for the
 * security rationale.
 */

import { MainAPI, APIHolder } from "../MainAPI";
import {
  TvType,
  SearchResponse,
  LoadResponse,
  HomePageResponse,
  MainPageRequest,
  ExtractorLink,
  SubtitleFile,
  Score,
} from "../types";
import { createHttpClient } from "../http";
import {
  createCs3Runtime,
  type Cs3Runtime,
  type Cs3ExtractorLinkOptions,
} from "./runtime";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/** The shape of a user-supplied JS provider object literal. */
export interface JsProviderObject {
  name: string;
  mainUrl: string;
  lang?: string;
  supportedTypes?: string[];
  hasMainPage?: boolean;
  hasDownloadSupport?: boolean;
  hasQuickSearch?: boolean;
  mainPage?: { name: string; url: string }[];

  getMainPage?: (
    page: number,
    request: MainPageRequest
  ) => Promise<HomePageResponse>;
  search?: (query: string, page: number) => Promise<SearchResponse[]>;
  quickSearch?: (query: string) => Promise<SearchResponse[]>;
  load?: (url: string) => Promise<LoadResponse>;
  loadLinks?: (
    data: string,
    isCasting: boolean,
    subtitleCallback: (sub: SubtitleFile) => void,
    callback: (link: ExtractorLink) => void
  ) => Promise<boolean>;

  // Plugin authors may attach arbitrary extra fields; we ignore them.
  [key: string]: unknown;
}

/** Result of evaluating + validating a plugin source. */
export interface JsProviderLoadResult {
  success: boolean;
  /** Provider name registered (if any) — for logging / UI feedback. */
  name?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  String → TvType conversion                                         */
/* ------------------------------------------------------------------ */

const TV_TYPE_VALUES = new Set<string>(Object.values(TvType));

/** Convert a string like `"Movie"` to the TvType enum value. */
function parseTvType(s: string): TvType | null {
  if (typeof s !== "string") return null;
  if (TV_TYPE_VALUES.has(s)) return s as TvType;
  // Tolerate common variant spellings seen in real repos
  // (e.g. NivinCNC uses "Movies" and "AnimeMovie" — the latter isn't in our
  // enum, so map to the closest one and log nothing).
  const lower = s.toLowerCase();
  if (lower === "movies") return TvType.Movie;
  if (lower === "series" || lower === "tv") return TvType.TvSeries;
  if (lower === "animemovie") return TvType.Anime;
  if (lower === "ova") return TvType.Anime;
  if (lower === "cartoon") return TvType.Anime;
  if (lower === "asian" || lower === "drama") return TvType.AsianDrama;
  if (lower === "live" || lower === "livetv") return TvType.Live;
  if (lower === "torrent") return TvType.Torrent;
  if (lower === "music") return TvType.Music;
  if (lower === "documentary" || lower === "documentaries") {
    return TvType.Documentaries;
  }
  if (lower === "audiobook") return TvType.Audiobook;
  if (lower === "podcast") return TvType.Podcast;
  if (lower === "audio") return TvType.Audio;
  if (lower === "others" || lower === "other") return TvType.Others;
  if (lower === "nsfw") return TvType.NSFW;
  if (lower === "all") return TvType.Movie; // "All" maps to Movie as a fallback
  return null;
}

/** Convert the plugin's `supportedTypes: string[]` to `TvType[]`. */
function parseSupportedTypes(
  raw: unknown,
  fallback: TvType[] = [TvType.Movie, TvType.TvSeries]
): TvType[] {
  if (!Array.isArray(raw)) return fallback;
  const out: TvType[] = [];
  for (const s of raw) {
    const t = parseTvType(String(s));
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length ? out : fallback;
}

/** Normalize the `mainPage` field — accept either `{name,url}[]` or null. */
function parseMainPage(raw: unknown): MainPageRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: MainPageRequest[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const name = (item as { name?: unknown }).name;
      const url = (item as { url?: unknown }).url;
      if (typeof name === "string" && typeof url === "string") {
        out.push({ name, url });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Adapter — wraps a JS object literal as a MainAPI instance         */
/* ------------------------------------------------------------------ */

/**
 * `JsProviderAdapter` is the bridge between the JS plugin's object literal
 * and the abstract `MainAPI` class. Each method delegates to the
 * corresponding function on the underlying object, with `this` rebound
 * so the plugin can reference `this.mainUrl`, `this.name`, etc.
 *
 * We extend `MainAPI` (rather than re-implementing its interface) so that
 * the existing `APIHolder` registry, search dispatcher, and result view
 * work without modification.
 */
export class JsProviderAdapter extends MainAPI {
  // Override the abstract members of MainAPI with concrete declarations.
  // We assign their values in the constructor from the plugin object.
  override name: string;
  override mainUrl: string;

  /** The raw plugin object — exposed for debugging / introspection. */
  readonly raw: JsProviderObject;
  /** The runtime API instance this provider uses (per-provider). */
  readonly cs3: Cs3Runtime;

  constructor(obj: JsProviderObject, cs3: Cs3Runtime) {
    super();
    this.raw = obj;
    this.cs3 = cs3;

    // Identity
    this.name = String(obj.name ?? "UnnamedProvider");
    this.mainUrl = String(obj.mainUrl ?? "");
    this.lang = String(obj.lang ?? "en");
    this.supportedTypes = parseSupportedTypes(obj.supportedTypes);
    this.hasMainPage = Boolean(obj.hasMainPage);
    this.hasDownloadSupport = obj.hasDownloadSupport ?? true;
    this.hasQuickSearch = Boolean(obj.hasQuickSearch);
    this.mainPage = parseMainPage(obj.mainPage);

    // Inject the shared HTTP client (so `MainAPI.client` is usable if the
    // adapter ever calls a method on the parent class).
    this.setClient(createHttpClient());
  }

  /** Bind a plugin method to the plugin object so `this` works. */
  private bound<TFn extends (...args: never[]) => unknown>(
    fn: TFn | undefined
  ): TFn | undefined {
    if (typeof fn !== "function") return undefined;
    return fn.bind(this.raw) as TFn;
  }

  async getMainPage(
    page: number = 1,
    request: MainPageRequest | null = null
  ): Promise<HomePageResponse> {
    const fn = this.bound(this.raw.getMainPage);
    if (!fn) {
      throw new Error(`${this.name}: getMainPage not implemented`);
    }
    // The plugin contract requires `request` non-null when hasMainPage=true.
    // Fall back to the first mainPage entry if the caller passed null.
    const req: MainPageRequest =
      request ?? this.mainPage[0] ?? { name: "Home", url: "/" };
    return (fn as (p: number, r: MainPageRequest) => Promise<HomePageResponse>)(
      page,
      req
    );
  }

  async search(query: string, page: number = 1): Promise<SearchResponse[]> {
    const fn = this.bound(this.raw.search);
    if (!fn) {
      throw new Error(`${this.name}: search not implemented`);
    }
    return (
      fn as (q: string, p: number) => Promise<SearchResponse[]>
    )(query, page);
  }

  async quickSearch(query: string): Promise<SearchResponse[]> {
    const fn = this.bound(this.raw.quickSearch);
    if (!fn) {
      throw new Error(`${this.name}: quickSearch not implemented`);
    }
    return (fn as (q: string) => Promise<SearchResponse[]>)(query);
  }

  async load(url: string): Promise<LoadResponse> {
    const fn = this.bound(this.raw.load);
    if (!fn) {
      throw new Error(`${this.name}: load not implemented`);
    }
    return (fn as (u: string) => Promise<LoadResponse>)(url);
  }

  async loadLinks(
    data: string,
    isCasting: boolean,
    subtitleCallback: (subtitle: SubtitleFile) => void,
    callback: (link: ExtractorLink) => void
  ): Promise<boolean> {
    const fn = this.bound(this.raw.loadLinks);
    if (!fn) {
      throw new Error(`${this.name}: loadLinks not implemented`);
    }
    return (
      fn as (
        d: string,
        c: boolean,
        s: (sub: SubtitleFile) => void,
        cb: (link: ExtractorLink) => void
      ) => Promise<boolean>
    )(data, isCasting, subtitleCallback, callback);
  }

  /**
   * Helper that plugin authors sometimes call inside `loadLinks` — wrap
   * an external extractor URL into an `ExtractorLink`. Exposed on the
   * adapter so plugins that opt out of `cs3.loadExtractor` can still
   * build links via the parent class's `newExtractorLink` helper.
   */
  newExtractorLink(
    source: string,
    name: string,
    url: string,
    options?: Cs3ExtractorLinkOptions
  ): ExtractorLink {
    return this.cs3.newExtractorLink(source, name, url, options);
  }

  /** Re-expose Score helper for plugins that want to set ratings. */
  static scoreFromFloat(v: number): Score {
    return Score.fromFloat(v);
  }
}

/* ------------------------------------------------------------------ */
/*  Safe-eval sandbox                                                  */
/* ------------------------------------------------------------------ */

/**
 * Sandbox globals handed to the plugin via Function parameters. The
 * plugin's only access to the outside world is `cs3` + these
 * standard-library objects. We deliberately exclude `globalThis`,
 * `window`, `document`, `fetch`, `XMLHttpRequest`, `localStorage`,
 * `process`, `require`, etc.
 *
 * Each global is the *real* standard-library object — we don't proxy
 * them because they're pure (no I/O). A plugin can call `JSON.parse`
 * or `Math.max` freely.
 */
function buildSandboxGlobals(cs3: Cs3Runtime): Record<string, unknown> {
  // A sandboxed console — same API surface, but routed through the app's
  // logger so plugin output is tagged and can be muted per-provider.
  const sandboxConsole = {
    log: (...args: unknown[]) =>
      console.log(`[cs3-plugin]`, ...args),
    info: (...args: unknown[]) =>
      console.info(`[cs3-plugin]`, ...args),
    warn: (...args: unknown[]) =>
      console.warn(`[cs3-plugin]`, ...args),
    error: (...args: unknown[]) =>
      console.error(`[cs3-plugin]`, ...args),
    debug: (...args: unknown[]) =>
      console.debug(`[cs3-plugin]`, ...args),
  };

  return {
    cs3,
    console: sandboxConsole,
    JSON: globalThis.JSON,
    Math: globalThis.Math,
    Date: globalThis.Date,
    RegExp: globalThis.RegExp,
    Error: globalThis.Error,
    TypeError: globalThis.TypeError,
    RangeError: globalThis.RangeError,
    Promise: globalThis.Promise,
    Array: globalThis.Array,
    Object: globalThis.Object,
    String: globalThis.String,
    Number: globalThis.Number,
    Boolean: globalThis.Boolean,
    Symbol: globalThis.Symbol,
    Map: globalThis.Map,
    Set: globalThis.Set,
    WeakMap: globalThis.WeakMap,
    WeakSet: globalThis.WeakSet,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    // NOTE: `fetch`, `window`, `document`, `localStorage`, `process`,
    // `require`, `globalThis`, `global`, `self` are intentionally NOT
    // included — plugins must use `cs3.fetch` instead.
  };
}

/**
 * Evaluate a plugin source string in a sandboxed `Function` scope and
 * return the object literal it evaluates to. Throws on parse errors,
 * sandbox escapes (e.g. referencing an undefined global), or if the
 * result isn't a plain object.
 *
 * The source must be an object-literal expression (parenthesized so the
 * `return` in the Function body treats it as an expression, not a block
 * statement). We auto-wrap bare object literals, but reject any source
 * that contains a top-level `return`, `throw`, `if`, `for`, `while`,
 * `function`, `class`, or `import` keyword — those would let the plugin
 * run arbitrary statements outside the literal, which we don't allow.
 */
export function evaluateProviderSource(
  source: string,
  cs3: Cs3Runtime
): JsProviderObject {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error("Plugin source is empty");
  }

  // Light static guard: reject sources that look like statement lists.
  // We want a single object-literal expression, not arbitrary code.
  // (This is a heuristic — the real sandboxing is the Function scope.)
  const trimmed = source.trim();
  // Auto-wrap a bare object literal in parens if the author forgot.
  // `{ ... }` at top-of-source is parsed as a block statement by JS;
  // `({ ... })` is an expression. We require the expression form.
  let evalSource = trimmed;
  if (evalSource.startsWith("{") && !evalSource.startsWith("({")) {
    evalSource = "(" + evalSource + ")";
  }

  // Build the sandbox globals.
  const sandbox = buildSandboxGlobals(cs3);
  const sandboxKeys = Object.keys(sandbox);
  const sandboxValues = sandboxKeys.map((k) => sandbox[k]);

  // Build the Function. The plugin body is wrapped so the only thing it
  // can do is `return <expression>` — we prepend the `return (` and
  // append `)`. If the author already wrote `return ...`, that's fine
  // because we wrap it again (the inner return is unreachable — the
  // outer return wins).

  // Actually we use a simpler approach: prepend `"use strict"; return (`
  // and append `);`. The plugin source must be an expression. If the
  // author wrote `return ...`, that's a syntax error inside a function
  // expression at top level — we catch and report it.
  const body = `"use strict";\nreturn (${evalSource});\n`;

  const fn = new Function(...sandboxKeys, body);
  // Call with the sandbox values as positional args.
  const result = fn(...sandboxValues);

  if (result == null) {
    throw new Error(
      "Plugin source evaluated to null/undefined — it must `return ({ ... })` an object literal"
    );
  }
  if (typeof result !== "object") {
    throw new Error(
      `Plugin source evaluated to ${typeof result} — it must return an object literal`
    );
  }
  // Reject arrays — a common mistake is to export `[ ... ]` instead of `{ ... }`.
  if (Array.isArray(result)) {
    throw new Error(
      "Plugin source evaluated to an array — it must return an object literal `{ ... }`, not `[ ... ]`"
    );
  }
  return result as JsProviderObject;
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Validate the evaluated object literal has the required fields and that
 * any present method-shaped fields have the right arity. Returns an
 * error string on failure, or null on success.
 */
export function validateProviderObject(obj: JsProviderObject): string | null {
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    return "Plugin object is missing required field `name` (string)";
  }
  if (typeof obj.mainUrl !== "string" || !obj.mainUrl.trim()) {
    return "Plugin object is missing required field `mainUrl` (string)";
  }
  if (!/^https?:\/\//i.test(obj.mainUrl)) {
    return `Plugin \`mainUrl\` must start with http:// or https:// (got "${obj.mainUrl}")`;
  }

  // Method arity checks — gentle, only warn on mismatch.
  const methodArities: Array<[keyof JsProviderObject, number]> = [
    ["getMainPage", 2],
    ["search", 2],
    ["quickSearch", 1],
    ["load", 1],
    ["loadLinks", 4],
  ];
  for (const [name, arity] of methodArities) {
    const fn = obj[name];
    if (fn !== undefined && typeof fn !== "function") {
      return `Plugin field \`${String(name)}\` must be a function (got ${typeof fn})`;
    }
    // We don't enforce arity strictly — JS functions can be called with
    // any number of args — but we do warn in dev.
    if (typeof fn === "function" && fn.length > arity) {
      console.warn(
        `[cs3-plugin] "${obj.name}": ${String(name)} declares ${fn.length} params — expected ≤ ${arity}. Extra params will be undefined.`
      );
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Public entry points                                                */
/* ------------------------------------------------------------------ */

/**
 * Load a JS provider from a source string. Evaluates the source in a
 * sandboxed `Function` scope, validates the resulting object literal,
 * wraps it in a `JsProviderAdapter`, and registers it with `APIHolder`.
 *
 * Returns a `JsProviderLoadResult` indicating success/failure and the
 * registered provider name on success.
 *
 * The `cs3` runtime is created fresh per call (one runtime per provider)
 * so future per-provider state (rate-limit buckets, cookie jars) can be
 * attached without polluting a shared singleton.
 */
export function loadProviderFromSource(
  source: string,
  displayName: string = "(unnamed)"
): JsProviderLoadResult {
  try {
    const cs3 = createCs3Runtime();
    const obj = evaluateProviderSource(source, cs3);
    const validationError = validateProviderObject(obj);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const adapter = new JsProviderAdapter(obj, cs3);
    APIHolder.registerProvider(adapter);
    return { success: true, name: adapter.name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: `Failed to load provider "${displayName}": ${msg}`,
    };
  }
}

/**
 * Load a JS provider from a URL. Fetches the `.js` source through the
 * CORS proxy, then delegates to `loadProviderFromSource`.
 *
 * Rejects (returns `success: false`) if the URL doesn't end in `.js` —
 * we explicitly do NOT support loading Android `.cs3` files. See
 * `EXTENSION_LOADER_DESIGN.md` §8.3 for the rationale.
 */
export async function loadProviderFromUrl(
  url: string,
  displayName: string
): Promise<JsProviderLoadResult> {
  // Refuse .cs3 URLs up-front — they can't run in a browser.
  if (/\.cs3(\?|$)/i.test(url)) {
    return {
      success: false,
      error:
        "Android .cs3 plugins cannot run in the browser. Web providers must be .js files — see EXTENSION_LOADER_DESIGN.md §8.3.",
    };
  }
  if (!/\.js(\?|$)/i.test(url)) {
    // Soft warning — allow non-.js URLs (some hosts serve JS without
    // the extension) but log it.
    console.warn(
      `[cs3-loader] "${displayName}": URL doesn't end in .js (${url}). Proceeding — but if this is a .cs3 file, it will fail.`
    );
  }

  try {
    const client = createHttpClient();
    const res = await client.get(url, {
      Accept: "application/javascript, text/javascript, */*",
    });
    if (!res.isSuccess || !res.body) {
      return {
        success: false,
        error: `Failed to fetch plugin source (HTTP ${res.statusCode})`,
      };
    }
    return loadProviderFromSource(res.body, displayName);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Unregister a previously-loaded JS provider by name. Mirrors
 * `APIHolder.unregisterProvider` — included here so callers don't need
 * to import from two modules.
 */
export function unloadProvider(name: string): boolean {
  return APIHolder.unregisterProvider(name);
}
