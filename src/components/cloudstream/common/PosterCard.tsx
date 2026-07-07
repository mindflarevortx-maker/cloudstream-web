'use client';

import { memo, useState } from "react";
import Image from "next/image";
import { Play, Star } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { SearchResponse, Score, TvType } from "@/lib/cloudstream/types";
import { useAppStore } from "@/lib/cloudstream/store/app-store";

/**
 * PosterCard — a single poster tile for a SearchResponse.
 *
 * Mirrors the Android `search_result_grid.xml` layout:
 *   - 2:3 aspect-ratio poster image
 *   - quality badge (top-left) and dub/sub badges if present
 *   - score badge (top-right) shown as 0–10
 *   - title below the poster (clamped to 1 line)
 *   - hover effect: scale-up + play overlay
 *   - click → useAppStore.openResult(url, apiName)
 *
 * Responsive: the parent grid controls width; the card fills its column.
 */

const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(135deg, #4a3a7a 0%, #2d2d2d 100%)",
  "linear-gradient(135deg, #7a3a5a 0%, #2d2d2d 100%)",
  "linear-gradient(135deg, #3a5a7a 0%, #2d2d2d 100%)",
  "linear-gradient(135deg, #5a7a3a 0%, #2d2d2d 100%)",
  "linear-gradient(135deg, #7a5a3a 0%, #2d2d2d 100%)",
];

function pickGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PLACEHOLDER_GRADIENTS[h % PLACEHOLDER_GRADIENTS.length];
}

/** Format a Score (fixed-point 0..10^9) into a one-decimal 0–10 string. */
function formatScore(score?: Score): string | null {
  if (!score) return null;
  const v = score.toFloat();
  if (!isFinite(v) || v <= 0) return null;
  return v.toFixed(1);
}

/** Short label for a TvType (shown as a chip). */
function tvTypeLabel(t: TvType): string | null {
  switch (t) {
    case TvType.Movie: return "Movie";
    case TvType.TvSeries: return "Series";
    case TvType.Anime: return "Anime";
    case TvType.AsianDrama: return "Drama";
    case TvType.Documentaries: return "Doc";
    case TvType.Live: return "Live";
    case TvType.Torrent: return "P2P";
    case TvType.NSFW: return "18+";
    case TvType.Music: return "Music";
    case TvType.AudioBook:
    case TvType.Audiobook: return "Audio";
    case TvType.Podcast: return "Pod";
    default: return null;
  }
}

interface PosterCardProps {
  searchResponse: SearchResponse;
  /** Optional fixed width — otherwise the card fills its grid cell. */
  width?: number | string;
  className?: string;
  /** Show the type chip (defaults to true). */
  showType?: boolean;
}

function PosterCardImpl({
  searchResponse,
  width,
  className,
  showType = true,
}: PosterCardProps) {
  const openResult = useAppStore((s) => s.openResult);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const { name, posterUrl, url, apiName, type, quality, score } = searchResponse;
  const scoreStr = formatScore(score);
  const typeLabel = showType ? tvTypeLabel(type) : null;
  const hasPoster = Boolean(posterUrl) && !imgError;

  return (
    <motion.button
      type="button"
      onClick={() => openResult(url, apiName)}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={cn(
        "group relative flex flex-col text-left",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e1e]",
        "rounded-md",
        className
      )}
      style={width ? { width } : undefined}
      aria-label={`Open ${name}`}
      title={name}
    >
      {/* Poster frame (2:3) */}
      <div
        className="relative w-full overflow-hidden rounded-md bg-[#2d2d2d] ring-1 ring-[#3d3d3d]/60 transition-shadow group-hover:ring-[#7664ed]/50 group-hover:shadow-lg group-hover:shadow-[#7664ed]/20"
        style={{ aspectRatio: "2 / 3" }}
      >
        {/* Placeholder gradient (visible while loading / on image error) */}
        {!imgLoaded && (
          <div
            className="absolute inset-0 animate-pulse"
            style={{ background: pickGradient(url || name) }}
            aria-hidden="true"
          />
        )}

        {/* Poster image */}
        {hasPoster && (
          <Image
            src={posterUrl!}
            alt={name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
            className={cn(
              "object-cover transition-opacity duration-300",
              imgLoaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            unoptimized
            referrerPolicy="no-referrer"
          />
        )}

        {/* Bottom gradient overlay for readability of badges */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/30 opacity-80" />

        {/* Top-left badges: quality + type */}
        <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          {quality && (
            <span className="rounded bg-[#3700B3]/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#BEC8FF] shadow-sm">
              {quality}
            </span>
          )}
          {typeLabel && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/90 shadow-sm">
              {typeLabel}
            </span>
          )}
        </div>

        {/* Top-right: score */}
        {scoreStr && (
          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-[#FFC107] shadow-sm">
            <Star className="size-2.5 fill-current" />
            <span>{scoreStr}</span>
          </div>
        )}

        {/* Provider watermark (bottom-right) */}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white/70 opacity-0 transition-opacity group-hover:opacity-100">
          {apiName}
        </span>

        {/* Play overlay (hover) */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="flex size-11 items-center justify-center rounded-full bg-[#7664ed]/90 shadow-lg shadow-[#7664ed]/40 ring-2 ring-white/20">
            <Play className="size-5 translate-x-0.5 fill-white text-white" />
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="mt-2 px-0.5">
        <h3
          className="line-clamp-1 text-sm font-medium leading-tight text-white transition-colors group-hover:text-[#BEC8FF]"
          title={name}
        >
          {name}
        </h3>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-[#a0a0a0]">{apiName}</p>
      </div>
    </motion.button>
  );
}

export const PosterCard = memo(PosterCardImpl);
