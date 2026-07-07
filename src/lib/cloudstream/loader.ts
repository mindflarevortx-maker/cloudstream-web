/**
 * CloudStream Web — Plugin Loader
 *
 * On Android, CloudStream plugins are `.cs3` files (essentially APKs / JARs
 * containing compiled Kotlin provider classes loaded by a `DexClassLoader`).
 * That can't run in a browser. For the web port we use a JS-based plugin
 * format: each plugin is a plain `.js` file that, when evaluated, defines a
 * class extending `MainAPI` and registers an instance of it with the
 * `APIHolder` global registry.
 *
 * The loader exposes a tiny sandbox to plugin source: it injects the base
 * `MainAPI` class, the `TvType` enum, a `registerProvider` helper, and a
 * `module.exports`-style shim so plugins written in either style work:
 *
 *   // Style A — side-effect registration
 *   class MyProvider extends MainAPI { ... }
 *   registerProvider(new MyProvider());
 *
 *   // Style B — CommonJS export
 *   class MyProvider extends MainAPI { ... }
 *   module.exports = { default: MyProvider };
 *
 *   // Style C — global default
 *   class MyProvider extends MainAPI { ... }
 *   globalThis.__pluginDefault = MyProvider;
 *
 * All three are detected and result in one `APIHolder.registerProvider` call.
 *
 * NOTE: This runs in the browser. Plugin source is fetched through the
 * server-side `/api/proxy` (see `http.ts`) to bypass CORS, then evaluated
 * via `new Function` — the eslint `no-new-func` rule is intentionally
 * disabled for this file because we *do* need dynamic code evaluation to
 * load third-party plugins (the whole point of a plugin system).
 */

import { MainAPI, APIHolder } from "./MainAPI";
import { TvType, DubStatus, ShowStatus, ExtractorLinkType } from "./types";
import * as Types from "./types";
import { createHttpClient } from "./http";
import { createCs3Runtime } from "./loader/runtime";

export interface LoadResult {
  success: boolean;
  /** Provider name registered (if any) — for logging / UI feedback. */
  name?: string;
  error?: string;
}

