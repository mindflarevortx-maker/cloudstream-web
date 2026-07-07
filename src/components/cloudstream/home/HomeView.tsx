'use client';

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  AlertCircle,
  Inbox,
  WifiOff,
  Plus,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { APIHolder } from "@/lib/cloudstream/MainAPI";
import { HomePageList, SearchResponse } from "@/lib/cloudstream/types";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import { HomeRail } from "./HomeRail";
import { HeroCarousel } from "./HeroCarousel";
import { ContinueWatchingRail } from "./ContinueWatchingRail";
import { ProviderSwitcher } from "../common/ProviderSwitcher";
import {
  HomeSkeleton,
  InlineSpinner,
} from "../common/Loading";

/**
 * HomeView — the CloudStream home page (rebuilt to mirror the Android
 * `HomeFragment` screenshot layout).
 *
 * Layout (top → bottom):
 *   1. HeroCarousel        — featured titles (auto-rotating). Built from the
 *                            first 5–8 items of the first rail, shuffled so
 *                            the same provider's rails don't always start
 *                            with the same hero.
 *   2. Sticky switcher bar — the ProviderSwitcher button (top-right, sticks
 *                            below the global TopNav as the user scrolls).
 *   3. ContinueWatchingRail — only if `watchHistory` is non-empty.
 *   4. HomeRails           — one per HomePageList returned by the selected
 *                            provider's getMainPage (or, for "all", merged
 *                            across every enabled provider).
 *
 * State branches:
 *   - loading → skeleton hero + skeleton rails
 *   - error   → retry button
 *   - empty   → either "no providers registered" (CTA: open Settings) or
 *               "provider returned no rails" (CTA: switch provider)
 *
 * Data fetching uses TanStack Query keyed on `settings.defaultProvider` so
 * picking a new provider from the switcher automatically refetches. Each
 * provider's `getMainPage` runs in parallel via `Promise.allSettled` so one
 * broken provider can't break the whole home page.
 */

/** Merged rail type — name is suffixed with the provider name to disambiguate
 *  when "all" providers are merged into one home page. */
interface MergedRail extends HomePageList {
  providerName: string;
}

/** Dedupe within a single rail by URL (preserving first occurrence). */
function dedupe(items: HomePageList["list"]): HomePageList["list"] {
  const seen = new Set<string>();
  const out: HomePageList["list"] = [];
  for (const it of items) {
    if (it.url && !seen.has(it.url)) {
      seen.add(it.url);
      out.push(it);
    }
  }
  return out;
}

/** Deterministic shuffle (Fisher–Yates on a seeded RNG) so the hero set is
 *  stable across re-renders but varies per provider/rail combo. */
