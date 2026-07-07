'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Star,
  Calendar,
  Clock,
  Tag,
  ChevronDown,
  ChevronUp,
  Play,
  AlertCircle,
  RefreshCw,
  WifiOff,
  Film,
  Users,
  Tv,
} from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import { APIHolder } from "@/lib/cloudstream/MainAPI";
import {
  TvType,
  type LoadResponse,
  type Episode,
  type SearchResponse,
  type Actor,
} from "@/lib/cloudstream/types";
import { loadEpisodeLinks } from "@/lib/cloudstore/load-links";
import { useToast } from "@/hooks/use-toast";

import { EpisodeList } from "./EpisodeList";
import { ActionBar } from "./ActionBar";
import { SyncPanel } from "./SyncPanel";
import { RecommendationsRail } from "./RecommendationsRail";
import { InlineSpinner } from "../common/Loading";

/**
 * ResultView — the CloudStream title-detail page.
 *
 * Reads `currentResultUrl` + `currentResultApiName` from the global app
 * store, fetches the LoadResponse via the provider's `load()` method
 * (cached for 10 minutes via TanStack Query, mirroring the Android
 * APIRepository.load LRU), and renders:
 *
 *   - Hero section: dimmed background image, poster on the left, title /
 *     metadata / plot / cast / action buttons on the right.
 *   - Episode list (only for TvSeries / Anime / AsianDrama types).
 *   - Sync status panel (collapsible).
 *   - Recommendations rail.
 *
 * Clicking Play (movie) or an episode (series) calls `loadEpisodeLinks`
 * and then `useAppStore.openPlayer(...)` to hand off to the player view.
 */

const STALE_TIME = 10 * 60 * 1000; // 10 minutes — matches Android APIRepository.load cache

