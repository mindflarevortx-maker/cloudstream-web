'use client';

import { useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { SearchResponse } from "@/lib/cloudstream/types";
import { PosterCard } from "../common/PosterCard";

/**
 * HomeRail — a horizontal rail (row) of poster cards.
 *
 * Mirrors the Android `homepage_parent_tv.xml` / `homepage_parent.xml` layout:
 *   - a rail title (TextView) on the left
 *   - a horizontally-scrollable RecyclerView of `HomeResultGrid` items
 *
 * On web we add:
 *   - CSS scroll-snap for smooth, card-aligned scrolling
 *   - left/right arrow buttons that appear on hover (TV-remote friendly)
 *   - keyboard support: ← / → when the rail is focused
 *
 * Props:
 *   - title: the rail heading
 *   - items: SearchResponse[] to render as PosterCards
 *   - onMore?: optional callback when the user clicks the title (mirrors the
 *     Android `moreInfoClickCallback` that opens a bottom-sheet with the
 *     full list). Not used by HomeView yet but wired for the future.
 */
export interface HomeRailProps {
  title: string;
  items: SearchResponse[];
  onMore?: () => void;
  className?: string;
}

/** Card width: clamps to be TV-friendly (≥120px) but not huge on desktop. */
const CARD_WIDTH = "clamp(120px, 14vw, 180px)";

export function HomeRail({ title, items, onMore, className }: HomeRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollByDir = useCallback((dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    // Scroll ~2.5 card widths per click
    const amount = el.clientWidth * 0.7 * (dir === "right" ? 1 : -1);
    el.scrollBy({ left: amount, behavior: "smooth" });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollByDir("right");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollByDir("left");
      }
    },
    [scrollByDir]
  );

  if (!items || items.length === 0) return null;

  return (
    <section
      className={cn("group/rail relative py-2", className)}
      aria-label={title}
    >
      {/* Title row */}
      <div className="flex items-baseline justify-between gap-2 px-4 pb-2">
        <button
          type="button"
          onClick={onMore}
          disabled={!onMore}
          className={cn(
            "text-left text-base font-semibold text-white transition-colors sm:text-lg",
            onMore
              ? "cursor-pointer hover:text-[#BEC8FF] focus:outline-none focus-visible:underline"
              : "cursor-default"
          )}
        >
          {title}
        </button>
        <span className="shrink-0 text-xs font-medium text-[#a0a0a0]">
          {items.length} {items.length === 1 ? "title" : "titles"}
        </span>
      </div>

      {/* Rail container with arrows */}
      <div
        className="relative"
        onMouseLeave={() => {
          /* arrows fade out via CSS group-hover */
        }}
      >
        {/* Left arrow (hover-only, TV-remote friendly) */}
        <RailArrow
          dir="left"
          onClick={() => scrollByDir("left")}
          ariaLabel={`Scroll ${title} left`}
        />
        {/* Right arrow */}
        <RailArrow
          dir="right"
          onClick={() => scrollByDir("right")}
          ariaLabel={`Scroll ${title} right`}
        />

        {/* The horizontal scroller */}
        <div
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          role="listbox"
          aria-label={title}
          className={cn(
            "flex gap-3 overflow-x-auto scroll-smooth px-4 pb-2",
            "snap-x snap-mandatory",
            "no-scrollbar", // we hide the native scrollbar — arrows are the affordance
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/40 focus-visible:ring-inset"
          )}
          style={{ scrollbarWidth: "none" }}
        >
          {items.map((item, idx) => (
            <div
              key={`${item.url}-${idx}`}
              role="option"
              aria-selected="false"
              className="snap-start shrink-0"
              style={{ width: CARD_WIDTH }}
            >
              <PosterCard searchResponse={item} />
            </div>
          ))}

          {/* Trailing pad so the last card can snap to the left edge */}
          <div className="shrink-0" style={{ width: "1px" }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

/** Hover-only arrow button — TV-remote friendly because it's a real <button>. */
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
        // Edge gradient to indicate more content
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