function seededShuffle<T>(input: T[], seed: string): T[] {
  if (input.length <= 1) return [...input];
  // Build a numeric seed from the string.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // mulberry32 PRNG
  let a = h >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The actual data fetcher — used as the TanStack Query `queryFn`. */
async function fetchHomeRails(providerSetting: string): Promise<MergedRail[]> {
  const all = APIHolder.getEnabledProviders();
  if (all.length === 0) {
    return [];
  }

  // Resolve which providers to actually query.
  const targets =
    providerSetting === "all"
      ? all
      : all.filter((p) => p.name === providerSetting);

  // If the user picked a specific provider that isn't registered, fall back
  // to "all" so they still see something.
  const effective = targets.length > 0 ? targets : all;

  // Fire all getMainPage calls in parallel. Promise.allSettled means a single
  // failing provider doesn't break the home page.
  const settled = await Promise.allSettled(
    effective.map(async (p) => {
      // Skip providers that don't implement getMainPage.
      if (!p.hasMainPage) {
        return { provider: p, lists: [] as HomePageList[] };
      }
      const resp = await p.getMainPage(1, null);
      return { provider: p, lists: resp?.items ?? [] };
    })
  );

  const merged: MergedRail[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const { provider, lists } = r.value;
    for (const list of lists) {
      const clean = dedupe(list.list ?? []);
      if (clean.length === 0) continue;
      merged.push({
        name: list.name,
        list: clean,
        hasNext: list.hasNext,
        providerName: provider.name,
      });
    }
  }

  return merged;
}

/** Build the hero featured list — up to 8 items, shuffled, drawn from the
 *  first rail that has enough content. Falls back to the merged first-N of
 *  every rail if the first rail is too short. */
function buildFeatured(rails: MergedRail[]): SearchResponse[] {
  if (rails.length === 0) return [];
  // Pool candidates from every rail (deduped by URL) so even a short first
  // rail can produce a full hero set.
  const pool: SearchResponse[] = [];
  const seen = new Set<string>();
  for (const rail of rails) {
    for (const item of rail.list) {
      if (item.url && !seen.has(item.url)) {
        seen.add(item.url);
        pool.push(item);
      }
      if (pool.length >= 16) break;
    }
    if (pool.length >= 16) break;
  }
  // Prefer items that actually have a background/poster image so the hero
  // looks good — but don't exclude items entirely if none have images.
  const withImage = pool.filter(
    (p) => Boolean(p.backgroundUrl || p.posterUrl)
  );
  const candidates = withImage.length >= 5 ? withImage : pool;
  const shuffled = seededShuffle(
    candidates,
    rails.map((r) => r.name + r.providerName).join("|")
  );
  return shuffled.slice(0, 8);
}

export function HomeView() {
  const defaultProvider = useAppStore((s) => s.settings.defaultProvider);
  const watchHistory = useAppStore((s) => s.watchHistory);
  const setView = useAppStore((s) => s.setView);

  const enabledProviders = useMemo(
    () => APIHolder.getEnabledProviders(),
    []
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["cloudstream", "home", defaultProvider],
    queryFn: () => fetchHomeRails(defaultProvider),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const rails = useMemo(() => data ?? [], [data]);
  const featured = useMemo(() => buildFeatured(rails), [rails]);

  // No providers registered at all → show the onboarding CTA.
  if (enabledProviders.length === 0) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <NoProvidersState onOpenSettings={() => setView("settings")} />
      </div>
    );
  }

  // Initial loading (no cached data).
  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <HeroSkeleton />
        <StickySwitcherBar
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
        />
        <HomeSkeleton />
      </div>
    );
  }

  // Error state with retry.
  if (isError) {
    const msg =
      error instanceof Error
        ? error.message
        : "Failed to load home page. Please check your network connection.";
    return (
      <div className="mx-auto max-w-[1600px]">
        <HeroSkeleton />
        <StickySwitcherBar
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
        />
        <ErrorState message={msg} onRetry={() => refetch()} />
      </div>
    );
  }

  // Success with zero rails — empty state.
  if (rails.length === 0) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <HeroSkeleton />
        <StickySwitcherBar
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
        />
        <EmptyState
          title="No home content available"
          description={
            defaultProvider === "all"
              ? "None of the registered providers returned any home-page rails. Try installing more provider extensions, or pick a specific provider from the switcher above."
              : `The provider "${defaultProvider}" returned no home-page rails. Try switching providers from the switcher above.`
          }
          onRefresh={() => refetch()}
        />
      </div>
    );
  }

  // Success — render the full home layout.
  return (
    <div className="mx-auto max-w-[1600px]">
      {/* 1. Hero carousel */}
      {featured.length > 0 && <HeroCarousel items={featured} />}

      {/* 2. Sticky provider switcher bar */}
      <StickySwitcherBar
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
      />

      {/* 3. Continue Watching (only if there's watch history) */}
      {watchHistory.length > 0 && <ContinueWatchingRail />}

      {/* 4. Rails */}
      <div className="space-y-6 py-4">
        {rails.map((rail, idx) => (
          <HomeRail
            key={`${rail.providerName}-${rail.name}-${idx}`}
            title={
              defaultProvider === "all"
                ? `${rail.name} · ${rail.providerName}`
                : rail.name
            }
            items={rail.list}
          />
        ))}
      </div>
    </div>
  );
}

// ---- subcomponents ---------------------------------------------------------

/**
 * StickySwitcherBar — a slim strip that sits between the hero and the rails
 * (or between the hero skeleton and the rail skeleton during loading). It
 * pins to the top of the viewport (just below the global TopNav) so the
 * provider filter + refresh stay accessible while scrolling through rails.
 *
 * Right-aligned to match the CloudStream Android home-screen "filter" button
 * placement described in the rebuild brief.
 */
