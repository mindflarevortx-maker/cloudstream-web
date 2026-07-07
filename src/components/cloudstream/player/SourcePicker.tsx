'use client';

/**
 * SourcePicker — bottom-sheet that lists every ExtractorLink for the current
 * playing episode, lets the user switch the active source, and shows the
 * currently-selected one.
 *
 * Mirrors the Android `player_select_source_and_subtitle` dialog (worklog
 * Task D3 — `FullScreenPlayer.kt` opens it from the "Sources" button in the
 * bottom bar). The Android version sorts by `QualityDataHelper` priority; we
 * approximate by parsing quality labels ("1080p" > "720p" > … > "Unknown").
 *
 * Type detection:
 *   - link.isM3u8 === true  → M3U8 badge (HLS.js)
 *   - link.isDash === true  → DASH badge (native fallback, see PlayerView)
 *   - link.type === ExtractorLinkType.Torrent → Torrent badge
 *   - link.url ends with .mpd → DASH
 *   - link.url ends with .torrent or magnet: → Torrent
 *   - everything else → MP4 (native HTML5 video)
 *
 * Click → `onSelect(link)` is called and the sheet closes.
 */

import { useMemo } from "react";
import { Check, FileVideo, Layers, Magnet, Radio, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ExtractorLink,
  ExtractorLinkType,
} from "@/lib/cloudstream/types";

export interface SourcePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: ExtractorLink[];
  selectedUrl: string | null;
  onSelect: (link: ExtractorLink) => void;
}

/** Tag describing how the player will treat a given link. */
export type SourceKind = "M3U8" | "MP4" | "DASH" | "Torrent";

export function detectSourceKind(link: ExtractorLink): SourceKind {
  if (link.isM3u8) return "M3U8";
  if (link.isDash) return "DASH";
  if (link.type === ExtractorLinkType.Torrent) return "Torrent";
  if (link.type === ExtractorLinkType.Magnet) return "Torrent";
  const url = link.url ?? "";
  if (url.includes(".mpd")) return "DASH";
  if (url.startsWith("magnet:") || url.endsWith(".torrent")) return "Torrent";
  if (url.includes(".m3u8")) return "M3U8";
  return "MP4";
}

/** Parse a quality label like "1080p", "720p", "4K" → a numeric priority. */
function qualityPriority(quality: string | undefined): number {
  if (!quality) return 0;
  const q = quality.toLowerCase();
  // 4K / 2160p first
  if (q.includes("4k") || q.includes("2160")) return 2160;
  if (q.includes("1440")) return 1440;
  if (q.includes("1080")) return 1080;
  if (q.includes("720")) return 720;
  if (q.includes("540")) return 540;
  if (q.includes("480")) return 480;
  if (q.includes("360")) return 360;
  if (q.includes("auto") || q.includes("default")) return 1;
  return 0;
}

const KIND_COLORS: Record<SourceKind, string> = {
  M3U8: "bg-[#7664ed]/20 text-[#BEC8FF] border-[#7664ed]/40",
  MP4: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  DASH: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Torrent: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const KIND_ICONS: Record<SourceKind, React.ReactNode> = {
  M3U8: <Radio className="size-3.5" />,
  MP4: <FileVideo className="size-3.5" />,
  DASH: <Layers className="size-3.5" />,
  Torrent: <Magnet className="size-3.5" />,
};

export function SourcePicker({
  open,
  onOpenChange,
  links,
  selectedUrl,
  onSelect,
}: SourcePickerProps) {
  const sorted = useMemo(() => {
    return [...links].sort((a, b) => {
      const pa = qualityPriority(a.quality);
      const pb = qualityPriority(b.quality);
      if (pa !== pb) return pb - pa; // higher quality first
      // Stable tiebreaker: source name
      return (a.source ?? a.name).localeCompare(b.source ?? b.name);
    });
  }, [links]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "border-[#3d3d3d] bg-[#1e1e1e] text-white",
          "max-h-[80vh] p-0"
        )}
      >
        <SheetHeader className="border-b border-[#3d3d3d] p-4">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold text-white">
            <Zap className="size-4 text-[#7664ed]" />
            Select source
          </SheetTitle>
          <SheetDescription className="text-xs text-[#a0a0a0]">
            {sorted.length} source{sorted.length === 1 ? "" : "s"} available ·
            sorted by quality
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="max-h-[60vh]">
          <ul className="divide-y divide-[#2d2d2d]">
            {sorted.length === 0 && (
              <li className="p-6 text-center text-sm text-[#a0a0a0]">
                No sources available for this episode.
              </li>
            )}
            {sorted.map((link) => {
              const kind = detectSourceKind(link);
              const isSelected = link.url === selectedUrl;
              return (
                <li key={`${link.url}-${link.name}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(link)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left",
                      "transition-colors hover:bg-[#2d2d2d]",
                      isSelected && "bg-[#7664ed]/10"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        KIND_COLORS[kind]
                      )}
                    >
                      {KIND_ICONS[kind]}
                      {kind}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate text-sm font-medium",
                            isSelected ? "text-[#BEC8FF]" : "text-white"
                          )}
                        >
                          {link.source ?? link.name}
                        </span>
                        <span className="shrink-0 rounded bg-[#2d2d2d] px-1.5 py-0.5 text-[10px] font-semibold text-[#a0a0a0]">
                          {link.quality ?? "Unknown"}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-[#777]">
                        {link.url}
                      </p>
                    </div>

                    {isSelected && (
                      <Check className="size-4 shrink-0 text-[#7664ed]" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
