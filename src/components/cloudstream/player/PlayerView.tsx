'use client';

/**
 * PlayerView — the main CloudStream web video player.
 *
 * Reads `currentPlayingEpisode`, `currentPlayingLinks`,
 * `currentPlayingMetadata` from `useAppStore` and renders a full-viewport
 * (16:9, black bg) player with a custom controls overlay.
 *
 * Source handling (per brief):
 *   - m3u8  → HLS.js (or Safari-native if Hls.isSupported() is false)
 *   - mp4/webm → native HTML5 video
 *   - DASH (.mpd) → "DASH not supported in browser" message
 *   - Torrent / magnet → "Torrent streaming not supported in web version"
 *
 * Lifecycle (mirrors Android CS3IPlayer + FullScreenPlayer, worklog D3):
 *   - Manifest parsed → start playback (respecting autoPlay setting)
 *   - 80% playback → trigger sync update (logged for now, real SyncManager
 *     doesn't exist yet — worklog F1 step 11)
 *   - On end → recordWatch() + show "Next episode" prompt
 *
 * Gestures (per brief):
 *   - click → toggle play
 *   - double-click → seek ±10s (left half = back, right half = forward)
 *   - arrow keys / space → seek / play-pause (handled in PlayerContainer)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Film,
  Magnet,
  PlayCircle,
  RefreshCw,
  Layers,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import {
  Episode,
  ExtractorLink,
  ExtractorLinkType,
  SearchResponse,
  SubtitleFile,
} from "@/lib/cloudstream/types";
import { useHlsPlayer } from "./useHlsPlayer";
import { PlayerControls } from "./PlayerControls";
import { SourcePicker, detectSourceKind } from "./SourcePicker";
import { SubtitlePicker } from "./SubtitlePicker";

// ---- Subtitle stub ----------------------------------------------------

/**
 * For now we synthesize an empty subtitle list. The real CloudStream
 * `SubtitleFile[]` would arrive alongside the ExtractorLink[] from
 * `RepoLinkGenerator.generateLinks` (worklog F1 step 11). When the
 * result page wires loadLinks it will pass the subs through.
 */
const EMPTY_SUBTITLES: SubtitleFile[] = [];

// ---- Helpers ----------------------------------------------------------

function buildEpisodeTitle(
  episode: Episode | null,
  metadata: SearchResponse | null
): { title: string; subtitle?: string } {
  if (!episode && !metadata) return { title: "" };
  const meta = metadata?.name ?? "";
  if (!episode) return { title: meta };
  const epName =
    episode.name && episode.name.trim().length > 0
      ? episode.name
      : `Episode ${episode.episode}`;
  if (episode.season > 0) {
    return {
      title: epName,
      subtitle: `${meta} · S${episode.season} E${episode.episode}`,
    };
  }
  return {
    title: epName,
    subtitle: meta,
  };
}

// ---- Component --------------------------------------------------------

