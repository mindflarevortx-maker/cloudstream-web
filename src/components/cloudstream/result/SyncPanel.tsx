'use client';

import { useEffect, useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Star,
  Loader2,
  Check,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { LoadResponse } from "@/lib/cloudstream/types";
import {
  SyncRegistry,
  SyncAPI,
  resolveSyncId,
  SYNC_STATUS_OPTIONS,
  type SyncStatus,
} from "@/lib/cloudstore/sync-api";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

/**
 * SyncPanel — the collapsible sync-status panel on the Result page.
 *
 * Mirrors the Android `SyncViewModel` + `result_sync.xml` flow. For every
 * logged-in sync provider (from `SyncRegistry.getLoggedIn()`):
 *   - Read the user's current watch status via `provider.status(syncId)`.
 *   - Render a card with: status dropdown, episode progress (current/max
 *     with +/- buttons), and a score slider (0-10) + "Set Score" button.
 *   - On any change, call `provider.updateStatus(syncId, ...)` and reflect
 *     the optimistic update in the UI.
 *
 * The `syncId` is resolved from `loadResponse.syncData[provider.id]`,
 * falling back to `loadResponse.url` (which is what LocalListSyncAPI uses
 * as its key).
 *
 * If no sync provider is logged in, the panel renders an empty state
 * prompting the user to enable sync in Settings.
 */

export interface SyncPanelProps {
  loadResponse: LoadResponse;
  /** Max episodes (for the +/- buttons' upper bound). Optional. */
  maxEpisodes?: number;
}

export function SyncPanel({ loadResponse, maxEpisodes }: SyncPanelProps) {
  const [open, setOpen] = useState(false);
  const providers = SyncRegistry.getLoggedIn();

  return (
    <section
      className="overflow-hidden rounded-lg border border-[#3d3d3d] bg-[#2d2d2d]/40"
      aria-label="Sync status"
    >
      {/* Header (collapsible toggle) */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[#333]/60"
      >
        {open ? (
          <ChevronDown className="size-4 text-[#a0a0a0]" />
        ) : (
          <ChevronRight className="size-4 text-[#a0a0a0]" />
        )}
        <h2 className="text-sm font-semibold text-white sm:text-base">Sync Status</h2>
        {providers.length > 0 && (
          <span className="ml-1 rounded-full bg-[#7664ed]/20 px-2 py-0.5 text-[10px] font-medium text-[#BEC8FF]">
            {providers.length} {providers.length === 1 ? "provider" : "providers"}
          </span>
        )}
        <span className="ml-auto text-xs text-[#a0a0a0]">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden border-t border-[#3d3d3d]"
          >
            {providers.length === 0 ? (
              <EmptySyncState />
            ) : (
              <div className="space-y-3 p-4">
                {providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    loadResponse={loadResponse}
                    maxEpisodes={maxEpisodes}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ProviderCard — one row per sync provider.
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: SyncAPI;
  loadResponse: LoadResponse;
  maxEpisodes?: number;
}

function ProviderCard({ provider, loadResponse, maxEpisodes }: ProviderCardProps) {
  const { toast } = useToast();

  const syncId = resolveSyncId(
    loadResponse.syncData,
    provider.id,
    loadResponse.url
  );

  // Local state — initialized from `provider.status()` on mount.
  const [status, setStatus] = useState<SyncStatus | "None">("None");
  const [watched, setWatched] = useState<number>(0);
  const [maxEps, setMaxEps] = useState<number>(maxEpisodes ?? 0);
  const [score, setScore] = useState<number>(0);
  const [scoreDraft, setScoreDraft] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scoreDirty, setScoreDirty] = useState(false);

  // ---- Initial load ------------------------------------------------------
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await provider.status(syncId);
      if (s) {
        setStatus((s.status as SyncStatus) ?? "None");
        setWatched(s.watchedEpisodes ?? 0);
        if (s.maxEpisodes != null) setMaxEps(s.maxEpisodes);
        if (s.score != null) {
          setScore(s.score);
          setScoreDraft(s.score);
        }
      } else {
        setStatus("None");
        setWatched(0);
        setScore(0);
        setScoreDraft(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read status");
    } finally {
      setLoading(false);
    }
  }, [provider, syncId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ---- Mutations ---------------------------------------------------------
  const persist = useCallback(
    async (patch: Parameters<typeof provider.updateStatus>[1]) => {
      setSaving(true);
      try {
        const ok = await provider.updateStatus(syncId, patch);
        if (!ok) throw new Error("Provider returned false");
        return ok;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
        toast({
          title: "Sync update failed",
          description: `${provider.name}: ${e instanceof Error ? e.message : "unknown error"}`,
          variant: "destructive",
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [provider, syncId, toast]
  );

  const handleStatusChange = async (newStatus: SyncStatus) => {
    setStatus(newStatus);
    await persist({ status: newStatus });
  };

  const handleEpisodeDelta = async (delta: number) => {
    const next = Math.max(0, Math.min(maxEps || 9999, watched + delta));
    setWatched(next);
    await persist({ watchedEpisodes: next });
  };

  const handleScoreCommit = async () => {
    setScore(scoreDraft);
    setScoreDirty(false);
    const ok = await provider.score(syncId, scoreDraft);
    if (ok) {
      toast({
        title: "Score saved",
        description: `${provider.name}: ${scoreDraft.toFixed(1)} / 10`,
      });
    }
  };

  // ---- Render ------------------------------------------------------------
  return (
    <div className="rounded-md border border-[#3d3d3d] bg-[#1e1e1e]/60 p-3 sm:p-4">
      {/* Header row */}
      <div className="mb-3 flex items-center gap-2">
        <ProviderIcon provider={provider} />
        <span className="text-sm font-semibold text-white">{provider.name}</span>
        <span className="rounded-full bg-[#7664ed]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#BEC8FF]">
          Connected
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex size-7 items-center justify-center rounded-md text-[#a0a0a0] hover:bg-white/5 hover:text-white disabled:opacity-50"
            aria-label="Refresh sync status"
            title="Refresh"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-[#F53B66]/30 bg-[#F53B66]/10 px-3 py-2 text-xs text-[#F53B66]">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-[#a0a0a0]">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {/* Status row */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#a0a0a0]">
                Status
              </label>
              <Select
                value={status}
                onValueChange={(v) => void handleStatusChange(v as SyncStatus)}
              >
                <SelectTrigger
                  className="h-9 w-full border-[#3d3d3d] bg-[#2d2d2d] text-sm text-white hover:border-[#7664ed]/50"
                  disabled={saving}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[#3d3d3d] bg-[#2d2d2d] text-white">
                  <SelectItem value="None">—</SelectItem>
                  {SYNC_STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Episode progress row */}
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#a0a0a0]">
                Episodes watched
              </label>
              <div className="flex h-9 items-center gap-2 rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-2">
                <button
                  type="button"
                  onClick={() => void handleEpisodeDelta(-1)}
                  disabled={saving || watched <= 0}
                  className="flex size-7 items-center justify-center rounded text-white hover:bg-[#7664ed]/20 disabled:opacity-40"
                  aria-label="Decrease watched episodes"
                >
                  <Minus className="size-4" />
                </button>
                <span className="flex-1 text-center text-sm font-medium text-white">
                  {watched}
                  {maxEps > 0 && (
                    <span className="text-[#a0a0a0]"> / {maxEps}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void handleEpisodeDelta(1)}
                  disabled={saving || (maxEps > 0 && watched >= maxEps)}
                  className="flex size-7 items-center justify-center rounded text-white hover:bg-[#7664ed]/20 disabled:opacity-40"
                  aria-label="Increase watched episodes"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Score row */}
          <div>
            <label className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-[#a0a0a0]">
              <span>Score</span>
              <span className="flex items-center gap-1 normal-case tracking-normal text-[#FFC107]">
                <Star className="size-3 fill-current" />
                <span className="text-sm font-semibold">
                  {scoreDraft.toFixed(1)}
                </span>
                <span className="text-xs text-[#a0a0a0]">/ 10</span>
              </span>
            </label>
            <div className="flex items-center gap-3">
              <Slider
                value={[scoreDraft]}
                min={0}
                max={10}
                step={0.1}
                onValueChange={(v) => {
                  setScoreDraft(v[0]);
                  setScoreDirty(Math.abs(v[0] - score) > 0.05);
                }}
                disabled={saving}
                aria-label="Score slider"
                className="flex-1 [&_[role=slider]]:border-[#7664ed] [&_[role=slider]]:bg-[#7664ed] [&_[role=slider]]:ring-[#7664ed]/40"
              />
              <button
                type="button"
                onClick={() => void handleScoreCommit()}
                disabled={!scoreDirty || saving}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                  "transition-colors",
                  scoreDirty && !saving
                    ? "bg-[#7664ed] text-white hover:bg-[#8774f0]"
                    : "border border-[#3d3d3d] bg-[#2d2d2d] text-[#a0a0a0] cursor-not-allowed"
                )}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : scoreDirty ? (
                  <Check className="size-3.5" />
                ) : null}
                Set Score
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A small circular icon for a sync provider. Falls back to a letter avatar. */
function ProviderIcon({ provider }: { provider: SyncAPI }) {
  const letter = provider.name.charAt(0).toUpperCase();
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7664ed] to-[#5a48c0] text-xs font-bold text-white ring-1 ring-white/10"
      aria-hidden="true"
    >
      {provider.iconUrl ? (
        <img
          src={provider.iconUrl}
          alt=""
          className="size-full rounded-full object-cover"
        />
      ) : (
        letter
      )}
    </span>
  );
}

function EmptySyncState() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
        <AlertCircle className="size-6 text-[#a0a0a0]" />
      </div>
      <p className="text-sm font-medium text-white">No sync providers connected</p>
      <p className="max-w-sm text-xs text-[#a0a0a0]">
        Connect AniList, MyAnimeList, or another sync provider in Settings to
        track your progress here. Your local list is always available but
        won&apos;t sync across devices.
      </p>
    </div>
  );
}