/** Fetch + evaluate a plugin's .js source from a URL. */
export async function loadPluginFromUrl(
  url: string,
  displayName: string
): Promise<LoadResult> {
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
    return loadPluginFromSource(res.body, displayName);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Evaluate a plugin's source code in a sandboxed function scope.
 * The plugin receives framework globals (MainAPI, TvType, registerProvider,
 * etc.) as function parameters so it can extend MainAPI and register itself.
 */
export function loadPluginFromSource(
  source: string,
  displayName: string
): LoadResult {
  try {
    // Module-shim — lets CommonJS-style plugins work.
    const moduleShim = { exports: {} as Record<string, unknown> };

    // Track whether the plugin self-registered via registerProvider().
    let registeredName: string | null = null;
    const registerProvider = (provider: MainAPI): void => {
      if (!provider || typeof provider !== "object") {
        console.warn("[loader] registerProvider called with non-object");
        return;
      }
      // Inject the shared HTTP client so the provider can make requests.
      try {
        provider.setClient(createHttpClient());
      } catch {
        /* ignore — setClient may be missing on test stubs */
      }
      APIHolder.registerProvider(provider);
      registeredName = provider.name;
    };

    // Sandbox globals handed to the plugin via Function parameters.
    const client = createHttpClient();
    const cs3Runtime = createCs3Runtime(client);
    const sandbox = {
      MainAPI,
      APIHolder,
      TvType,
      DubStatus,
      ShowStatus,
      ExtractorLinkType,
      Types,
      registerProvider,
      module: moduleShim,
      exports: moduleShim.exports,
      console,
      // The `cs3` runtime API — the only surface JS providers should use.
      // Provides: fetch, parseHtml, newExtractorLink, loadExtractor, fixUrl,
      // unpackJs, TvType, scoreFromFloat. See EXTENSION_LOADER_DESIGN.md.
      cs3: cs3Runtime,
      // Pull in a few browser globals explicitly so the plugin can use them
      // without ESLint flagging `no-undef` (TS-side we use `as any`).
      fetch: globalThis.fetch?.bind(globalThis),
      URL: globalThis.URL,
      JSON: globalThis.JSON,
      Math: globalThis.Math,
      Date: globalThis.Date,
      Error: globalThis.Error,
      Promise: globalThis.Promise,
      Array: globalThis.Array,
      Object: globalThis.Object,
      String: globalThis.String,
      Number: globalThis.Number,
      Boolean: globalThis.Boolean,
      RegExp: globalThis.RegExp,
    };

    // Build a Function whose parameters mirror the sandbox keys. This is the
    // standard "eval in a sandbox" trick — the plugin source runs in a fresh
    // function scope with only the keys we inject.
    //
    // Three plugin shapes are supported:
    //   1. Object-literal (possibly with leading comments): `/** doc */\n({ name, ... })`
    //      — we detect a top-level `({...})` expression and wrap it in `return (...);`.
    //   2. Statements: `class X extends MainAPI {} registerProvider(new X());`
    //      — run as-is, fall back to `return module.exports;`.
    //   3. CommonJS: `module.exports = { ... }` — run as-is, return module.exports.
    //
    // We try shape 1 first (most common for community JS providers); if it
    // throws a SyntaxError, we fall back to shape 2/3.
    const trimmedSource = source.trim();
    // Strip leading block/line comments to detect a leading `({...})` expression
    const stripped = trimmedSource
      .replace(/^\/\*[\s\S]*?\*\//, "")
      .replace(/^\/\/.*$/gm, "")
      .trim();
    const isObjectLiteral =
      stripped.startsWith("(") && stripped.endsWith(")");

    let exports: unknown;
    try {
      if (isObjectLiteral) {
        const fn = new Function(
          ...Object.keys(sandbox),
          `"use strict";\nreturn ${stripped};\n`
        );
        exports = fn(...Object.values(sandbox));
      } else {
        throw new Error("not object-literal shape");
      }
    } catch {
      // Fall back to running as statements (class decls, registerProvider, module.exports)
      const fn = new Function(
        ...Object.keys(sandbox),
        `"use strict";\n${source}\n// --- end of plugin source ---\nreturn module.exports;\n`
      );
      exports = fn(...Object.values(sandbox));
    }

    // Style A — plugin already called registerProvider().
    if (registeredName) {
      return { success: true, name: registeredName };
    }

    // Style B — CommonJS export with a `default` class.
    const exp = (exports || moduleShim.exports) as Record<string, unknown>;
    const defaultExport = exp.default ?? exp;
    if (
      typeof defaultExport === "function" &&
      defaultExport.prototype instanceof MainAPI
    ) {
      const instance = new (defaultExport as new () => MainAPI)() as MainAPI;
      registerProvider(instance);
      return { success: true, name: instance.name };
    }

    // Style C — plugin attached a class to globalThis.__pluginDefault.
    const g = globalThis as unknown as { __pluginDefault?: unknown };
    if (typeof g.__pluginDefault === "function") {
      const instance = new (g.__pluginDefault as new () => MainAPI)() as MainAPI;
      registerProvider(instance);
      try {
        delete g.__pluginDefault;
      } catch {
        /* ignore */
      }
      return { success: true, name: instance.name };
    }

    // Style D — plugin returned a plain object literal (the "cs3 runtime" format
    // documented in EXTENSION_LOADER_DESIGN.md): `({ name, mainUrl, getMainPage, ... })`.
    // This is what community-converted JS providers use. We wrap it in a minimal
    // MainAPI adapter so the rest of the app can treat it like a normal provider.
    const returnedValue = exports;
    if (returnedValue && typeof returnedValue === "object" && returnedValue !== moduleShim.exports) {
      const obj = returnedValue as Record<string, unknown>;
      if (typeof obj.name === "string" && typeof obj.mainUrl === "string") {
        const instance = wrapObjectLiteralAsMainAPI(obj);
        registerProvider(instance);
        return { success: true, name: instance.name };
      }
    }
    // Also check moduleShim.exports (Style B variant — object literal assigned to module.exports)
    const shimExp = moduleShim.exports as Record<string, unknown>;
    if (shimExp && typeof shimExp === "object" && typeof shimExp.name === "string" && typeof shimExp.mainUrl === "string") {
      const instance = wrapObjectLiteralAsMainAPI(shimExp);
      registerProvider(instance);
      return { success: true, name: instance.name };
    }

    return {
      success: false,
      error: `Plugin "${displayName}" did not register a provider. Call registerProvider(new YourClass()) inside the plugin source, or return a ({name, mainUrl, ...}) object literal, or set module.exports = {name, mainUrl, ...}.`,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Unregister a provider by name (mirrors Android's `APIHolder.unregister`). */
export function unloadPlugin(name: string): void {
  APIHolder.unregisterProvider(name);
}

/**
 * Wrap a plain object-literal provider (Style D) in a class that extends MainAPI.
 *
 * The object-literal format is what community-converted JS providers use:
 *   ({ name, mainUrl, lang, supportedTypes, hasMainPage, getMainPage, search, load, loadLinks, ... })
 *
 * This wrapper delegates every MainAPI method + property to the object, and
 * injects the shared HTTP client so `this.client` works inside the provider's
 * methods (matching the `cs3.fetch` pattern where providers use the proxy).
 */
function wrapObjectLiteralAsMainAPI(obj: Record<string, unknown>): MainAPI {
  // Build a concrete subclass of MainAPI that delegates to the object literal.
  // We use Object.assign to copy all properties + methods from the object onto
  // the instance, then call the MainAPI constructor (which sets defaults).
  class ObjectLiteralProvider extends MainAPI {
    name: string = obj.name as string;
    mainUrl: string = obj.mainUrl as string;
    lang: string = (obj.lang as string) || "en";
    supportedTypes: Types.TvType[] = (obj.supportedTypes as Types.TvType[]) || [Types.TvType.Movie];
    supportedSyncNames: string[] = (obj.supportedSyncNames as string[]) || [];
    hasQuickSearch: boolean = (obj.hasQuickSearch as boolean) || false;
    hasMainPage: boolean = (obj.hasMainPage as boolean) || false;
    hasDownloadSupport: boolean = (obj.hasDownloadSupport as boolean) ?? true;
    hasChromecastSupport: boolean = (obj.hasChromecastSupport as boolean) ?? true;
    usesWebView: boolean = false;
    instantLinkLoading: boolean = (obj.instantLinkLoading as boolean) || false;
    sequentialMainPage: boolean = (obj.sequentialMainPage as boolean) || false;
    sequentialMainPageDelay: number = (obj.sequentialMainPageDelay as number) || 0;
    mainPage: Types.MainPageRequest[] = (obj.mainPage as Types.MainPageRequest[]) || [];

    async getMainPage(page: number, request: Types.MainPageRequest | null) {
      if (typeof obj.getMainPage === "function") {
        return (obj.getMainPage as Function).call(this, page, request);
      }
      throw new Error(`${this.name}: getMainPage not implemented`);
    }
    async search(query: string, page: number) {
      if (typeof obj.search === "function") {
        return (obj.search as Function).call(this, query, page);
      }
      throw new Error(`${this.name}: search not implemented`);
    }
    async quickSearch(query: string) {
      if (typeof obj.quickSearch === "function") {
        return (obj.quickSearch as Function).call(this, query);
      }
      throw new Error(`${this.name}: quickSearch not implemented`);
    }
    async load(url: string) {
      if (typeof obj.load === "function") {
        return (obj.load as Function).call(this, url);
      }
      throw new Error(`${this.name}: load not implemented`);
    }
    async loadLinks(data: string, isCasting: boolean, subtitleCallback: Function, callback: Function) {
      if (typeof obj.loadLinks === "function") {
        return (obj.loadLinks as Function).call(this, data, isCasting, subtitleCallback, callback);
      }
      throw new Error(`${this.name}: loadLinks not implemented`);
    }
  }

  const instance = new ObjectLiteralProvider();
  return instance;
}
