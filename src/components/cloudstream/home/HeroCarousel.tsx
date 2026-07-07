'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Info,
  Plus,
  Check,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { SearchResponse, TvType } from "@/lib/cloudstream/types";
import { useAppStore } from "@/lib/cloudstream/store/app-store";

/**
 * HeroCarousel — the full-bleed featured-titles carousel at the top of the
 * CloudStream home screen.
 *
 * Mirrors the Android `HomeFragment` hero pager (`home_recycler_item.xml` +
 * `home_parent_big.xml`):
 *   - ~60vh full-width background image (backgroundUrl, falling back to
 *     posterUrl, falling back to a brand gradient).
 *   - Dark gradient overlays top + bottom so the foreground text is legible
 *     regardless of the underlying image's brightness.
 *   - Centered text block: title (large) + a row of "genre tag" chips. The
 *     SearchResponse doesn't carry genres, so we synthesize tags from the
 *     type label, the provider name, and the quality field — that matches
 *     what the Android home shows when a title has no TMDB metadata.
 *   - Three action buttons:
 *       "+ None / ✓ In Library" — toggles `useAppStore.toggleBookmark`.
 *       "Play"                  — accent-filled, navigates to the result page
 *                                 (the result view's Play button actually
 *                                 loads links + opens the player).
 *       "Info"                  — outline, navigates to the result page.
 *   - Auto-rotates every 6 seconds (paused on hover / focus).
 *   - Manual navigation: left/right arrow buttons + dot indicators.
 *
 * Implementation note: uses the `embla-carousel-react` hook directly (not the
 * shadcn <Carousel>) because we need fine-grained control over autoplay,
 * dot indicators, and per-slide content rather than a generic card scroller.
 */

const AUTOPLAY_MS = 6000;

const FALLBACK_GRADIENTS = [
  "linear-gradient(135deg, #2a1e4a 0%, #1e1e1e 70%)",
  "linear-gradient(135deg, #4a1e3a 0%, #1e1e1e 70%)",
  "linear-gradient(135deg, #1e3a4a 0%, #1e1e1e 70%)",
  "linear-gradient(135deg, #3a4a1e 0%, #1e1e1e 70%)",
  "linear-gradient(135deg, #4a3a1e 0%, #1e1e1e 70%)",
];

function pickGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return FALLBACK_GRADIENTS[h % FALLBACK_GRADIENTS.length];
}

/** Synthesize up to 3 short "genre tag" strings from a SearchResponse. */
function synthesizeTags(sr: SearchResponse): string[] {
  const tags: string[] = [];
  switch (sr.type) {
    case TvType.Movie: tags.push("Movie"); break;
    case TvType.TvSeries: tags.push("TV Series"); break;
    case TvType.Anime: tags.push("Anime"); break;
    case TvType.AsianDrama: tags.push("Drama"); break;
    case TvType.Documentaries: tags.push("Documentary"); break;
    case TvType.Live: tags.push("Live"); break;
    default: break;
  }
  if (sr.quality) tags.push(sr.quality);
  if (sr.apiName) tags.push(sr.apiName);
  return tags.slice(0, 3);
}

export interface HeroCarouselProps {
  items: SearchResponse[];
  className?: string;
}

