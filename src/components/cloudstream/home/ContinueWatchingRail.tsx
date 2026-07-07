'use client';

import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore, WatchHistoryEntry } from "@/lib/cloudstream/store/app-store";
import { loadEpisodeLinks } from "@/lib/cloudstore/load-links";
import { PosterCard } from "../common/PosterCard";

/**
 * ContinueWatchingRail — a horizontal rail of partially-watched titles.
 *
 * Mirrors the Android `HomeFragment` "Continue Watching" rail
 * (`home_recycler_item_wide.xml`):
 *   - 16:9 landscape thumbnails (the wide PosterCard variant).
 *   - A red/accent progress bar at the bottom of each thumbnail showing
 *     `position / duration`.
 *   - Title + episode info below the thumbnail (e.g. show name on top,
 *     "S1 · E5" below).
 *   - Click → loads playable ExtractorLinks for the saved episode and
 *     hands them to `useAppStore.openPlayer(...)`. If the link load fails
 *     (e.g. the provider is offline or the saved `data` payload is stale)
 *     it falls back to opening the result view so the user can retry.
 *
 * Renders nothing when `watchHistory` is empty — the parent (HomeView) also
 * guards this, but the rail self-defends against an empty list too.
 */

const CARD_WIDTH = "clamp(240px, 26vw, 320px)";

export interface ContinueWatchingRailProps {
  className?: string;
}

export function ContinueWatchingRail({ className }: ContinueWatchingRailProps) {
  const watchHistory = useAppStore((s) => s.watchHistory);
  const openResult = useAppStore((s) => s.openResult);
  const openPlayer = useAppStore((s) => s.openPlayer);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  const scrollByDir = useCallback((dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.7 * (dir === "right" ? 1 : -1);
    el.scrollBy({ left: amount, behavior: "smooth" });
  }, []);

  /** Format a watch position as M:SS / H:MM:SS for the subtitle line. */
  const formatPos = (s: number): string => {
    if (!Number.isFinite(s) || s <= 0) return "0:00";
    const total = Math.floor(s);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  /** Build the "S1 · E5 · <name>" subtitle for a watch-history entry. */
  const buildSubtitle = (e: WatchHistoryEntry): string => {
    const parts: string[] = [];
    if (e.episode.season && e.episode.season > 0) {
      parts.push(`S${e.episode.season}`);
    }
    if (e.episode.episode && e.episode.episode > 0) {
      parts.push(`E${e.episode.episode}`);
    }
    if (e.episode.name) {
      parts.push(e.episode.name);
    }
    if (parts.length === 0) {
      // Fallback — show position so the row isn't blank.
      return `${formatPos(e.position)} watched`;
    }
    return parts.join(" · ");
  };

  /** Click handler — try to load links and open the player at the saved position. */
  const handleResume = useCallback(
    async (entry: WatchHistoryEntry) => {
      const { searchResponse, episode } = entry;
      // No data payload → can't load links; fall back to the result page.
      if (!episode.data) {
        openResult(searchResponse.url, searchResponse.apiName);
        return;
      }
      setLoadingUrl(searchResponse.url);
      try {
        const { links } = await loadEpisodeLinks(
          searchResponse.apiName,
          episode.data,
          false
        );
        if (links.length === 0) {
          // No sources — send the user to the result view so they can pick
          // a different episode / provider.
          openResult(searchResponse.url, searchResponse.apiName);
          return;
        }
        // TODO(resume): once PlayerView supports resume-from-position, pass
        // `entry.position` through openPlayer (or have PlayerView read it
        // from watchHistory on mount). For now playback starts at 0 and the
        // progress bar still reflects the saved position so the user knows
        // where they were.
        openPlayer(episode, links, searchResponse);
      } catch {
        openResult(searchResponse.url, searchResponse.apiName);
      } finally {
        setLoadingUrl(null);
      }
    },
    [openPlayer, openResult]
  );

  if (!watchHistory || watchHistory.length === 0) return null;

  return (
    <section
      className={cn("group/rail relative py-2", className)}
      aria-label="Continue Watching"
    >
      {/* Title row */}
      <div className="flex items-baseline justify-between gap-2 px-4 pb-2">
        <h2 className="text-base font-semibold text-white sm:text-lg">
          Continue Watching
        </h2>
        <span className="shrink-0 text-xs font-medium text-[#a0a0a0]">
          {watchHistory.length}{" "}
          {watchHistory.length === 1 ? "title" : "titles"}
        </span>
      </div>

      <div className="relative">
        {/* Left arrow */}
        <RailArrow
          dir="left"
          onClick={() => scrollByDir("left")}
          ariaLabel="Scroll Continue Watching left"
        />
        {/* Right arrow */}
        <RailArrow
          dir="right"
          onClick={() => scrollByDir("right")}
          ariaLabel="Scroll Continue Watching right"
        />

        {/* Horizontal scroller */}
        <div
          ref={scrollRef}
          className={cn(
            "flex gap-3 overflow-x-auto scroll-smooth px-4 pb-2",
            "snap-x snap-mandatory no-scrollbar",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/40 focus-visible:ring-inset"
          )}
          style={{ scrollbarWidth: "none" }}
        >
          {watchHistory.map((entry, idx) => {
            const pct =
              entry.duration > 0
                ? Math.max(0, Math.min(1, entry.position / entry.duration))
                : 0;
            const isLoading = loadingUrl === entry.searchResponse.url;
            return (
              <div
                key={`${entry.searchResponse.url}-${entry.episode.season}-${entry.episode.episode}-${idx}`}
                className="relative shrink-0 snap-start"
                style={{ width: CARD_WIDTH }}
              >
                <PosterCard
                  searchResponse={entry.searchResponse}
                  variant="wide"
                  progress={pct}
                  subtitle={buildSubtitle(entry)}
                  onClick={() => handleResume(entry)}
                />
                {/* Per-card loading overlay (while links are being fetched) */}
                {isLoading && (
                  <div
                    className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60 backdrop-blur-sm"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <Loader2 className="size-6 animate-spin text-[#BEC8FF]" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Trailing pad so the last card can snap to the left edge */}
          <div className="shrink-0" style={{ width: "1px" }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

/** Hover-only arrow button (matches the HomeRail arrow styling). */
function RailArrow({
  dir,
  onClick,
  ariaLabel,
}: {
  dir: "left" | "right";
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "absolute top-0 bottom-2 z-20 hidden",
        "flex items-center justify-center",
        "w-10 cursor-pointer",
        "opacity-0 transition-opacity duration-200",
        "group-hover/rail:opacity-100 md:flex",
        "focus:opacity-100 focus:outline-none",
        dir === "left" ? "left-0" : "right-0",
        dir === "left"
          ? "bg-gradient-to-r from-[#1e1e1e] via-[#1e1e1e]/80 to-transparent"
          : "bg-gradient-to-l from-[#1e1e1e] via-[#1e1e1e]/80 to-transparent"
      )}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full",
          "bg-black/60 text-white ring-1 ring-white/10 backdrop-blur",
          "transition-transform hover:scale-110 hover:bg-[#7664ed]"
        )}
      >
        {dir === "left" ? (
          <ChevronLeft className="size-5" />
        ) : (
          <ChevronRight className="size-5" />
        )}
      </span>
    </button>
  );
}
