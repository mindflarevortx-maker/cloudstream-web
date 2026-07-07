'use client';

/**
 * SubtitlePicker — bottom-sheet that lists every SubtitleFile attached to the
 * current playing episode. Picking one adds a `<track>` to the video element
 * and enables it; the "Off" option at the top clears subtitles.
 *
 * Mirrors the Android `PlayerSubtitleHelper` flow (worklog Task D3 —
 * `PlayerSubtitleHelper.kt` 144 lines + `CustomSubtitleDecoderFactory.kt`).
 * The web player uses native VTT `<track>` elements rather than the custom
 * decoder path; SRT/SRT-style subs are loaded as `kind="subtitles"` and the
 * browser will auto-convert if the format is VTT-compatible (most are not —
 * we recommend the API returns VTT for web playback).
 */

import { useMemo } from "react";
import { Captions, Check, Globe2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SubtitleFile } from "@/lib/cloudstream/types";

export interface SubtitlePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitles: SubtitleFile[];
  /** URL of the currently-active subtitle track, or null for "Off". */
  selectedUrl: string | null;
  onSelect: (sub: SubtitleFile | null) => void;
}

const FORMAT_BADGES: Record<string, string> = {
  vtt: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  srt: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ssa: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  ass: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  ttml: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

function detectFormat(sub: SubtitleFile): string {
  if (sub.format) return sub.format.toLowerCase();
  const url = sub.url.toLowerCase();
  if (url.endsWith(".vtt")) return "vtt";
  if (url.endsWith(".srt")) return "srt";
  if (url.endsWith(".ssa") || url.endsWith(".ass")) return "ssa";
  if (url.endsWith(".ttml") || url.endsWith(".xml")) return "ttml";
  return "vtt";
}

export function SubtitlePicker({
  open,
  onOpenChange,
  subtitles,
  selectedUrl,
  onSelect,
}: SubtitlePickerProps) {
  const sorted = useMemo(() => {
    return [...subtitles].sort((a, b) => {
      const la = (a.language ?? a.name ?? "").toLowerCase();
      const lb = (b.language ?? b.name ?? "").toLowerCase();
      // English first, then alphabetical
      if (la.startsWith("en") && !lb.startsWith("en")) return -1;
      if (!la.startsWith("en") && lb.startsWith("en")) return 1;
      return la.localeCompare(lb);
    });
  }, [subtitles]);

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
            <Captions className="size-4 text-[#7664ed]" />
            Subtitles
          </SheetTitle>
          <SheetDescription className="text-xs text-[#a0a0a0]">
            {subtitles.length} track{subtitles.length === 1 ? "" : "s"} available
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="max-h-[60vh]">
          <ul className="divide-y divide-[#2d2d2d]">
            {/* "Off" row */}
            <li>
              <button
                type="button"
                onClick={() => onSelect(null)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left",
                  "transition-colors hover:bg-[#2d2d2d]",
                  selectedUrl === null && "bg-[#7664ed]/10"
                )}
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-[#2d2d2d] text-xs font-bold text-[#a0a0a0]">
                  OFF
                </span>
                <span
                  className={cn(
                    "flex-1 text-sm font-medium",
                    selectedUrl === null ? "text-[#BEC8FF]" : "text-white"
                  )}
                >
                  Off
                </span>
                {selectedUrl === null && (
                  <Check className="size-4 text-[#7664ed]" />
                )}
              </button>
            </li>

            {sorted.length === 0 && (
              <li className="p-6 text-center text-sm text-[#a0a0a0]">
                No subtitles available for this episode.
              </li>
            )}

            {sorted.map((sub) => {
              const isSelected = sub.url === selectedUrl;
              const fmt = detectFormat(sub);
              return (
                <li key={sub.url}>
                  <button
                    type="button"
                    onClick={() => onSelect(sub)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left",
                      "transition-colors hover:bg-[#2d2d2d]",
                      isSelected && "bg-[#7664ed]/10"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        FORMAT_BADGES[fmt] ??
                          "bg-[#2d2d2d] text-[#a0a0a0] border-[#3d3d3d]"
                      )}
                    >
                      {fmt}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "truncate text-sm font-medium",
                          isSelected ? "text-[#BEC8FF]" : "text-white"
                        )}
                      >
                        {sub.name}
                      </div>
                      {sub.language && (
                        <div className="flex items-center gap-1 text-[11px] text-[#777]">
                          <Globe2 className="size-3" />
                          <span className="truncate">{sub.language}</span>
                        </div>
                      )}
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
