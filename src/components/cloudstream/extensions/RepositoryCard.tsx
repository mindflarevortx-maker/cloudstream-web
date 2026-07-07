'use client';

/**
 * CloudStream Web — RepositoryCard
 *
 * Mirrors the Android `repository_item.xml` / `repository_item_tv.xml` row:
 *   [GitHub icon]  Repo Name        [plugin count badge]   [trash button]
 *                  https://example.com/repo.json
 *
 * Tapping the card body opens a details view (handled by the parent — we
 * call `onOpen(url)`). Tapping the trash button calls `onRemove(url)`.
 */

import { memo, useState } from "react";
import { Github, Trash2, ChevronRight, Package } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Repository } from "@/lib/cloudstream/store/repository-store";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface RepositoryCardProps {
  repo: Repository;
  /** Number of plugins from this repo that the user has installed. */
  installedCount?: number;
  /** Open the repo's plugin list. */
  onOpen?: (url: string) => void;
  /** Remove the repo (and all its installed plugins). */
  onRemove?: (url: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function RepositoryCardImpl({
  repo,
  installedCount = 0,
  onOpen,
  onRemove,
}: RepositoryCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleCardClick = () => {
    onOpen?.(repo.url);
  };

  const handleRemove = () => {
    onRemove?.(repo.url);
    setConfirmOpen(false);
  };

  // Derive a host label for the GitHub-icon badge.
  let hostLabel = "repo";
  try {
    hostLabel = new URL(repo.url).hostname;
  } catch {
    /* keep default */
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
      aria-label={`Open repository ${repo.name}`}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-[#3d3d3d] bg-[#2d2d2d] p-3 sm:p-4",
        "cursor-pointer transition-all hover:border-[#7664ed]/40 hover:bg-[#333]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
      )}
    >
      {/* GitHub icon (left) */}
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e] ring-1 ring-[#3d3d3d] sm:size-12">
        <Github className="size-5 text-white sm:size-6" />
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3
            className="truncate text-sm font-semibold text-white sm:text-base"
            title={repo.name}
          >
            {repo.name}
          </h3>
          <ChevronRight
            className="size-4 shrink-0 text-[#a0a0a0] transition-transform group-hover:translate-x-0.5"
          />
        </div>
        <a
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 block truncate text-[11px] text-[#BEC8FF] hover:underline sm:text-xs"
          title={repo.url}
        >
          {repo.url}
        </a>
        {repo.description && (
          <p className="mt-1 line-clamp-1 text-[11px] text-[#a0a0a0]">
            {repo.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[#a0a0a0]">
          <Badge
            variant="outline"
            className="gap-1 border-[#3d3d3d] bg-[#1e1e1e]/60 text-[10px] font-medium text-[#a0a0a0]"
          >
            <Package className="size-2.5" />
            {repo.plugins.length} plugin{repo.plugins.length === 1 ? "" : "s"}
          </Badge>
          {installedCount > 0 && (
            <Badge
              variant="outline"
              className="border-[#7664ed]/40 bg-[#7664ed]/10 text-[10px] font-medium text-[#BEC8FF]"
            >
              {installedCount} installed
            </Badge>
          )}
          <span className="truncate text-[10px] uppercase text-[#a0a0a0]/70">
            {hostLabel}
          </span>
        </div>
      </div>

      {/* Trash (right) — wrapped in an AlertDialog for confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-[#a0a0a0] hover:bg-red-500/10 hover:text-red-400"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Remove repository ${repo.name}`}
            title="Remove repository"
          >
            <Trash2 className="size-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          className="border-[#3d3d3d] bg-[#2d2d2d] text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Remove repository?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#a0a0a0]">
              This will remove <span className="font-semibold text-white">{repo.name}</span> and
              uninstall all {installedCount > 0
                ? `${installedCount} plugin${installedCount === 1 ? "" : "s"} from it`
                : "plugins from it"}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#3d3d3d] bg-transparent text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const RepositoryCard = memo(RepositoryCardImpl);