export function PlayerView() {
  const episode = useAppStore((s) => s.currentPlayingEpisode);
  const links = useAppStore((s) => s.currentPlayingLinks);
  const metadata = useAppStore((s) => s.currentPlayingMetadata);
  const closePlayer = useAppStore((s) => s.closePlayer);
  const recordWatch = useAppStore((s) => s.recordWatch);
  const settings = useAppStore((s) => s.settings);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { loadSource, destroy } = useHlsPlayer(videoRef);

  // ---- State ----------------------------------------------------------
  const [selectedLink, setSelectedLink] = useState<ExtractorLink | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<SubtitleFile | null>(
    null
  );

  // Video playback state (mirrors <video> events)
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showNextPrompt, setShowNextPrompt] = useState(false);

  // Controls visibility (auto-hide after 3 s)
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pickers
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [subtitlePickerOpen, setSubtitlePickerOpen] = useState(false);

  // 80% sync fired flag — reset whenever the source changes
  const syncFiredRef = useRef(false);

  // Stable refs that the global-keyboard effect can read. They are updated
  // on every render so the listener (bound once) always sees fresh handlers.
  const handleTogglePlayRef = useRef<(() => void) | null>(null);
  const handleSeekByRef = useRef<((delta: number) => void) | null>(null);
  const handleVolumeChangeRef = useRef<((v: number) => void) | null>(null);
  const handleToggleFullscreenRef = useRef<(() => void) | null>(null);
  const handleToggleMuteRef = useRef<(() => void) | null>(null);

  // ---- Source selection ----------------------------------------------
  // Pick a sensible default source: first non-torrent, prefer m3u8/mp4.
  const defaultLink = useMemo(() => {
    if (!links || links.length === 0) return null;
    const playable = links.filter((l) => {
      const kind = detectSourceKind(l);
      return kind === "M3U8" || kind === "MP4";
    });
    if (playable.length > 0) {
      // Prefer m3u8 (adaptive) over mp4
      const m3u8 = playable.find((l) => detectSourceKind(l) === "M3U8");
      return m3u8 ?? playable[0];
    }
    // Fallback to first link (will surface the appropriate "unsupported"
    // message via the kind check below).
    return links[0];
  }, [links]);

  useEffect(() => {
    setSelectedLink(defaultLink);
    setErrorMessage(null);
    syncFiredRef.current = false;
    setShowNextPrompt(false);
    setActiveSubtitle(null);
  }, [defaultLink]);

  // ---- Subtitle track management -------------------------------------
  // We attach a `<track>` element whenever activeSubtitle changes and disable
  // all others. (See SubtitlePicker for the format caveats — we recommend VTT
  // for web playback.)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Remove any previously-injected track elements (we own them).
    video
      .querySelectorAll("track[data-cs-managed]")
      .forEach((t) => t.remove());

    if (!activeSubtitle) return;

    const track = document.createElement("track");
    track.setAttribute("data-cs-managed", "true");
    track.kind = "subtitles";
    track.label = activeSubtitle.name;
    track.src = activeSubtitle.url;
    if (activeSubtitle.language) {
      track.srclang = activeSubtitle.language;
    }
    track.default = true;
    video.appendChild(track);

    // Activating the newly-added track: TextTracks become available after
    // append; we set mode='showing' on the next frame.
    requestAnimationFrame(() => {
      const tt = video.textTracks;
      for (let i = 0; i < tt.length; i++) {
        tt[i].mode = tt[i] === tt[tt.length - 1] ? "showing" : "disabled";
      }
    });
  }, [activeSubtitle]);

  // ---- Load source into player ---------------------------------------
  useEffect(() => {
    if (!selectedLink) return;
    const video = videoRef.current;
    if (!video) return;

    const kind = detectSourceKind(selectedLink);
    if (kind === "DASH") {
      setErrorMessage(
        "DASH (.mpd) streams are not supported in this browser. Pick another source."
      );
      return;
    }
    if (kind === "Torrent") {
      setErrorMessage(
        "Torrent streaming is not supported in the web version. Pick another source."
      );
      return;
    }

    setErrorMessage(null);
    setIsBuffering(true);

    const isM3u8 = kind === "M3U8";
    loadSource(selectedLink.url, {
      isM3u8,
      headers: selectedLink.headers,
      onManifestParsed: () => {
        setIsBuffering(false);
        if (settings.playerAutoPlay) {
          video.play().catch(() => {
            /* autoplay can be blocked; user can press play */
          });
        }
      },
      onError: (msg) => {
        setErrorMessage(msg || "Playback error. Try another source.");
        setIsBuffering(false);
      },
    });

    return () => {
      // Clean up when switching sources or unmounting.
      destroy();
    };
  }, [selectedLink, loadSource, destroy, settings.playerAutoPlay]);

  // ---- Video element event listeners ---------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      // Update buffered end
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
      // 80% sync threshold (worklog F1 — AbstractPlayerFragment line 31)
      if (
        duration > 0 &&
        !syncFiredRef.current &&
        video.currentTime / duration >= 0.8
      ) {
        syncFiredRef.current = true;
        // SyncManager doesn't exist yet in this port — log for now per brief.
        console.info(
          "[PlayerView] 80% playback reached — would call SyncManager.modifyMaxEpisode",
          {
            apiName: metadata?.apiName,
            url: metadata?.url,
            episode: episode?.episode,
            season: episode?.season,
          }
        );
      }
    };
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      setVolume(video.volume);
      setMuted(video.muted);
      setPlaybackRate(video.playbackRate);
    };
    const onDurationChange = () => setDuration(video.duration);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onRateChange = () => setPlaybackRate(video.playbackRate);
    const onEnded = () => {
      // Record final watch progress
      if (metadata && episode) {
        recordWatch({
          searchResponse: metadata,
          episode,
          position: video.currentTime,
          duration: video.duration,
        });
      }
      setShowNextPrompt(true);
    };
    const onEnterPip = () => setIsPip(true);
    const onLeavePip = () => setIsPip(false);
    const onErrorEvt = () => {
      const err = video.error;
      if (err) {
        setErrorMessage(
          `Video error (code ${err.code}). Try another source.`
        );
        setIsBuffering(false);
      }
    };
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);
    video.addEventListener("error", onErrorEvt);
    video.addEventListener("progress", onProgress);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
      video.removeEventListener("error", onErrorEvt);
      video.removeEventListener("progress", onProgress);
    };
  }, [duration, episode, metadata, recordWatch]);

  // ---- Fullscreen tracking -------------------------------------------
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ---- Global keyboard shortcuts (dispatched by PlayerContainer) ------
  // PlayerContainer owns the keydown listener so it can intercept keys even
  // when focus is outside the player; it forwards them as CustomEvents.
  useEffect(() => {
    const onTogglePlay = () => handleTogglePlayRef.current?.();
    const onSeek = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      handleSeekByRef.current?.(detail);
    };
    const onVolumeDelta = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      const video = videoRef.current;
      if (!video) return;
      const next = Math.max(0, Math.min(1, video.volume + detail));
      handleVolumeChangeRef.current?.(next);
    };
    const onToggleFullscreen = () => handleToggleFullscreenRef.current?.();
    const onToggleMute = () => handleToggleMuteRef.current?.();

    window.addEventListener("cs-player:toggle-play", onTogglePlay);
    window.addEventListener("cs-player:seek", onSeek);
    window.addEventListener("cs-player:volume-delta", onVolumeDelta);
    window.addEventListener("cs-player:toggle-fullscreen", onToggleFullscreen);
    window.addEventListener("cs-player:toggle-mute", onToggleMute);

    return () => {
      window.removeEventListener("cs-player:toggle-play", onTogglePlay);
      window.removeEventListener("cs-player:seek", onSeek);
      window.removeEventListener("cs-player:volume-delta", onVolumeDelta);
      window.removeEventListener(
        "cs-player:toggle-fullscreen",
        onToggleFullscreen
      );
      window.removeEventListener("cs-player:toggle-mute", onToggleMute);
    };
  }, []);

  // ---- Auto-hide controls --------------------------------------------
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      // Don't auto-hide while a picker is open or while paused.
      if (sourcePickerOpen || subtitlePickerOpen) return;
      setControlsVisible(false);
    }, 3000);
  }, [sourcePickerOpen, subtitlePickerOpen]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    showControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showControls, selectedLink]);

  // ---- Action handlers -----------------------------------------------
  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {
        /* ignore */
      });
    } else {
      video.pause();
    }
    showControls();
  }, [showControls]);

  const handleSeekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
      video.currentTime = next;
      setCurrentTime(next);
      showControls();
    },
    [showControls]
  );

  const handleSeekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = seconds;
      setCurrentTime(seconds);
      showControls();
    },
    [showControls]
  );

  const handleVolumeChange = useCallback(
    (v: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.volume = v;
      video.muted = v === 0;
      setVolume(v);
      setMuted(v === 0);
    },
    []
  );

  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    showControls();
  }, [showControls]);

  const handleSetPlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {
        /* ignore */
      });
    } else {
      el.requestFullscreen().catch(() => {
        /* ignore */
      });
    }
    showControls();
  }, [showControls]);

  const handleTogglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else if (
        "requestPictureInPicture" in video &&
        document.pictureInPictureEnabled
      ) {
        await video.requestPictureInPicture();
      }
    } catch {
      /* ignore — PiP can be blocked by browser policy */
    }
    showControls();
  }, [showControls]);

  const handleBack = useCallback(() => {
    // Record current position before closing so the user can resume.
    const video = videoRef.current;
    if (video && metadata && episode && Number.isFinite(video.currentTime)) {
      recordWatch({
        searchResponse: metadata,
        episode,
        position: video.currentTime,
        duration: video.duration,
      });
    }
    closePlayer();
  }, [closePlayer, episode, metadata, recordWatch]);

  const handleSelectSource = useCallback((link: ExtractorLink) => {
    setSelectedLink(link);
    setSourcePickerOpen(false);
    syncFiredRef.current = false;
    setShowNextPrompt(false);
  }, []);

  const handleSelectSubtitle = useCallback((sub: SubtitleFile | null) => {
    setActiveSubtitle(sub);
    setSubtitlePickerOpen(false);
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    // Re-trigger the load-source effect by toggling selectedLink to null
    // and back. Easier than tracking an explicit retry token.
    const cur = selectedLink;
    if (!cur) return;
    setSelectedLink(null);
    setTimeout(() => setSelectedLink(cur), 0);
  }, [selectedLink]);

  // ---- Double-click to seek ------------------------------------------
  // We attach to the container; left half = -10s, right half = +10s.
  const lastClickRef = useRef(0);
  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Ignore clicks on the controls overlay children (they have their own
      // handlers and stopPropagation where appropriate).
      const target = e.target as HTMLElement;
      if (target.closest("[data-controls-layer]")) return;

      const now = Date.now();
      const delta = now - lastClickRef.current;
      lastClickRef.current = now;

      if (delta < 300) {
        // Double-click → seek
        const rect = e.currentTarget.getBoundingClientRect();
        const isRightHalf = e.clientX - rect.left > rect.width / 2;
        handleSeekBy(isRightHalf ? 10 : -10);
        lastClickRef.current = 0; // reset so triple-click doesn't compound
      } else {
        // Single click → toggle play (after a short delay so a double-click
        // can preempt; we use a micro-timeout).
        setTimeout(() => {
          if (Date.now() - lastClickRef.current >= 280) {
            handleTogglePlay();
          }
        }, 280);
      }
      showControls();
    },
    [handleSeekBy, handleTogglePlay, showControls]
  );

  // ---- Mouse move shows controls -------------------------------------
  const handleMouseMove = useCallback(() => {
    showControls();
  }, [showControls]);

  // Keep the keyboard-shortcut refs in sync with the latest handler closures
  // so the global-keyboard effect (bound once) always calls fresh handlers.
  useEffect(() => {
    handleTogglePlayRef.current = handleTogglePlay;
    handleSeekByRef.current = handleSeekBy;
    handleVolumeChangeRef.current = handleVolumeChange;
    handleToggleFullscreenRef.current = handleToggleFullscreen;
    handleToggleMuteRef.current = handleToggleMute;
  }, [
    handleTogglePlay,
    handleSeekBy,
    handleVolumeChange,
    handleToggleFullscreen,
    handleToggleMute,
  ]);

  // ---- Derived display values ----------------------------------------
  const titles = useMemo(
    () => buildEpisodeTitle(episode, metadata),
    [episode, metadata]
  );

  const sourceLabel = useMemo(() => {
    if (!selectedLink) return "No source";
    return selectedLink.quality
      ? `${selectedLink.source ?? selectedLink.name} · ${selectedLink.quality}`
      : (selectedLink.source ?? selectedLink.name);
  }, [selectedLink]);

  const sourceKind = selectedLink ? detectSourceKind(selectedLink) : null;
  const showUnsupportedMessage =
    sourceKind === "DASH" || sourceKind === "Torrent";

  const activeSubtitleLabel = activeSubtitle?.name ?? null;

  // Has next episode? We don't have the full episode list here, so we
  // conservatively enable the "Next episode" affordance only when this
  // episode has an episodeIndex (loaded by the result page later). For now,
  // the prompt simply offers to close the player.
  const hasNextEpisode = false;
  const handleNextEpisode = useCallback(() => {
    // Wire-up to be done by the result page; for now just close.
    closePlayer();
  }, [closePlayer]);

  // ---- Render ---------------------------------------------------------
  if (!episode || !links) {
    // Shouldn't happen — PlayerContainer guards — but be defensive.
    return (
      <div className="flex size-full items-center justify-center bg-black text-white">
        No episode loaded.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative size-full overflow-hidden bg-black",
        "select-none"
      )}
      onMouseMove={handleMouseMove}
      onClick={handleContainerClick}
      role="region"
      aria-label="Video player"
    >
      {/* The video element — fills the container, no native controls. */}
      <video
        ref={videoRef}
        className="absolute inset-0 size-full bg-black object-contain"
        playsInline
        // Native controls are intentionally disabled — we render our own.
        controls={false}
        // Cross-origin so subtitle <track>s work.
        crossOrigin="anonymous"
        preload="metadata"
        // Pause when tab is hidden to save bandwidth.
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Unsupported-source banner (DASH / Torrent). */}
      {showUnsupportedMessage && errorMessage && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-[#3d3d3d] bg-[#1e1e1e]/95 p-6 text-center shadow-2xl">
            {sourceKind === "Torrent" ? (
              <Magnet className="mx-auto size-10 text-rose-400" />
            ) : (
              <Layers className="mx-auto size-10 text-amber-400" />
            )}
            <h3 className="mt-3 text-base font-semibold text-white">
              {sourceKind === "Torrent"
                ? "Torrent streaming not supported in web version"
                : "DASH not supported in browser"}
            </h3>
            <p className="mt-2 text-sm text-[#a0a0a0]">{errorMessage}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setSourcePickerOpen(true)}
                className="rounded-md bg-[#7664ed] px-4 py-2 text-sm font-medium text-white hover:bg-[#8774f0]"
              >
                Switch source
              </button>
              <button
                type="button"
                onClick={handleBack}
                className="rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-4 py-2 text-sm font-medium text-white hover:bg-[#333]"
              >
                Close player
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error state with retry / switch source. */}
      {!showUnsupportedMessage && errorMessage && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-[#3d3d3d] bg-[#1e1e1e]/95 p-6 text-center shadow-2xl">
            <AlertTriangle className="mx-auto size-10 text-amber-400" />
            <h3 className="mt-3 text-base font-semibold text-white">
              Playback error
            </h3>
            <p className="mt-2 text-sm text-[#a0a0a0]">{errorMessage}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-2 rounded-md bg-[#7664ed] px-4 py-2 text-sm font-medium text-white hover:bg-[#8774f0]"
              >
                <RefreshCw className="size-4" />
                Retry
              </button>
              <button
                type="button"
                onClick={() => setSourcePickerOpen(true)}
                className="rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-4 py-2 text-sm font-medium text-white hover:bg-[#333]"
              >
                Switch source
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Next episode" prompt (shown after onEnded). */}
      {showNextPrompt && !errorMessage && (
        <div className="absolute inset-0 z-30 flex items-end justify-center p-6 sm:items-center">
          <div className="w-full max-w-md rounded-lg border border-[#3d3d3d] bg-[#1e1e1e]/95 p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <Film className="size-6 text-[#7664ed]" />
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Episode finished
                </h3>
                <p className="text-xs text-[#a0a0a0]">
                  Recorded to your watch history.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleBack}
                className="rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-4 py-2 text-sm font-medium text-white hover:bg-[#333]"
              >
                Close
              </button>
              {hasNextEpisode && (
                <button
                  type="button"
                  onClick={handleNextEpisode}
                  className="flex items-center gap-2 rounded-md bg-[#7664ed] px-4 py-2 text-sm font-medium text-white hover:bg-[#8774f0]"
                >
                  <PlayCircle className="size-4" />
                  Next episode
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Controls overlay (always rendered; visibility toggled internally). */}
      <div data-controls-layer className="absolute inset-0">
        <PlayerControls
          visible={controlsVisible}
          isBuffering={isBuffering}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          volume={volume}
          muted={muted}
          playbackRate={playbackRate}
          isFullscreen={isFullscreen}
          isPip={isPip}
          sourceCount={links.length}
          sourceLabel={sourceLabel}
          onOpenSources={() => {
            setControlsVisible(true);
            setSourcePickerOpen(true);
          }}
          subtitleCount={EMPTY_SUBTITLES.length}
          activeSubtitleLabel={activeSubtitleLabel}
          onOpenSubtitles={() => {
            setControlsVisible(true);
            setSubtitlePickerOpen(true);
          }}
          onBack={handleBack}
          onTogglePlay={handleTogglePlay}
          onSeekBy={handleSeekBy}
          onSeekTo={handleSeekTo}
          onVolumeChange={handleVolumeChange}
          onToggleMute={handleToggleMute}
          onSetPlaybackRate={handleSetPlaybackRate}
          onToggleFullscreen={handleToggleFullscreen}
          onTogglePip={handleTogglePip}
          onNextEpisode={handleNextEpisode}
          hasNextEpisode={hasNextEpisode}
          title={titles.title}
          subtitle={titles.subtitle}
        />
      </div>

      {/* Pickers */}
      <SourcePicker
        open={sourcePickerOpen}
        onOpenChange={setSourcePickerOpen}
        links={links}
        selectedUrl={selectedLink?.url ?? null}
        onSelect={handleSelectSource}
      />
      <SubtitlePicker
        open={subtitlePickerOpen}
        onOpenChange={setSubtitlePickerOpen}
        subtitles={EMPTY_SUBTITLES}
        selectedUrl={activeSubtitle?.url ?? null}
        onSelect={handleSelectSubtitle}
      />
    </div>
  );
}