function StickySwitcherBar({
  onRefresh,
  isRefreshing,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div
      className={cn(
        "sticky top-14 z-30 flex items-center justify-end gap-2 px-4 py-3",
        "border-b border-[#3d3d3d] bg-[#1e1e1e]/95 backdrop-blur",
        "supports-[backdrop-filter]:bg-[#1e1e1e]/80"
      )}
    >
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label="Refresh home"
        className={cn(
          "flex size-9 items-center justify-center rounded-md border border-[#3d3d3d] bg-[#2d2d2d] text-white",
          "transition-colors hover:border-[#7664ed]/50 hover:bg-[#333]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        {isRefreshing ? (
          <InlineSpinner className="text-[#7664ed]" />
        ) : (
          <RefreshCw className="size-4" />
        )}
      </button>
      <ProviderSwitcher variant="home" />
    </div>
  );
}

/** Hero-sized loading skeleton (matches HeroCarousel dimensions). */
function HeroSkeleton() {
  return (
    <div
      className="relative h-[56vh] min-h-[360px] max-h-[640px] w-full overflow-hidden bg-[#1e1e1e]"
      aria-hidden="true"
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#2d2d2d] via-[#252525] to-[#1e1e1e]" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#1e1e1e] via-[#1e1e1e]/60 to-transparent" />
      {/* Fake title bar */}
      <div className="absolute bottom-[14%] left-1/2 flex w-full max-w-3xl -translate-x-1/2 flex-col items-center gap-3 px-6">
        <div className="h-10 w-2/3 animate-pulse rounded-md bg-[#2d2d2d]" />
        <div className="h-4 w-1/3 animate-pulse rounded-md bg-[#2d2d2d]" />
        <div className="mt-2 flex gap-3">
          <div className="h-9 w-28 animate-pulse rounded-md bg-[#2d2d2d]" />
          <div className="h-9 w-28 animate-pulse rounded-md bg-[#2d2d2d]" />
          <div className="h-9 w-28 animate-pulse rounded-md bg-[#2d2d2d]" />
        </div>
      </div>
      {/* Fake dots */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-2 w-2 animate-pulse rounded-full bg-[#2d2d2d]"
          />
        ))}
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#7a3a3a]/30 ring-1 ring-[#F53B66]/40">
        <WifiOff className="size-8 text-[#F53B66]" />
      </div>
      <div className="space-y-1">
        <h2 className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
          <AlertCircle className="size-5 text-[#F53B66]" />
          Couldn&apos;t load home
        </h2>
        <p className="max-w-md text-sm text-[#a0a0a0]">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "mt-2 flex items-center gap-2 rounded-md bg-[#7664ed] px-4 py-2 text-sm font-medium text-white shadow-md shadow-[#7664ed]/30",
          "transition-colors hover:bg-[#8774f0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
        )}
      >
        <RefreshCw className="size-4" />
        Retry
      </button>
    </div>
  );
}

function EmptyState({
  title,
  description,
  onRefresh,
}: {
  title: string;
  description: string;
  onRefresh: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
        <Inbox className="size-8 text-[#a0a0a0]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="max-w-md text-sm text-[#a0a0a0]">{description}</p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className={cn(
          "mt-2 flex items-center gap-2 rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-4 py-2 text-sm font-medium text-white",
          "transition-colors hover:border-[#7664ed]/50 hover:bg-[#333]"
        )}
      >
        <RefreshCw className="size-4" />
        Refresh
      </button>
    </div>
  );
}

/** No-providers onboarding CTA — mirrors the Android "no extensions" state. */
function NoProvidersState({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#7664ed]/15 ring-1 ring-[#7664ed]/40">
        <Plus className="size-8 text-[#7664ed]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">
          No providers installed
        </h2>
        <p className="max-w-md text-sm text-[#a0a0a0]">
          CloudStream needs at least one provider extension to fetch home
          content. Open Settings → Extensions to install one.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className={cn(
          "mt-2 flex items-center gap-2 rounded-md bg-[#7664ed] px-4 py-2 text-sm font-medium text-white shadow-md shadow-[#7664ed]/30",
          "transition-colors hover:bg-[#8774f0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
        )}
      >
        Open Settings
      </button>
    </div>
  );
}
