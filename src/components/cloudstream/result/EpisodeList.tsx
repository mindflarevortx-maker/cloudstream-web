'use client';

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import {
  Play,
  Star,
  Calendar,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  ArrowDownWideNarrow,
  CalendarClock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/lib/utils";
import type { Episode } from "@/lib/cloudstream/types";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/**
 * EpisodeList — the episode grid on the Result page.
 *
 * Mirrors the Android `EpisodeAdapter` + `episode_recycler` RecyclerView.
 * Features:
 *   - Season selector dropdown (only when there are ≥2 seasons).
 *   - Sort dropdown: by number / by rating / by date (asc/desc toggle).
 *   - Episodes grouped by season (collapsible sections).
 *   - Per-season lazy pagination: 20 at a time, "Load more" button to grow.
 *   - "Coming soon" badge for upcoming episodes (`isUpcoming = true`).
 *   - Click anywhere on a card → calls `onPlay(episode)`.
 *
 * Layout:
 *   - Top toolbar: [season selector] [sort dropdown]
 *   - Body: list of `<SeasonSection>` blocks (or a single flat list when
 *     the user picked a specific season).
 */

export interface EpisodeListProps {
  episodes: Episode[];
  onPlay: (episode: Episode) => void;
  /** Optional: episode currently being loaded (for spinner state). */
  loadingEpisodeKey?: string | null;
}

const PAGE_SIZE = 20;

type SortKey = "number" | "rating" | "date";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  number: "Episode number",
  rating: "Rating",
  date: "Air date",
};

