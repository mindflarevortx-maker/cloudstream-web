'use client';

/**
 * PlayerControls — the custom controls overlay for the CloudStream web player.
 *
 * Mirrors the Android `PlayerView` + `FullScreenPlayer` overlay (worklog
 * Task D3 — `PlayerView.kt` 842 lines, `FullScreenPlayer.kt` 1368 lines):
 *   - Top bar: back button (left) + title/metadata (center)
 *   - Bottom bar: seek bar (with buffered range + time labels) and a row of
 *     controls: skip-back, play/pause, skip-forward, volume, settings
 *     (quality + subtitles + speed), PiP, fullscreen
 *   - Center big play/pause indicator that fades after toggling
 *   - Auto-hides 3 s after the last mouse move / tap / key press
 *
 * State is owned by the parent `PlayerView` (so it can react to <video>
 * events in one place); this component is pure presentation + emits intent.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
  Loader2,
  Gauge,
  Check,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface PlayerControlsProps {
  /** Whether the overlay is visible (auto-hide driven by parent). */
  visible: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  currentTime: number; // seconds
  duration: number; // seconds
  buffered: number; // seconds (end of buffered range)
  volume: number; // 0..1
  muted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  isPip: boolean;

  // Sources / subtitles
  sourceCount: number;
  sourceLabel: string;
  onOpenSources: () => void;
  subtitleCount: number;
  activeSubtitleLabel: string | null;
  onOpenSubtitles: () => void;

  // Actions
  onBack: () => void;
  onTogglePlay: () => void;
  onSeekBy: (deltaSeconds: number) => void;
  onSeekTo: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onSetPlaybackRate: (rate: number) => void;
  onToggleFullscreen: () => void;
  onTogglePip: () => void;
  onNextEpisode?: () => void;
  hasNextEpisode?: boolean;

  // Display
  title: string;
  subtitle?: string;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlayerControls(props: PlayerControlsProps) {
  const {
    visible,
    isBuffering,
    isPlaying,
    currentTime,
    duration,
    buffered,
    volume,
    muted,
    playbackRate,
    isFullscreen,
    isPip,
    sourceCount,
    sourceLabel,
    onOpenSources,
    subtitleCount,
    activeSubtitleLabel,
    onOpenSubtitles,
    onBack,
    onTogglePlay,
    onSeekBy,
    onSeekTo,
    onVolumeChange,
    onToggleMute,
    onSetPlaybackRate,
    onToggleFullscreen,
    onTogglePip,
    onNextEpisode,
    hasNextEpisode,
    title,
    subtitle,
  } = props;

  const [settingsOpen, setSettingsOpen] = useState(false);

  const seekPct = useMemo(() => {
    if (!duration || duration <= 0) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  const bufferedPct = useMemo(() => {
    if (!duration || duration <= 0) return 0;
    return Math.min(100, (buffered / duration) * 100);
  }, [buffered, duration]);

  return (
    <div
      className={cn(
        "absolute inset-0 z-20 select-none transition-opacity duration-300",
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      role="group"
      aria-label="Player controls"
    >
      {/* Click-catcher: clicking anywhere on the overlay (that isn't a control)
          toggles play. Parent also listens for double-click to seek ±10s. */}
      <div
        className="absolute inset-0"
        onClick={(e) => {
          // Only toggle if the click landed on the catcher itself (not a child
          // control). We check that the target is the same node.
          if (e.target === e.currentTarget) onTogglePlay();
        }}
        aria-hidden
      />

      {/* ---- Top bar ----------------------------------------------------- */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-30 flex items-start gap-3 p-3 sm:p-4",
          "bg-gradient-to-b from-black/80 via-black/40 to-transparent"
        )}
      >
        <ControlButton
          onClick={onBack}
          label="Back"
          className="bg-black/50 hover:bg-black/70"
        >
          <ArrowLeft className="size-5" />
        </ControlButton>

        <div className="min-w-0 flex-1 text-center">
          <h2
            className="truncate text-sm font-semibold text-white sm:text-base"
            title={title}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              className="truncate text-[11px] text-white/70 sm:text-xs"
              title={subtitle}
            >
              {subtitle}
            </p>
          )}
        </div>

        {/* Spacer to balance the back button so the title stays centered. */}
        <div className="size-10 shrink-0" aria-hidden />
      </div>

      {/* ---- Center play/pause + buffering spinner ---------------------- */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        {isBuffering ? (
          <Loader2 className="size-12 animate-spin text-white/90" />
        ) : (
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            className={cn(
              "pointer-events-auto flex size-16 items-center justify-center rounded-full",
              "bg-black/50 text-white backdrop-blur-sm transition",
              "hover:bg-black/70 hover:scale-105 sm:size-20",
              visible ? "opacity-90" : "opacity-0"
            )}
          >
            {isPlaying ? (
              <Pause className="size-7 fill-white sm:size-9" />
            ) : (
              <Play className="size-8 translate-x-0.5 fill-white sm:size-10" />
            )}
          </button>
        )}
      </div>

      {/* ---- Bottom bar (seek + controls) ------------------------------- */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 flex flex-col gap-2 p-3 sm:gap-3 sm:p-4",
          "bg-gradient-to-t from-black/85 via-black/40 to-transparent"
        )}
      >
        {/* Seek bar */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="w-12 shrink-0 text-right font-mono text-[11px] text-white sm:text-xs">
            {formatTime(currentTime)}
          </span>

          <div className="group relative flex-1">
            {/* Buffered track (behind) */}
            <div className="absolute inset-y-0 left-0 right-0 flex items-center">
              <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25">
                <div
                  className="absolute inset-y-0 left-0 bg-white/30"
                  style={{ width: `${bufferedPct}%` }}
                />
              </div>
            </div>
            {/* Foreground seek slider */}
            <Slider
              value={[seekPct]}
              min={0}
              max={100}
              step={0.1}
              onValueChange={(values) => {
                const pct = values[0] ?? 0;
                onSeekTo((pct / 100) * duration);
              }}
              aria-label="Seek"
              className="relative z-10 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-range]]:bg-[#7664ed] [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-[#7664ed] [&_[data-slot=slider-thumb]]:opacity-0 group-hover:opacity-100"
            />
          </div>

          <span className="w-12 shrink-0 font-mono text-[11px] text-white/80 sm:text-xs">
            {formatTime(duration)}
          </span>
        </div>

        {/* Control row */}
        <div className="flex items-center gap-1 sm:gap-2">
          <ControlButton
            onClick={() => onSeekBy(-10)}
            label="Back 10 seconds"
            className="bg-transparent hover:bg-white/15"
          >
            <SkipBack className="size-5" />
          </ControlButton>

          <ControlButton
            onClick={onTogglePlay}
            label={isPlaying ? "Pause" : "Play"}
            className="bg-white/15 hover:bg-white/25"
          >
            {isPlaying ? (
              <Pause className="size-5 fill-white" />
            ) : (
              <Play className="size-5 translate-x-0.5 fill-white" />
            )}
          </ControlButton>

          <ControlButton
            onClick={() => onSeekBy(10)}
            label="Forward 10 seconds"
            className="bg-transparent hover:bg-white/15"
          >
            <SkipForward className="size-5" />
          </ControlButton>

          {/* Volume */}
          <div className="group/vol flex items-center">
            <ControlButton
              onClick={onToggleMute}
              label={muted ? "Unmute" : "Mute"}
              className="bg-transparent hover:bg-white/15"
            >
              {muted || volume === 0 ? (
                <VolumeX className="size-5" />
              ) : (
                <Volume2 className="size-5" />
              )}
            </ControlButton>
            <div className="hidden w-0 overflow-hidden transition-all duration-200 group-hover/vol:w-20 sm:block">
              <Slider
                value={[muted ? 0 : Math.round(volume * 100)]}
                min={0}
                max={100}
                onValueChange={(values) =>
                  onVolumeChange((values[0] ?? 0) / 100)
                }
                aria-label="Volume"
                className="mx-2 w-16 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-range]]:bg-[#7664ed] [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-[#7664ed]"
              />
            </div>
          </div>

          <div className="flex-1" />

          {/* Settings popover (quality + subtitles + speed) */}
          <SettingsPopover
            open={settingsOpen}
            onOpenChange={(o) => {
              setSettingsOpen(o);
              if (!o) return;
            }}
            onCloseAndOpenSources={() => {
              setSettingsOpen(false);
              onOpenSources();
            }}
            onCloseAndOpenSubtitles={() => {
              setSettingsOpen(false);
              onOpenSubtitles();
            }}
            sourceLabel={sourceLabel}
            sourceCount={sourceCount}
            activeSubtitleLabel={activeSubtitleLabel}
            subtitleCount={subtitleCount}
            playbackRate={playbackRate}
            onSetPlaybackRate={(rate) => {
              onSetPlaybackRate(rate);
            }}
          />

          {/* PiP */}
          <ControlButton
            onClick={onTogglePip}
            label="Picture in picture"
            className="bg-transparent hover:bg-white/15"
            active={isPip}
          >
            <PictureInPicture className="size-5" />
          </ControlButton>

          {/* Fullscreen */}
          <ControlButton
            onClick={onToggleFullscreen}
            label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="bg-transparent hover:bg-white/15"
          >
            {isFullscreen ? (
              <Minimize className="size-5" />
            ) : (
              <Maximize className="size-5" />
            )}
          </ControlButton>

          {/* Next episode (only if available) */}
          {hasNextEpisode && onNextEpisode && (
            <ControlButton
              onClick={onNextEpisode}
              label="Next episode"
              className="bg-[#7664ed] hover:bg-[#8774f0]"
            >
              <SkipForward className="size-5" />
            </ControlButton>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- internal helpers ----------------------------------------------------

interface ControlButtonProps {
  onClick: () => void;
  label: string;
  className?: string;
  children: React.ReactNode;
  active?: boolean;
}

function ControlButton({
  onClick,
  label,
  className,
  children,
  active,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full text-white",
        "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
        className
      )}
    >
      {children}
    </button>
  );
}

interface SettingsPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAndOpenSources: () => void;
  onCloseAndOpenSubtitles: () => void;
  sourceLabel: string;
  sourceCount: number;
  activeSubtitleLabel: string | null;
  subtitleCount: number;
  playbackRate: number;
  onSetPlaybackRate: (rate: number) => void;
}

function SettingsPopover({
  open,
  onOpenChange,
  onCloseAndOpenSources,
  onCloseAndOpenSubtitles,
  sourceLabel,
  sourceCount,
  activeSubtitleLabel,
  subtitleCount,
  playbackRate,
  onSetPlaybackRate,
}: SettingsPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          aria-haspopup="dialog"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-white",
            "bg-transparent transition-colors hover:bg-white/15",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
          )}
        >
          <Settings className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className={cn(
          "w-64 border-[#3d3d3d] bg-[#1e1e1e] p-0 text-white",
          "shadow-2xl shadow-black/50"
        )}
      >
        <ul className="divide-y divide-[#2d2d2d]">
          {/* Quality */}
          <li>
            <button
              type="button"
              onClick={onCloseAndOpenSources}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#2d2d2d]"
            >
              <Subtitles className="size-4 text-[#7664ed]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">Quality &amp; source</div>
                <div className="truncate text-[11px] text-[#a0a0a0]">
                  {sourceLabel} · {sourceCount} source
                  {sourceCount === 1 ? "" : "s"}
                </div>
              </div>
            </button>
          </li>

          {/* Subtitles */}
          <li>
            <button
              type="button"
              onClick={onCloseAndOpenSubtitles}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#2d2d2d]"
            >
              <Subtitles className="size-4 text-[#7664ed]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">Subtitles</div>
                <div className="truncate text-[11px] text-[#a0a0a0]">
                  {activeSubtitleLabel
                    ? activeSubtitleLabel
                    : `Off · ${subtitleCount} available`}
                </div>
              </div>
            </button>
          </li>

          {/* Speed */}
          <li>
            <div className="px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Gauge className="size-4 text-[#7664ed]" />
                Playback speed
                <span className="ml-auto font-mono text-[11px] text-[#a0a0a0]">
                  {playbackRate}×
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {PLAYBACK_RATES.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onSetPlaybackRate(rate)}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                      rate === playbackRate
                        ? "border-[#7664ed] bg-[#7664ed]/15 text-[#BEC8FF]"
                        : "border-[#3d3d3d] bg-[#2d2d2d] text-white hover:border-[#7664ed]/40"
                    )}
                  >
                    {rate === playbackRate && (
                      <Check className="size-3 text-[#7664ed]" />
                    )}
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
