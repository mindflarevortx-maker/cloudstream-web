'use client';

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, Inbox, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { APIHolder } from "@/lib/cloudstream/MainAPI";
import { HomePageList } from "@/lib/cloudstream/types";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import { HomeRail } from "./HomeRail";
import {
  HomeSkeleton,
  InlineSpinner,
} from "../common/Loading";

/**
 * HomeView — the CloudStream home page.
 *
 * Behavior (mirrors the Android HomeFragment):
 *   - Reads the default provider from the app store. If "all", fetches rails
 *     from every enabled provider in parallel and merges the HomePageList[]
 *     into one array. Otherwise, fetches only from the selected provider.
 *   - Shows loading skeletons while fetching.
 *   - On error, shows an error state with a retry button.
 *   - On success with zero rails, shows an empty state.
 *   - A refresh button in the header triggers `refetch()`.
 *
 * Data fetching uses TanStack Query. The query function calls
 * `APIHolder.getEnabledProviders()` and for each provider calls
 * `provider.getMainPage(1, null)`, then merges all HomePageList[] arrays.
 * Failures of individual providers are swallowed (Promise.allSettled) so one
 * broken provider doesn't break the whole home page.
 */

/** Merged rail type — name is prefixed with the provider name to disambiguate. */
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

  // If the user picked a specific provider that isn't registered, fall back to
  // "all" so they still see something.
  const effective = targets.length > 0 ? targets : all;

  // Fire all getMainPage calls in parallel. Promise.allSettled means a single
  // failing provider doesn't break the home page.
  const settled = await Promise.allSettled(
    effective.map(async (p) => {
      // Skip providers that don't implement getMainPage
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

export function HomeView() {
  const defaultProvider = useAppStore((s) => s.settings.defaultProvider);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["cloudstream", "home", defaultProvider],
    queryFn: () => fetchHomeRails(defaultProvider),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const rails = useMemo(() => data ?? [], [data]);

  // ---- Render branches ------------------------------------------------------

  // Initial loading (no cached data)
  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <HomeHeader
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
          railCount={0}
        />
        <HomeSkeleton />
      </div>
    );
  }

  // Error state with retry
  if (isError) {
    const msg =
      error instanceof Error
        ? error.message
        : "Failed to load home page. Please check your network connection.";
    return (
      <div className="mx-auto max-w-[1600px]">
        <HomeHeader
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
          railCount={0}
        />
        <ErrorState message={msg} onRetry={() => refetch()} />
      </div>
    );
  }

  // Empty state
  if (rails.length === 0) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <HomeHeader
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
          railCount={0}
        />
        <EmptyState
          title="No home content available"
          description={
            defaultProvider === "all"
              ? "None of the registered providers returned any home-page rails. Try installing provider extensions, or pick a specific provider from the switcher."
              : `The provider "${defaultProvider}" returned no home-page rails. Try switching providers from the top-right dropdown.`
          }
          onRefresh={() => refetch()}
        />
      </div>
    );
  }

  // Success state
  return (
    <div className="mx-auto max-w-[1600px]">
      <HomeHeader
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
        railCount={rails.length}
      />
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

/** The home header: a small "Home" title + refresh button + rail count. */
function HomeHeader({
  onRefresh,
  isRefreshing,
  railCount,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
  railCount: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-4">
      <div>
        <h1 className="text-xl font-semibold text-white sm:text-2xl">Home</h1>
        {railCount > 0 && (
          <p className="mt-0.5 text-xs text-[#a0a0a0]">
            {railCount} {railCount === 1 ? "rail" : "rails"}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className={cn(
          "flex items-center gap-2 rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-3 py-1.5 text-sm",
          "text-white transition-colors hover:border-[#7664ed]/50 hover:bg-[#333]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        aria-label="Refresh home"
      >
        {isRefreshing ? (
          <InlineSpinner className="text-[#7664ed]" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        <span className="hidden sm:inline">Refresh</span>
      </button>
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
          Couldn't load home
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