export function EpisodeList({
  episodes,
  onPlay,
  loadingEpisodeKey = null,
}: EpisodeListProps) {
  // ---- State --------------------------------------------------------------
  // Selected season. "all" = show grouped by season.
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("number");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ---- Derived data -------------------------------------------------------
  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const ep of episodes) set.add(ep.season ?? 0);
    return Array.from(set).sort((a, b) => a - b);
  }, [episodes]);

  const hasMultipleSeasons = seasons.length > 1;

  // Sort the episodes (stable across all groups).
  const sortedEpisodes = useMemo(() => {
    const copy = [...episodes];
    const dir = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "number") {
        cmp = (a.season ?? 0) - (b.season ?? 0);
        if (cmp === 0) cmp = (a.episode ?? 0) - (b.episode ?? 0);
      } else if (sortKey === "rating") {
        cmp = (a.rating ?? 0) - (b.rating ?? 0);
      } else if (sortKey === "date") {
        // Compare ISO date strings lexicographically (works for YYYY-MM-DD).
        cmp = (a.date ?? a.airDate ?? "").localeCompare(b.date ?? b.airDate ?? "");
      }
      return cmp * dir;
    });
    return copy;
  }, [episodes, sortKey, sortDir]);

  // Group by season (preserve sorted order).
  const groups = useMemo(() => {
    const map = new Map<number, Episode[]>();
    for (const ep of sortedEpisodes) {
      const s = ep.season ?? 0;
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(ep);
    }
    // If the user filtered to one season, return only that one.
    if (seasonFilter !== "all") {
      const s = Number(seasonFilter);
      return [{ season: s, episodes: map.get(s) ?? [] }];
    }
    return Array.from(map.entries()).map(([season, eps]) => ({ season, episodes: eps }));
  }, [sortedEpisodes, seasonFilter]);

  const toggleSortDir = useCallback(() => {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }, []);

  // ---- Render -------------------------------------------------------------
  if (episodes.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[#3d3d3d] bg-[#2d2d2d]/40 p-8 text-center">
        <AlertCircle className="size-8 text-[#a0a0a0]" />
        <p className="text-sm text-[#a0a0a0]">
          No episodes available for this title.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {hasMultipleSeasons && (
          <Select value={seasonFilter} onValueChange={setSeasonFilter}>
            <SelectTrigger
              className="h-9 w-[150px] border-[#3d3d3d] bg-[#2d2d2d] text-sm text-white hover:border-[#7664ed]/50"
              aria-label="Filter by season"
            >
              <SelectValue placeholder="All seasons" />
            </SelectTrigger>
            <SelectContent className="border-[#3d3d3d] bg-[#2d2d2d] text-white">
              <SelectItem value="all">All seasons</SelectItem>
              {seasons.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s === 0 ? "Specials" : `Season ${s}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={sortKey}
          onValueChange={(v) => setSortKey(v as SortKey)}
        >
          <SelectTrigger
            className="h-9 w-[180px] border-[#3d3d3d] bg-[#2d2d2d] text-sm text-white hover:border-[#7664ed]/50"
            aria-label="Sort episodes"
          >
            <ArrowDownWideNarrow className="size-4 text-[#a0a0a0]" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[#3d3d3d] bg-[#2d2d2d] text-white">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={toggleSortDir}
          className="flex h-9 items-center gap-1.5 rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-3 text-sm text-white hover:border-[#7664ed]/50"
          aria-label={`Sort ${sortDir === "asc" ? "ascending" : "descending"}`}
          title={`Currently ${sortDir === "asc" ? "ascending" : "descending"} — click to flip`}
        >
          {sortDir === "asc" ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <span className="capitalize">{sortDir}</span>
        </button>

        <div className="ml-auto text-xs text-[#a0a0a0]">
          {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}
        </div>
      </div>

      {/* Groups */}
      <div className="space-y-4">
        {groups.map((g) => (
          <SeasonSection
            key={g.season}
            season={g.season}
            episodes={g.episodes}
            onPlay={onPlay}
            loadingEpisodeKey={loadingEpisodeKey}
            collapsible={seasonFilter === "all"}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeasonSection — a single season's episode list (collapsible when grouping).
// ---------------------------------------------------------------------------

interface SeasonSectionProps {
  season: number;
  episodes: Episode[];
  onPlay: (ep: Episode) => void;
  loadingEpisodeKey?: string | null;
  collapsible: boolean;
}

function SeasonSection({
  season,
  episodes,
  onPlay,
  loadingEpisodeKey,
  collapsible,
}: SeasonSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const label = season === 0 ? "Specials" : `Season ${season}`;
  const visible = episodes.slice(0, visibleCount);
  const remaining = episodes.length - visible.length;
  const hasMore = remaining > 0;

  return (
    <section
      className="overflow-hidden rounded-lg border border-[#3d3d3d] bg-[#2d2d2d]/40"
      aria-label={label}
    >
      {/* Section header */}
      <div
        className={cn(
          "flex items-center gap-2 border-b border-[#3d3d3d] bg-[#2d2d2d]/60 px-4 py-2.5",
          collapsible && "cursor-pointer select-none hover:bg-[#333]/60"
        )}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setCollapsed((c) => !c);
                }
              }
            : undefined
        }
      >
        {collapsible && (
          <ChevronDown
            className={cn(
              "size-4 text-[#a0a0a0] transition-transform",
              collapsed && "-rotate-90"
            )}
          />
        )}
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        <span className="text-xs text-[#a0a0a0]">
          {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}
        </span>
      </div>

      {/* Episode list */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <ul className="divide-y divide-[#3d3d3d]/60">
              {visible.map((ep, idx) => (
                <EpisodeCard
                  key={`${ep.season}-${ep.episode}-${idx}`}
                  episode={ep}
                  onPlay={onPlay}
                  isLoading={
                    loadingEpisodeKey ===
                    `${ep.season ?? 0}-${ep.episode ?? 0}`
                  }
                />
              ))}
            </ul>

            {hasMore && (
              <div className="flex justify-center border-t border-[#3d3d3d]/60 p-3">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="flex items-center gap-2 rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-4 py-2 text-sm font-medium text-white hover:border-[#7664ed]/50 hover:bg-[#333]"
                >
                  Load {Math.min(PAGE_SIZE, remaining)} more
                  <span className="text-xs text-[#a0a0a0]">
                    ({remaining} remaining)
                  </span>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ---------------------------------------------------------------------------
// EpisodeCard — a single horizontal episode row.
// ---------------------------------------------------------------------------

interface EpisodeCardProps {
  episode: Episode;
  onPlay: (ep: Episode) => void;
  isLoading?: boolean;
}

function EpisodeCard({ episode, onPlay, isLoading }: EpisodeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const title =
    episode.name?.trim() ||
    `Episode ${episode.episode ?? "?"}${episode.season ? ` · S${episode.season}` : ""}`;

  const rating = episode.rating != null && episode.rating > 0
    ? episode.rating.toFixed(1)
    : null;

  const airDate = episode.airDate ?? episode.date;
  const hasDescription = Boolean(episode.description?.trim());
  const isLongDesc = (episode.description?.length ?? 0) > 180;
  const isUpcoming = episode.isUpcoming === true;

  return (
    <li
      className={cn(
        "group relative flex gap-3 p-3 transition-colors sm:gap-4 sm:p-4",
        "hover:bg-[#7664ed]/5 focus-within:bg-[#7664ed]/5"
      )}
    >
      {/* Poster thumbnail (clickable) */}
      <button
        type="button"
        onClick={() => onPlay(episode)}
        disabled={isLoading || isUpcoming}
        className={cn(
          "relative size-20 shrink-0 overflow-hidden rounded-md bg-[#1e1e1e] ring-1 ring-[#3d3d3d]/60",
          "transition-all hover:ring-[#7664ed]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
          "sm:size-24",
          (isLoading || isUpcoming) && "cursor-not-allowed opacity-60"
        )}
        aria-label={`Play ${title}`}
      >
        {episode.posterUrl && !imgError ? (
          <Image
            src={episode.posterUrl}
            alt={title}
            fill
            sizes="96px"
            className="object-cover"
            unoptimized
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center bg-gradient-to-br from-[#3a2a6a] to-[#2d2d2d] text-center">
            <span className="text-[10px] uppercase tracking-wider text-[#a0a0a0]">
              Ep
            </span>
            <span className="text-lg font-bold text-white">
              {episode.episode ?? "—"}
            </span>
          </div>
        )}

        {/* Hover play overlay */}
        {!isUpcoming && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#7664ed] shadow-lg shadow-[#7664ed]/40 ring-2 ring-white/20">
              <Play className="size-4 translate-x-0.5 fill-white text-white" />
            </div>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        )}

        {isUpcoming && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <span className="rounded bg-[#FFC107] px-1.5 py-0.5 text-[10px] font-bold uppercase text-black">
              Soon
            </span>
          </div>
        )}
      </button>

      {/* Metadata */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="shrink-0 rounded bg-[#7664ed]/20 px-1.5 py-0.5 text-[11px] font-semibold text-[#BEC8FF]">
            {episode.season ? `S${episode.season} · ` : ""}E{episode.episode ?? "?"}
          </span>
          <h4 className="truncate text-sm font-semibold text-white sm:text-base" title={title}>
            {title}
          </h4>
          {isUpcoming && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-[#FFC107]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#FFC107]">
              <CalendarClock className="size-3" />
              Coming soon
            </span>
          )}
        </div>

        {/* Sub-meta: rating · air date · duration */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#a0a0a0]">
          {rating && (
            <span className="flex items-center gap-1">
              <Star className="size-3 fill-[#FFC107] text-[#FFC107]" />
              <span className="font-medium text-[#FFC107]">{rating}</span>
            </span>
          )}
          {airDate && (
            <span className="flex items-center gap-1">
              <Calendar className="size-3" />
              {formatAirDate(airDate)}
            </span>
          )}
        </div>

        {/* Description (expandable) */}
        {hasDescription && (
          <div className="mt-0.5">
            <p
              className={cn(
                "text-xs leading-relaxed text-[#a0a0a0] sm:text-sm",
                !expanded && isLongDesc && "line-clamp-2"
              )}
            >
              {episode.description}
            </p>
            {isLongDesc && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="mt-1 text-xs font-medium text-[#7664ed] hover:underline focus:outline-none focus-visible:underline"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {/* Mobile-only inline play button (hidden on sm+) */}
        <button
          type="button"
          onClick={() => onPlay(episode)}
          disabled={isLoading || isUpcoming}
          className={cn(
            "mt-1 flex items-center gap-1.5 self-start rounded-md bg-[#7664ed]/15 px-2.5 py-1 text-xs font-medium text-[#BEC8FF]",
            "sm:hidden",
            (isLoading || isUpcoming) && "cursor-not-allowed opacity-60"
          )}
        >
          <Play className="size-3 fill-current" />
          {isLoading ? "Loading…" : "Play"}
        </button>
      </div>
    </li>
  );
}

/** Format an ISO date string (YYYY-MM-DD) into "Mon DD, YYYY". */
function formatAirDate(iso: string): string {
  // Reject anything that doesn't look like a date.
  if (!iso || iso.length < 4) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