export function ResultView() {
  const url = useAppStore((s) => s.currentResultUrl);
  const apiName = useAppStore((s) => s.currentResultApiName);
  const setView = useAppStore((s) => s.setView);
  const openPlayer = useAppStore((s) => s.openPlayer);
  const { toast } = useToast();

  const episodesSectionRef = useRef<HTMLDivElement>(null);
  const [loadingEpisodeKey, setLoadingEpisodeKey] = useState<string | null>(null);
  const [isPlayLoading, setIsPlayLoading] = useState(false);

  // ---- TanStack Query: call provider.load(url) ----------------------------
  const query = useQuery<LoadResponse>({
    queryKey: ["cloudstream", "result", apiName, url],
    queryFn: async () => {
      if (!apiName || !url) {
        throw new Error("Missing apiName or url");
      }
      const provider = APIHolder.getApiByName(apiName);
      if (!provider) {
        throw new Error(`Provider "${apiName}" is not registered.`);
      }
      const resp = await provider.load(url);
      if (!resp) {
        throw new Error("Provider returned an empty response.");
      }
      return resp;
    },
    enabled: Boolean(apiName && url),
    staleTime: STALE_TIME,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const loadResponse = query.data;

  // ---- Episode play handler ----------------------------------------------
  // Builds a SearchResponse (for player metadata), loads links, opens player.
  const handlePlay = useCallback(
    async (episode: Episode | null) => {
      if (!loadResponse) return;

      // For a movie, episode will be null — synthesize one from dataUrl.
      const ep: Episode = episode ?? {
        name: loadResponse.name,
        season: 0,
        episode: 0,
        data: loadResponse.dataUrl ?? loadResponse.url,
      };

      // Need a `data` payload for loadLinks.
      if (!ep.data) {
        toast({
          title: "Cannot play this episode",
          description: "The provider did not return a playable data payload.",
          variant: "destructive",
        });
        return;
      }

      const key = `${ep.season ?? 0}-${ep.episode ?? 0}`;
      setLoadingEpisodeKey(key);
      setIsPlayLoading(true);

      try {
        const { links, subtitles } = await loadEpisodeLinks(
          loadResponse.apiName,
          ep.data,
          false
        );

        if (links.length === 0) {
          toast({
            title: "No playable sources found",
            description:
              "The provider didn't return any video links. Try another provider or quality.",
            variant: "destructive",
          });
          return;
        }

        const meta: SearchResponse = {
          name: loadResponse.name,
          url: loadResponse.url,
          apiName: loadResponse.apiName,
          type: loadResponse.type,
          posterUrl: loadResponse.posterUrl,
          backgroundUrl: loadResponse.backgroundUrl,
        };

        openPlayer(ep, links, meta);
        // Note: subtitles are stashed via the player view reading them from
        // a future store field — for now we just pass the count to the user.
        if (subtitles.length > 0) {
          toast({
            title: `${subtitles.length} subtitle track${subtitles.length === 1 ? "" : "s"} available`,
          });
        }
      } catch (e) {
        toast({
          title: "Failed to load sources",
          description:
            e instanceof Error ? e.message : "Unknown error while loading links.",
          variant: "destructive",
        });
      } finally {
        setLoadingEpisodeKey(null);
        setIsPlayLoading(false);
      }
    },
    [loadResponse, openPlayer, toast]
  );

  // ---- Render branches ----------------------------------------------------

  // No url — direct navigation. Show empty state.
  if (!apiName || !url) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-12">
        <BackButton onBack={() => setView("home")} />
        <NoSelectionState />
      </div>
    );
  }

  // Initial loading
  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <BackButton onBack={() => setView("home")} />
        <ResultSkeleton />
      </div>
    );
  }

  // Error
  if (query.isError) {
    const msg =
      query.error instanceof Error
        ? query.error.message
        : "Failed to load this title. Please try again.";
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <BackButton onBack={() => setView("home")} />
        <ErrorState message={msg} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  if (!loadResponse) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <BackButton onBack={() => setView("home")} />
        <ErrorState
          message="Provider returned an empty response."
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  // ---- Success: render the result page -----------------------------------

  const isSeries =
    loadResponse.type === TvType.TvSeries ||
    loadResponse.type === TvType.Anime ||
    loadResponse.type === TvType.AsianDrama;

  const episodes = (loadResponse as LoadResponse & { episodes?: Episode[] }).episodes ?? [];
  const recommendations = loadResponse.recommendations ?? [];
  const actors = loadResponse.actors ?? [];
  const trailers = loadResponse.trailers ?? [];

  // Max episodes for the sync panel (best-effort: count distinct seasons).
  const maxEpisodes =
    episodes.length > 0
      ? Math.max(...episodes.map((e) => e.episode ?? 0))
      : undefined;

  // Scroll-to-episodes for the Play button on series.
  const handlePlayScroll = () => {
    episodesSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="mx-auto max-w-[1600px] pb-12">
      {/* Back button (above hero) */}
      <div className="px-4 pt-3">
        <BackButton onBack={() => setView("home")} />
      </div>

      {/* Hero */}
      <HeroSection
        loadResponse={loadResponse}
        actors={actors}
        onPlay={isSeries ? handlePlayScroll : () => void handlePlay(null)}
        isPlayLoading={isPlayLoading}
        hasTrailers={trailers.length > 0}
      />

      {/* Episodes */}
      {isSeries && (
        <section
          ref={episodesSectionRef}
          className="scroll-mt-20 px-4 py-6"
          aria-label="Episodes"
        >
          <SectionTitle
            icon={<Tv className="size-5 text-[#7664ed]" />}
            title="Episodes"
            subtitle={`${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}`}
          />
          <div className="mt-4">
            <EpisodeList
              episodes={episodes}
              onPlay={(ep) => void handlePlay(ep)}
              loadingEpisodeKey={loadingEpisodeKey}
            />
          </div>
        </section>
      )}

      {/* Sync panel */}
      <section className="px-4 py-6" aria-label="Sync status">
        <SectionTitle
          icon={<RefreshCw className="size-5 text-[#7664ed]" />}
          title="Sync"
          subtitle="Track progress across providers"
        />
        <div className="mt-4">
          <SyncPanel loadResponse={loadResponse} maxEpisodes={maxEpisodes} />
        </div>
      </section>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <section className="py-4" aria-label="Recommendations">
          <RecommendationsRail items={recommendations} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeroSection
// ---------------------------------------------------------------------------

interface HeroSectionProps {
  loadResponse: LoadResponse;
  actors: Actor[];
  onPlay: () => void;
  isPlayLoading: boolean;
  hasTrailers: boolean;
}

function HeroSection({
  loadResponse,
  actors,
  onPlay,
  isPlayLoading,
}: HeroSectionProps) {
  const [plotExpanded, setPlotExpanded] = useState(false);
  const [bgError, setBgError] = useState(false);
  const [posterError, setPosterError] = useState(false);

  const plot = loadResponse.plot?.trim() ?? "";
  const isLongPlot = plot.length > 320;
  const showPlotToggle = isLongPlot;

  // Build a minimal LoadResponse-shaped object the ActionBar can use — it
  // only reads a few fields so the cast is safe.
  const actionBarPayload = loadResponse as LoadResponse;

  // Metadata chips: year, rating, duration, type
  const metaChips: { icon?: React.ReactNode; label: string }[] = [];
  const yearMatch = loadResponse.date?.match(/(\d{4})/);
  if (yearMatch) {
    metaChips.push({
      icon: <Calendar className="size-3.5" />,
      label: yearMatch[1],
    });
  }
  if (loadResponse.rating != null && loadResponse.rating > 0) {
    metaChips.push({
      icon: <Star className="size-3.5 fill-[#FFC107] text-[#FFC107]" />,
      label: loadResponse.rating.toFixed(1),
    });
  }
  if (loadResponse.duration) {
    metaChips.push({
      icon: <Clock className="size-3.5" />,
      label: loadResponse.duration,
    });
  }
  metaChips.push({
    icon: <Film className="size-3.5" />,
    label: tvTypeLabel(loadResponse.type),
  });

  return (
    <section className="relative" aria-label={loadResponse.name}>
      {/* Background image (dimmed, fills width) */}
      <div className="absolute inset-x-0 top-0 h-[55vh] min-h-[400px] overflow-hidden">
        {loadResponse.backgroundUrl && !bgError ? (
          <Image
            src={loadResponse.backgroundUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
            unoptimized
            referrerPolicy="no-referrer"
            onError={() => setBgError(true)}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#3a2a6a] via-[#2d2d2d] to-[#1e1e1e]" />
        )}
        {/* Dim + gradient overlays for readability */}
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1e1e1e] via-[#1e1e1e]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1e1e1e]/80 via-transparent to-transparent" />
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative px-4 pt-[30vh] sm:pt-[35vh]"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:gap-6 lg:gap-8">
          {/* Poster (left on desktop, top on mobile) */}
          <div className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-48 lg:w-56">
            <div
              className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-[#2d2d2d] shadow-2xl shadow-black/50 ring-1 ring-[#3d3d3d]"
            >
              {loadResponse.posterUrl && !posterError ? (
                <Image
                  src={loadResponse.posterUrl}
                  alt={loadResponse.name}
                  fill
                  priority
                  sizes="(max-width: 640px) 160px, 224px"
                  className="object-cover"
                  unoptimized
                  referrerPolicy="no-referrer"
                  onError={() => setPosterError(true)}
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#3a2a6a] to-[#2d2d2d] p-4 text-center">
                  <Film className="size-10 text-[#a0a0a0]" />
                  <span className="line-clamp-3 text-xs font-medium text-white">
                    {loadResponse.name}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Metadata (right) */}
          <div className="flex min-w-0 flex-1 flex-col gap-3 pb-6">
            {/* Title */}
            <h1 className="text-2xl font-bold leading-tight text-white drop-shadow-lg sm:text-3xl lg:text-4xl">
              {loadResponse.name}
            </h1>

            {/* Meta chips row */}
            {metaChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[#a0a0a0] sm:text-sm">
                {metaChips.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {c.icon}
                    <span className="font-medium text-white/90">{c.label}</span>
                    {i < metaChips.length - 1 && (
                      <span className="ml-3 text-[#3d3d3d]">·</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Tags */}
            {loadResponse.tags && loadResponse.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag className="size-3.5 text-[#a0a0a0]" />
                {loadResponse.tags.slice(0, 8).map((tag, i) => (
                  <span
                    key={`${tag}-${i}`}
                    className="rounded-full border border-[#3d3d3d] bg-[#2d2d2d]/80 px-2.5 py-0.5 text-xs text-white/90"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Plot synopsis (expandable) */}
            {plot && (
              <div className="mt-1 max-w-3xl">
                <p
                  className={cn(
                    "text-sm leading-relaxed text-[#a0a0a0] sm:text-base",
                    !plotExpanded && isLongPlot && "line-clamp-3"
                  )}
                >
                  {plot}
                </p>
                {showPlotToggle && (
                  <button
                    type="button"
                    onClick={() => setPlotExpanded((e) => !e)}
                    className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[#7664ed] hover:underline"
                  >
                    {plotExpanded ? (
                      <>
                        Show less <ChevronUp className="size-3.5" />
                      </>
                    ) : (
                      <>
                        Show more <ChevronDown className="size-3.5" />
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-2">
              <ActionBar
                loadResponse={actionBarPayload}
                onPlay={() => onPlay()}
                isPlayLoading={isPlayLoading}
              />
            </div>

            {/* Cast */}
            {actors.length > 0 && (
              <CastRow actors={actors} />
            )}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CastRow — horizontally scrollable list of actor avatars.
// ---------------------------------------------------------------------------

function CastRow({ actors }: { actors: Actor[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[#a0a0a0]">
        <Users className="size-3.5" />
        Cast
      </div>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: "thin" }}
      >
        {actors.map((actor, i) => (
          <CastAvatar key={`${actor.name}-${i}`} actor={actor} />
        ))}
      </div>
    </div>
  );
}

function CastAvatar({ actor }: { actor: Actor }) {
  const [err, setErr] = useState(false);
  const initial = actor.name.charAt(0).toUpperCase();
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 sm:w-20">
      <div className="relative size-16 overflow-hidden rounded-full bg-[#2d2d2d] ring-1 ring-[#3d3d3d] sm:size-20">
        {actor.imageUrl && !err ? (
          <Image
            src={actor.imageUrl}
            alt={actor.name}
            fill
            sizes="80px"
            className="object-cover"
            unoptimized
            referrerPolicy="no-referrer"
            onError={() => setErr(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-[#3a2a6a] to-[#2d2d2d] text-xl font-bold text-white">
            {initial}
          </div>
        )}
      </div>
      <span
        className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-white/80 sm:text-xs"
        title={actor.name}
      >
        {actor.name}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section title
// ---------------------------------------------------------------------------

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="flex items-center gap-2 text-lg font-semibold text-white sm:text-xl">
        <span className="flex size-7 items-center justify-center rounded-md bg-[#7664ed]/15">
          {icon}
        </span>
        {title}
      </span>
      {subtitle && (
        <span className="text-xs text-[#a0a0a0]">· {subtitle}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Back button
// ---------------------------------------------------------------------------

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-[#a0a0a0]",
        "transition-colors hover:bg-white/5 hover:text-white",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
      )}
      aria-label="Back"
    >
      <ArrowLeft className="size-4" />
      Back
    </button>
  );
}

// ---------------------------------------------------------------------------
// Loading / Error / Empty states
// ---------------------------------------------------------------------------

function ResultSkeleton() {
  return (
    <div className="relative">
      {/* Hero skeleton */}
      <div className="relative h-[55vh] min-h-[400px] w-full overflow-hidden bg-[#2d2d2d]">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#3a2a6a]/40 via-[#2d2d2d] to-[#1e1e1e]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1e1e1e] via-[#1e1e1e]/70 to-transparent" />
      </div>
      <div className="relative -mt-32 px-4">
        <div className="flex flex-col gap-5 sm:flex-row sm:gap-6 lg:gap-8">
          {/* Poster skeleton */}
          <div className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-48 lg:w-56">
            <div
              className="aspect-[2/3] w-full animate-pulse rounded-lg bg-[#2d2d2d] ring-1 ring-[#3d3d3d]"
              aria-hidden="true"
            />
          </div>
          {/* Metadata skeleton */}
          <div className="flex flex-1 flex-col gap-3 pb-6">
            <div className="h-8 w-2/3 animate-pulse rounded-md bg-[#2d2d2d]" />
            <div className="h-4 w-1/2 animate-pulse rounded-md bg-[#2d2d2d]" />
            <div className="mt-2 flex gap-2">
              <div className="h-9 w-24 animate-pulse rounded-md bg-[#2d2d2d]" />
              <div className="h-9 w-28 animate-pulse rounded-md bg-[#2d2d2d]" />
              <div className="h-9 w-24 animate-pulse rounded-md bg-[#2d2d2d]" />
            </div>
            <div className="mt-2 space-y-2">
              <div className="h-3 w-full animate-pulse rounded-sm bg-[#2d2d2d]" />
              <div className="h-3 w-5/6 animate-pulse rounded-sm bg-[#2d2d2d]" />
              <div className="h-3 w-2/3 animate-pulse rounded-sm bg-[#2d2d2d]" />
            </div>
          </div>
        </div>
      </div>

      {/* Inline loading indicator */}
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#a0a0a0]">
        <InlineSpinner className="text-[#7664ed]" />
        Loading title details…
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#7a3a3a]/30 ring-1 ring-[#F53B66]/40">
        <WifiOff className="size-8 text-[#F53B66]" />
      </div>
      <div className="space-y-1">
        <h2 className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
          <AlertCircle className="size-5 text-[#F53B66]" />
          Couldn&apos;t load this title
        </h2>
        <p className="max-w-md text-sm text-[#a0a0a0]">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "mt-2 flex items-center gap-2 rounded-md bg-[#7664ed] px-4 py-2 text-sm font-medium text-white shadow-md shadow-[#7664ed]/30",
          "transition-colors hover:bg-[#8774f0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
        )}
      >
        <RefreshCw className="size-4" />
        Retry
      </button>
    </div>
  );
}

function NoSelectionState() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
        <Play className="size-8 text-[#a0a0a0]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">Nothing to show</h2>
        <p className="max-w-md text-sm text-[#a0a0a0]">
          Pick a title from the Home or Search page to see its details here.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tvTypeLabel(t: TvType): string {
  switch (t) {
    case TvType.Movie: return "Movie";
    case TvType.TvSeries: return "Series";
    case TvType.Anime: return "Anime";
    case TvType.AsianDrama: return "Drama";
    case TvType.Documentaries: return "Documentary";
    case TvType.Live: return "Live";
    case TvType.Torrent: return "Torrent";
    case TvType.NSFW: return "18+";
    case TvType.Music: return "Music";
    case TvType.AudioBook:
    case TvType.Audiobook: return "Audiobook";
    case TvType.Podcast: return "Podcast";
    case TvType.Audio: return "Audio";
    case TvType.CustomMedia: return "Media";
    case TvType.Others: return "Other";
    default: return String(t);
  }
}
