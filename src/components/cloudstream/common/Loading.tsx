'use client';

import { cn } from "@/lib/utils";

/**
 * Loading skeletons for the CloudStream TV-layout UI.
 * Mirrors the Android shimmer placeholders (loading_poster.xml + rail rows).
 *
 * Palette (CloudStream Material3 Dark):
 *   bg-card skeleton: #2d2d2d  (slightly lighter than the #1e1e1e background)
 *   pulse highlight:  rgba(255,255,255,0.04)
 */

const SKELETON_BG = "bg-[#2d2d2d]";

/** A single poster card skeleton (2:3 aspect ratio, gray pulsing rectangle). */
export function PosterCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-md",
        SKELETON_BG,
        "animate-pulse",
        className
      )}
      aria-hidden="true"
    >
      {/* 2:3 aspect ratio */}
      <div className="relative w-full" style={{ aspectRatio: "2 / 3" }}>
        {/* fake poster sheen */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-transparent" />
      </div>
      {/* fake title bar */}
      <div className="p-2">
        <div className={cn("h-3 w-3/4 rounded-sm", SKELETON_BG, "bg-white/[0.06]")} />
        <div className="mt-1.5 h-2.5 w-1/2 rounded-sm bg-white/[0.04]" />
      </div>
    </div>
  );
}

/** A row of poster skeletons — used to fake a horizontal rail while loading. */
export function PosterCardRailSkeleton({ count = 7 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden px-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="shrink-0"
          style={{ width: "clamp(120px, 14vw, 180px)" }}
        >
          <PosterCardSkeleton />
        </div>
      ))}
    </div>
  );
}

/** A whole horizontal rail skeleton: title bar + row of poster skeletons. */
export function RailSkeleton() {
  return (
    <section className="space-y-3 py-2">
      {/* fake rail title */}
      <div className="flex items-center gap-2 px-4">
        <div className="h-5 w-48 animate-pulse rounded-sm bg-[#2d2d2d]" />
        <div className="h-3 w-3 animate-pulse rounded-sm bg-[#2d2d2d]" />
      </div>
      <PosterCardRailSkeleton />
    </section>
  );
}

/** Full home view loading state — 4 stacked rail skeletons. */
export function HomeSkeleton() {
  return (
    <div className="space-y-8 py-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <RailSkeleton key={i} />
      ))}
    </div>
  );
}

/** A responsive grid of poster skeletons (used by the search loading state). */
export function PosterGridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 px-4 py-4
                 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      {Array.from({ length: count }).map((_, i) => (
        <PosterCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** A small inline spinner — used inside buttons / chips. */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
      aria-label="Loading"
    />
  );
}

/** A full-page centered loading state with the CloudStream logo mark. */
export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <div className="relative size-12">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-[#3d3d3d] border-t-[#7664ed]" />
      </div>
      <p className="text-sm text-[#a0a0a0]">{label}…</p>
    </div>
  );
}
