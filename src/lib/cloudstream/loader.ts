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
    const fn = new Function(
      ...Object.keys(sandbox),
      `"use strict";\n${source}\n// --- end of plugin source ---\nreturn module.exports;`
    );
    const exports = fn(...Object.values(sandbox));

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

    return {
      success: false,
      error: `Plugin "${displayName}" did not register a provider. Call registerProvider(new YourClass()) inside the plugin source.`,
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
