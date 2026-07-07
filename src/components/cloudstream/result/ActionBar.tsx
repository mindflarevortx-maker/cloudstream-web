'use client';

import { useState } from "react";
import {
  Play,
  Bookmark,
  BookmarkCheck,
  Bell,
  BellRing,
  Share2,
  Film,
  Check,
  Copy,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import { useToast } from "@/hooks/use-toast";
import type { LoadResponse, SearchResponse, Episode } from "@/lib/cloudstream/types";

/**
 * ActionBar — the row of primary action buttons on the Result page.
 *
 * Layout (left → right, wraps on narrow screens):
 *   [Play]  [Bookmark]  [Subscribe]  [Trailer]  [Share]
 *
 * Behavior:
 *   - Play: triggers `onPlay()`. For movies this calls loadLinks on the
 *     LoadResponse.dataUrl; for series the parent passes a callback that
 *     picks the first episode (or the next-unwatched one).
 *   - Bookmark: toggles `useAppStore.toggleBookmark`. Reflects current
 *     state via `isBookmarked(url)`.
 *   - Subscribe: toggles `useAppStore.toggleSubscription`. Same pattern.
 *   - Trailer: only shown if `loadResponse.trailers` is non-empty. Opens
 *     a modal `<iframe>` player pointing at the (YouTube) trailer URL.
 *   - Share: writes `window.location.href` to the clipboard.
 *
 * Mirrors the Android `result_play_button.xml` + `result_bookmark_button.xml`
 * + `result_subscribe_button.xml` + `result_trailer_button.xml` row.
 */

export interface ActionBarProps {
  loadResponse: LoadResponse;
  /** Called when the user clicks Play (parent decides which episode). */
  onPlay: (episode: Episode | null) => void;
  /** Disable + show spinner on Play while the parent is loading links. */
  isPlayLoading?: boolean;
}

export function ActionBar({
  loadResponse,
  onPlay,
  isPlayLoading = false,
}: ActionBarProps) {
  const toggleBookmark = useAppStore((s) => s.toggleBookmark);
  const isBookmarked = useAppStore((s) => s.isBookmarked);
  const toggleSubscription = useAppStore((s) => s.toggleSubscription);
  const isSubscribed = useAppStore((s) => s.isSubscribed);
  const { toast } = useToast();

  const [trailerOpen, setTrailerOpen] = useState(false);

  // Build a minimal SearchResponse-shaped object so the bookmark/subscription
  // stores can render it later in the Library view.
  const asSearchResponse: SearchResponse = {
    name: loadResponse.name,
    url: loadResponse.url,
    apiName: loadResponse.apiName,
    type: loadResponse.type,
    posterUrl: loadResponse.posterUrl,
    backgroundUrl: loadResponse.backgroundUrl,
  };

  const bookmarked = isBookmarked(loadResponse.url);
  const subscribed = isSubscribed(loadResponse.url);
  const trailers = loadResponse.trailers ?? [];
  const hasTrailer = trailers.length > 0;

  const handleShare = async () => {
    const shareUrl =
      typeof window !== "undefined" ? window.location.href : loadResponse.url;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link copied",
        description: "Paste it anywhere to share this title.",
      });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Play (primary) */}
      <motion.button
        type="button"
        onClick={() => onPlay(null)}
        disabled={isPlayLoading}
        whileHover={{ scale: isPlayLoading ? 1 : 1.03 }}
        whileTap={{ scale: isPlayLoading ? 1 : 0.97 }}
        className={cn(
          "flex min-h-[44px] items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold",
          "bg-[#7664ed] text-white shadow-lg shadow-[#7664ed]/30",
          "transition-colors hover:bg-[#8774f0]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e1e]",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
        aria-label="Play"
      >
        {isPlayLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Play className="size-5 translate-x-0.5 fill-white" />
        )}
        <span>{isPlayLoading ? "Loading…" : "Play"}</span>
      </motion.button>

      {/* Bookmark (toggle) */}
      <ActionButton
        active={bookmarked}
        onClick={() => {
          toggleBookmark(asSearchResponse);
          toast({
            title: bookmarked ? "Removed from bookmarks" : "Bookmarked",
            description: loadResponse.name,
          });
        }}
        label={bookmarked ? "Bookmarked" : "Bookmark"}
        icon={
          bookmarked ? (
            <BookmarkCheck className="size-5" />
          ) : (
            <Bookmark className="size-5" />
          )
        }
      />

      {/* Subscribe (toggle) */}
      <ActionButton
        active={subscribed}
        onClick={() => {
          toggleSubscription(asSearchResponse);
          toast({
            title: subscribed ? "Unsubscribed" : "Subscribed",
            description: subscribed
              ? "You won't get new-episode notifications."
              : "We'll notify you when new episodes arrive.",
          });
        }}
        label={subscribed ? "Subscribed" : "Subscribe"}
        icon={
          subscribed ? <BellRing className="size-5" /> : <Bell className="size-5" />
        }
      />

      {/* Trailer (only if available) */}
      {hasTrailer && (
        <ActionButton
          active={false}
          onClick={() => setTrailerOpen(true)}
          label="Trailer"
          icon={<Film className="size-5" />}
        />
      )}

      {/* Share */}
      <ActionButton
        active={false}
        onClick={handleShare}
        label="Share"
        icon={<Share2 className="size-5" />}
      />

      {trailerOpen && hasTrailer && (
        <TrailerModal
          url={trailers[0]}
          title={loadResponse.name}
          onClose={() => setTrailerOpen(false)}
        />
      )}
    </div>
  );
}

// ---- subcomponents ---------------------------------------------------------

interface ActionButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}

function ActionButton({ active, onClick, label, icon }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[44px] items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium",
        "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e1e]",
        active
          ? "border-[#7664ed]/60 bg-[#7664ed]/15 text-[#BEC8FF]"
          : "border-[#3d3d3d] bg-[#2d2d2d] text-white hover:border-[#7664ed]/40 hover:bg-[#333]"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * TrailerModal — a simple modal that embeds a YouTube trailer via iframe.
 * Mirrors the Android `TrailerListener` flow that opens the trailer in a
 * separate player activity.
 */
function TrailerModal({
  url,
  title,
  onClose,
}: {
  url: string;
  title: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const embedUrl = toYouTubeEmbed(url);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "Couldn't copy",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Trailer for ${title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-lg border border-[#3d3d3d] bg-[#1e1e1e] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#3d3d3d] px-4 py-3">
          <h3 className="truncate text-sm font-semibold text-white">
            Trailer · {title}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-2.5 py-1 text-xs text-white hover:border-[#7664ed]/40"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-green-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" /> Copy URL
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-2.5 py-1 text-xs text-white hover:border-[#F53B66]/40 hover:text-[#F53B66]"
              aria-label="Close trailer"
            >
              Close
            </button>
          </div>
        </div>
        <div className="relative aspect-video w-full bg-black">
          {embedUrl ? (
            <iframe
              src={embedUrl}
              title={`Trailer for ${title}`}
              className="absolute inset-0 size-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
              <Film className="size-8 text-[#a0a0a0]" />
              <p className="text-sm text-[#a0a0a0]">
                Couldn&apos;t embed this trailer URL.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[#7664ed] hover:underline"
              >
                Open in new tab →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Convert a YouTube watch URL to its /embed/ form. Returns null for non-YouTube URLs. */
function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      if (u.pathname.startsWith("/embed/")) return url;
    }
    return null;
  } catch {
    return null;
  }
}