export function HeroCarousel({ items, className }: HeroCarouselProps) {
  const openResult = useAppStore((s) => s.openResult);
  const toggleBookmark = useAppStore((s) => s.toggleBookmark);
  const bookmarks = useAppStore((s) => s.bookmarks);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "start",
    skipSnaps: false,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const slides = useMemo(() => items.slice(0, 8), [items]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  const scrollPrev = useCallback(() => {
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    emblaApi?.scrollNext();
  }, [emblaApi]);

  // Wire up embla's select listener
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Auto-rotate, paused on hover/focus
  useEffect(() => {
    if (!emblaApi || paused || slides.length <= 1) return;
    const id = window.setInterval(() => {
      emblaApi.scrollNext();
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [emblaApi, paused, slides.length]);

  // Keyboard navigation when the carousel viewport is focused
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollPrev();
      }
    },
    [scrollNext, scrollPrev]
  );

  if (slides.length === 0) return null;

  return (
    <section
      className={cn("relative w-full overflow-hidden bg-[#1e1e1e]", className)}
      aria-roledescription="carousel"
      aria-label="Featured titles"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Embla viewport */}
      <div
        ref={emblaRef}
        className="h-[56vh] min-h-[360px] w-full max-h-[640px]"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="group"
        aria-roledescription="slide container"
      >
        <div className="flex h-full">
          {slides.map((sr, idx) => {
            const bg = sr.backgroundUrl || sr.posterUrl;
            const isBookmarked = bookmarks.some(
              (b) => b.searchResponse.url === sr.url
            );
            const tags = synthesizeTags(sr);
            const isActive = idx === selectedIndex;
            return (
              <div
                key={`${sr.url}-${idx}`}
                className="relative min-w-0 flex-[0_0_100%] h-full"
                aria-hidden={!isActive}
                aria-roledescription="slide"
                aria-label={`${idx + 1} of ${slides.length}: ${sr.name}`}
              >
                {/* Background image */}
                <div className="absolute inset-0">
                  {bg ? (
                    <Image
                      src={bg}
                      alt=""
                      fill
                      sizes="100vw"
                      className="object-cover"
                      priority={idx === 0}
                      unoptimized
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div
                      className="absolute inset-0"
                      style={{ background: pickGradient(sr.url || sr.name) }}
                      aria-hidden="true"
                    />
                  )}
                </div>

                {/* Top + bottom gradient overlays for legibility */}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#1e1e1e]/80 via-transparent to-[#1e1e1e]/95" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#1e1e1e] via-[#1e1e1e]/70 to-transparent" />

                {/* Foreground content — bottom-aligned on mobile, centered on desktop */}
                <div className="relative z-10 flex h-full flex-col items-center justify-end px-6 pb-[14%] text-center sm:justify-center sm:pb-0 sm:pt-[10%]">
                  <div className="max-w-3xl">
                    {/* Title */}
                    <h2 className="text-3xl font-bold leading-tight text-white drop-shadow-lg sm:text-5xl lg:text-6xl">
                      {sr.name}
                    </h2>

                    {/* Genre tags */}
                    {tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        {tags.map((t, i) => (
                          <span
                            key={`${t}-${i}`}
                            className="rounded-full border border-white/15 bg-black/40 px-3 py-0.5 text-xs font-medium text-[#a0a0a0] backdrop-blur"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleBookmark(sr)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold backdrop-blur transition-colors",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/70",
                          isBookmarked
                            ? "border border-[#7664ed]/60 bg-[#7664ed]/20 text-white"
                            : "border border-white/30 bg-black/40 text-white hover:bg-black/60"
                        )}
                        aria-pressed={isBookmarked}
                        aria-label={
                          isBookmarked
                            ? `Remove ${sr.name} from library`
                            : `Add ${sr.name} to library`
                        }
                      >
                        {isBookmarked ? (
                          <Check className="size-4 text-[#7664ed]" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                        <span>{isBookmarked ? "In Library" : "None"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openResult(sr.url, sr.apiName)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md bg-[#7664ed] px-6 py-2 text-sm font-bold text-white shadow-lg shadow-[#7664ed]/40",
                          "transition-colors hover:bg-[#8774f0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/70"
                        )}
                        aria-label={`Play ${sr.name}`}
                      >
                        <Play className="size-4 fill-current" />
                        <span>Play</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openResult(sr.url, sr.apiName)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border border-white/30 bg-black/40 px-4 py-2 text-sm font-semibold text-white backdrop-blur",
                          "transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/70"
                        )}
                        aria-label={`More info about ${sr.name}`}
                      >
                        <Info className="size-4" />
                        <span>Info</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Left / right arrow nav (hidden if only one slide) */}
      {slides.length > 1 && (
        <>
          <button
            type="button"
            onClick={scrollPrev}
            aria-label="Previous featured title"
            className={cn(
              "absolute left-2 top-1/2 z-20 -translate-y-1/2",
              "flex size-10 items-center justify-center rounded-full",
              "bg-black/50 text-white ring-1 ring-white/10 backdrop-blur",
              "transition-all hover:bg-[#7664ed] hover:scale-110",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/70",
              "sm:left-4 sm:size-12"
            )}
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            onClick={scrollNext}
            aria-label="Next featured title"
            className={cn(
              "absolute right-2 top-1/2 z-20 -translate-y-1/2",
              "flex size-10 items-center justify-center rounded-full",
              "bg-black/50 text-white ring-1 ring-white/10 backdrop-blur",
              "transition-all hover:bg-[#7664ed] hover:scale-110",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/70",
              "sm:right-4 sm:size-12"
            )}
          >
            <ChevronRight className="size-6" />
          </button>

          {/* Dot indicators */}
          <div
            className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
            role="tablist"
            aria-label="Choose featured title"
          >
            {slides.map((sr, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={`${sr.url}-dot-${idx}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`Go to slide ${idx + 1}: ${sr.name}`}
                  onClick={() => emblaApi?.scrollTo(idx)}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    active
                      ? "w-6 bg-[#7664ed] shadow-[0_0_8px_rgba(118,100,237,0.7)]"
                      : "w-2 bg-white/40 hover:bg-white/70"
                  )}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
