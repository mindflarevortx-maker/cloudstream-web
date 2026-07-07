'use client';

/**
 * CloudStream Web — PluginCard
 *
 * Mirrors the Android `repository_item_tv.xml` / `provider_list.xml` row:
 *   [icon]  Name              [v 1.2]  [size]              [Install / Switch + Trash]
 *           short description
 *           [lang badge] [tvType chips...]
 *
 * Tap the card body (anywhere that isn't a button) to expand the full
 * description. Tap "Install" to download + register the plugin via the
 * repository store. If already installed, show an enable/disable Switch
 * plus a trash (uninstall) button instead.
 */

import { memo, useState } from "react";
import Image from "next/image";
import {
  Download,
  Trash2,
  ChevronDown,
  Package,
  Loader2,
  Globe,
  AlertCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PluginEntry } from "@/lib/cloudstream/store/repository-store";
import { useToast } from "@/hooks/use-toast";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Convert a byte count to a human-readable KB / MB string. */
function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Friendly label for a TvType string. */
function tvTypeLabel(t: string): string {
  switch (t) {
    case "Movie": return "Movie";
    case "TvSeries": return "Series";
    case "Anime": return "Anime";
    case "AsianDrama": return "Drama";
    case "Documentaries": return "Doc";
    case "Live": return "Live";
    case "Torrent": return "P2P";
    case "NSFW": return "18+";
    case "Music": return "Music";
    case "AudioBook":
    case "Audiobook": return "Audio";
    case "Podcast": return "Pod";
    case "Others": return "Other";
    default: return t;
  }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PluginCardProps {
  /** The plugin entry from the repo's plugins.json. */
  entry: PluginEntry;
  /** Whether the plugin is currently installed (downloaded). */
  installed: boolean;
  /** Whether the installed plugin is enabled (only meaningful if installed). */
  enabled: boolean;
  /** Install / uninstall / toggle callbacks (passed down from the view). */
  onInstall?: (internalName: string) => void | Promise<void>;
  onUninstall?: (internalName: string) => void;
  onToggleEnabled?: (internalName: string, enabled: boolean) => void;
  /** Optional external "installing" flag (e.g. while a network request is in
   *  flight) — when true, the Install button shows a spinner. */
  installing?: boolean;
  /** Visual variant for inline rendering inside a dialog. */
  compact?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function PluginCardImpl({
  entry,
  installed,
  enabled,
  onInstall,
  onUninstall,
  onToggleEnabled,
  installing = false,
  compact = false,
}: PluginCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const size = formatSize(entry.size);
  const versionLabel =
    entry.versionName ?? (entry.version ? `v${entry.version}` : null);
  const desc = entry.description?.trim();
  const hasLongDesc = !!desc && desc.length > 90;

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't toggle expand if the click landed on a button / switch.
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [role='switch'], input")) return;
    if (hasLongDesc) setExpanded((v) => !v);
  };

  const handleInstallClick = () => {
    if (!onInstall) return;
    Promise.resolve(onInstall(entry.internalName)).catch((e) => {
      toast({
        title: "Install failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    });
  };

  const handleUninstallClick = () => {
    if (!onUninstall) return;
    onUninstall(entry.internalName);
    toast({
      title: "Uninstalled",
      description: entry.name,
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (hasLongDesc) setExpanded((v) => !v);
        }
      }}
      aria-expanded={hasLongDesc ? expanded : undefined}
      aria-label={`Plugin ${entry.name}${installed ? " (installed)" : ""}`}
      className={cn(
        "group relative flex gap-3 rounded-lg border border-[#3d3d3d] bg-[#2d2d2d] p-3",
        "transition-all hover:border-[#7664ed]/40 hover:bg-[#333]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
        compact ? "" : "sm:p-4"
      )}
    >
      {/* Icon (left) */}
      <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-[#1e1e1e] ring-1 ring-[#3d3d3d] sm:size-14">
        {entry.iconUrl && !imgError ? (
          <Image
            src={entry.iconUrl}
            alt={`${entry.name} icon`}
            fill
            sizes="56px"
            className="object-cover"
            unoptimized
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="size-6 text-[#7664ed]" />
          </div>
        )}
      </div>

      {/* Body (center) */}
      <div className="min-w-0 flex-1">
        {/* Row 1: name + version + size */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              className="truncate text-sm font-semibold text-white sm:text-base"
              title={entry.name}
            >
              {entry.name}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#a0a0a0]">
              {versionLabel && (
                <span className="font-medium text-[#BEC8FF]">{versionLabel}</span>
              )}
              {entry.authors && entry.authors.length > 0 && (
                <span className="truncate">· {entry.authors.join(", ")}</span>
              )}
            </div>
          </div>
          {/* Right-side meta: size + expand chevron */}
          <div className="flex shrink-0 items-center gap-1.5">
            {size && (
              <span className="rounded bg-[#1e1e1e] px-1.5 py-0.5 text-[10px] font-medium text-[#a0a0a0]">
                {size}
              </span>
            )}
            {hasLongDesc && (
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-[#a0a0a0] transition-transform",
                  expanded && "rotate-180"
                )}
              />
            )}
          </div>
        </div>

        {/* Row 2: description (clamped unless expanded) */}
        {desc && (
          <p
            className={cn(
              "mt-1.5 text-xs leading-relaxed text-[#a0a0a0]",
              expanded ? "whitespace-pre-wrap" : "line-clamp-2"
            )}
          >
            {desc}
          </p>
        )}

        {/* Row 3: badges — language + tvTypes + status */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {entry.language && (
            <Badge
              variant="secondary"
              className="gap-1 bg-[#1e1e1e] text-[10px] font-medium uppercase text-[#a0a0a0] hover:bg-[#1e1e1e]"
            >
              <Globe className="size-2.5" />
              {entry.language}
            </Badge>
          )}
          {(entry.tvTypes ?? []).map((t) => (
            <Badge
              key={t}
              variant="outline"
              className="border-[#3d3d3d] bg-[#1e1e1e]/60 text-[10px] font-medium text-[#BEC8FF]"
            >
              {tvTypeLabel(t)}
            </Badge>
          ))}
          {installed && !enabled && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] font-medium text-amber-300"
            >
              <AlertCircle className="size-2.5" />
              Disabled
            </Badge>
          )}
          {installed && enabled && (
            <Badge
              variant="outline"
              className="border-[#7664ed]/40 bg-[#7664ed]/10 text-[10px] font-medium text-[#BEC8FF]"
            >
              Installed
            </Badge>
          )}
        </div>
      </div>

      {/* Action buttons (right) */}
      <div className="flex shrink-0 flex-col items-end justify-center gap-2">
        {!installed ? (
          <Button
            type="button"
            size="sm"
            disabled={installing}
            onClick={handleInstallClick}
            className="gap-1.5 bg-[#7664ed] text-xs hover:bg-[#7664ed]/90"
            aria-label={`Install ${entry.name}`}
          >
            {installing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Install
          </Button>
        ) : (
          <>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => onToggleEnabled?.(entry.internalName, v)}
              aria-label={`Toggle ${entry.name}`}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-[#a0a0a0] hover:bg-red-500/10 hover:text-red-400"
              onClick={handleUninstallClick}
              aria-label={`Uninstall ${entry.name}`}
              title="Uninstall"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export const PluginCard = memo(PluginCardImpl);
