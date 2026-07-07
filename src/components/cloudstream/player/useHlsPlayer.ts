'use client';

/**
 * useHlsPlayer — manages the lifecycle of an HLS.js instance attached to a
 * `<video>` element.
 *
 * CloudStream's ExtractorLink contract (`src/lib/cloudstream/types.ts`) carries
 * an `isM3u8` flag plus optional `headers` and `referer`. Browsers can't set
 * arbitrary headers on a native `<video src=...>`, so for m3u8 streams we
 * hand the URL to HLS.js — which can inject per-request headers via the
 * `xhrSetup` callback. For mp4/webm we fall back to the native `src`
 * assignment (Safari also plays m3u8 natively, so we probe `Hls.isSupported()`
 * before engaging the polyfill).
 *
 * The hook is intentionally side-effect-light: it returns `{ loadSource,
 * destroy }` and leaves playback control (play/pause/seek) to the caller.
 * This mirrors the separation in `CS3IPlayer.kt` where `loadOnlinePlayer`
 * builds the `MediaSource` and `PlayerView` drives the rest.
 *
 * Reference: worklog Task D3 (`ui/player/CS3IPlayer.kt` — loadExo at
 * 1379-1642, MergingMediaSource at 1370) and Task F1 step 11 (CS3IPlayer
 * loadOnlinePlayer 1801-1977).
 */

import { useCallback, useRef } from "react";
import Hls from "hls.js";

export type PlayerSourceType = "m3u8" | "mp4" | "webm" | "dash" | "torrent";

export interface LoadSourceOptions {
  /** Whether the URL is an HLS m3u8 playlist. */
  isM3u8: boolean;
  /** Custom HTTP headers (referer, origin, user-agent, etc.). */
  headers?: Record<string, string>;
  /** Called once HLS.js fires MANIFEST_PARSED (or native canplaythrough). */
  onManifestParsed?: () => void;
  /** Called on fatal HLS.js errors or native error events. */
  onError?: (message: string) => void;
}

export interface HlsPlayerApi {
  /**
   * Load a video URL into the attached `<video>` element.
   * Cleans up any prior HLS.js instance before attaching the new source.
   */
  loadSource: (
    url: string,
    options: LoadSourceOptions
  ) => void;
  /** Destroy the HLS.js instance and detach the media. */
  destroy: () => void;
  /** Whether an HLS.js instance is currently attached. */
  isUsingHls: () => boolean;
}

export function useHlsPlayer(
  videoRef: React.RefObject<HTMLVideoElement | null>
): HlsPlayerApi {
  const hlsRef = useRef<Hls | null>(null);

  const destroy = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* swallow — HLS.js can throw if destroyed twice */
      }
      hlsRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        // Remove any native src we set, but don't reset src to empty string
        // repeatedly — that triggers an extra 'abort'/'error' on some browsers.
        if (video.src) {
          video.removeAttribute("src");
          video.load();
        }
      } catch {
        /* ignore */
      }
    }
  }, [videoRef]);

  const loadSource = useCallback(
    (url: string, options: LoadSourceOptions) => {
      const { isM3u8, headers, onManifestParsed, onError } = options;
      const video = videoRef.current;
      if (!video) return;

      // Always clean up the previous instance/source first so we never end up
      // with two competing HLS.js instances on the same `<video>`.
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
      }

      const handleNativeError = () => {
        const err = video.error;
        const message =
          err && err.message
            ? err.message
            : `Native video error (code ${err?.code ?? "?"})`;
        onError?.(message);
      };

      if (isM3u8 && Hls.isSupported()) {
        // ---- HLS.js path --------------------------------------------------
        const hls = new Hls({
          // Reasonable defaults for streaming. CloudStream's Android player
          // uses ExoPlayer's adaptive track selection; we emulate with these.
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 60,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          // xhrSetup is the supported hook for custom headers (the brief
          // notes HLS.js doesn't expose a headers option directly).
          xhrSetup: (xhr) => {
            if (headers) {
              for (const [key, value] of Object.entries(headers)) {
                try {
                  xhr.setRequestHeader(key, value);
                } catch {
                  /* some headers (Referer, User-Agent) are forbidden — ignore */
                }
              }
            }
          },
          // Surface fatal errors to the caller so the UI can show "switch
          // source / retry".
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          onManifestParsed?.();
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            const message =
              data.details ?? data.type ?? "HLS.js fatal error";
            // Try to recover from network / media errors before bubbling up.
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                try {
                  hls.startLoad();
                  return;
                } catch {
                  break;
                }
              case Hls.ErrorTypes.MEDIA_ERROR:
                try {
                  hls.recoverMediaError();
                  return;
                } catch {
                  break;
                }
              default:
                break;
            }
            onError?.(String(message));
          }
        });

        hls.loadSource(url);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } else {
        // ---- Native path (mp4/webm, or Safari-native m3u8) ---------------
        // Strip any stale error listener so the previous source's errors
        // don't bleed through.
        video.removeEventListener("error", handleNativeError);
        try {
          video.src = url;
        } catch {
          /* ignore */
        }
        video.addEventListener("error", handleNativeError, { once: true });

        // The native 'loadedmetadata' is the closest analog to
        // MANIFEST_PARSED for direct file playback.
        const onLoaded = () => {
          onManifestParsed?.();
          video.removeEventListener("loadedmetadata", onLoaded);
        };
        video.addEventListener("loadedmetadata", onLoaded);
      }
    },
    [videoRef]
  );

  const isUsingHls = useCallback(() => hlsRef.current !== null, []);

  return { loadSource, destroy, isUsingHls };
}
