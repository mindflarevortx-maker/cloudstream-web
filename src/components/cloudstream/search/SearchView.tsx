'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search as SearchIcon,
  X,
  History,
  TrendingUp,
  Filter,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { APIHolder } from "@/lib/cloudstream/MainAPI";
import { SearchResponse, TvType } from "@/lib/cloudstream/types";
import { PosterCard } from "../common/PosterCard";
import { PosterGridSkeleton, InlineSpinner } from "../common/Loading";

/**
 * SearchView — the CloudStream search page (TV layout).
 *
 * Features:
 *   - Search input at top, debounced 300ms before firing.
 *   - Provider filter chips (multi-select, defaults to all).
 *   - TvType filter chips (optional, multi-select; defaults to none = all).
 *   - Results grid: 2 cols mobile → 6 cols TV.
 *   - Loading state: skeleton grid.
 *   - Empty state: prompt to start typing.
 *   - Search history: stored in localStorage as a JSON array (max 25).
 *     Shown as a dropdown when the input is focused AND empty.
 *
 * Data flow:
 *   - On debounced query change, fire parallel `provider.search(query)` calls
 *     across all enabled (or selected) providers via Promise.allSettled.
 *   - Merge results. Dedupe by URL (first occurrence wins).
 *   - Filter by selected TvTypes (if any).
 */

const DEBOUNCE_MS = 300;
const HISTORY_KEY = "cloudstream-web-search-history";
const HISTORY_MAX = 25;

/**
 * useSyncExternalStore-based history hook.
 *
 * We avoid `setState` inside a `useEffect` (which the lint rule
 * `react-hooks/set-state-in-effect` flags) by treating localStorage as an
 * external store: subscribe to the `storage` event, and read synchronously
 * on every render via getSnapshot.
 *
 * getSnapshot is cached by reference (so React doesn't loop) — we bump a
 * version counter on every write and only re-allocate the array when the
 * version changes.
 */
const historyListeners = new Set<() => void>();
let historyVersion = 0;
let historyCache: string[] | null = null;

function notifyHistoryListeners() {
  historyVersion++;
  historyCache = null;
  historyListeners.forEach((l) => l());
}

function subscribeHistory(cb: () => void): () => void {
  historyListeners.add(cb);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorageEvent);
  }
  return () => {
    historyListeners.delete(cb);
    if (historyListeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}

function onStorageEvent(e: StorageEvent) {
  if (e.key === HISTORY_KEY) {
    notifyHistoryListeners();
  }
}

function getHistorySnapshot(): string[] {
  if (historyCache === null) {
    historyCache = readHistory();
  }
  return historyCache;
}

function commitHistory(items: string[]) {
  writeHistory(items);
  notifyHistoryListeners();
}

// ---- TvType chip options ---------------------------------------------------

const TV_TYPE_CHIPS: { label: string; value: TvType }[] = [
  { label: "Movies", value: TvType.Movie },
  { label: "Series", value: TvType.TvSeries },
  { label: "Anime", value: TvType.Anime },
  { label: "Drama", value: TvType.AsianDrama },
  { label: "Documentaries", value: TvType.Documentaries },
  { label: "Live", value: TvType.Live },
  { label: "Torrent", value: TvType.Torrent },
  { label: "Music", value: TvType.Music },
];

// ---- helpers ---------------------------------------------------------------

function readHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeHistory(items: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(items.slice(0, HISTORY_MAX))
    );
  } catch {
    /* ignore quota errors */
  }
}

function dedupeByURL(items: SearchResponse[]): SearchResponse[] {
  const seen = new Set<string>();
  const out: SearchResponse[] = [];
  for (const it of items) {
    const key = `${it.apiName}::${it.url}`;
    if (it.url && !seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

// ---- main component --------------------------------------------------------

export function SearchView() {
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]); // [] = all
  const [selectedTypes, setSelectedTypes] = useState<TvType[]>([]); // [] = all
  // Search history — read via useSyncExternalStore (localStorage-backed)
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    () => [] as string[] // SSR snapshot
  );
  const [isInputFocused, setIsInputFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the query
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(inputValue.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [inputValue]);

  // The list of providers from APIHolder (snapshot once)
  const providers = useMemo(() => APIHolder.getAllProviders(), []);

  // Build the list of provider names to query
  const providerNamesToQuery = useMemo(() => {
    if (selectedProviders.length === 0) {
      return providers.map((p) => p.name);
    }
    return selectedProviders;
  }, [selectedProviders, providers]);

  // The actual search query
  const {
    data: results,
    isLoading: isSearching,
    isError,
    error,
  } = useQuery({
    queryKey: [
      "cloudstream",
      "search",
      debouncedQuery,
      providerNamesToQuery.join(","),
    ],
    queryFn: async (): Promise<SearchResponse[]> => {
      if (!debouncedQuery) return [];
      const targets = APIHolder.getEnabledProviders().filter((p) =>
        providerNamesToQuery.includes(p.name)
      );
      if (targets.length === 0) return [];

      const settled = await Promise.allSettled(
        targets.map((p) => p.search(debouncedQuery, 1).catch(() => []))
      );
      const merged: SearchResponse[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled" && Array.isArray(r.value)) {
          merged.push(...r.value);
        }
      }
      return dedupeByURL(merged);
    },
    enabled: debouncedQuery.length > 0,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // Save to history on successful search.
  // We use a ref to dedupe writes across renders, and write to localStorage
  // (the external store) — `useSyncExternalStore` will pick up the change
  // via our notify function. This avoids the `setState in effect` lint rule.
  const lastRecordedRef = useRef<string>("");
  useEffect(() => {
    if (
      debouncedQuery &&
      results &&
      results.length > 0 &&
      lastRecordedRef.current !== debouncedQuery
    ) {
      lastRecordedRef.current = debouncedQuery;
      const next = [debouncedQuery, ...history.filter((x) => x !== debouncedQuery)].slice(
        0,
        HISTORY_MAX
      );
      commitHistory(next);
    }
  }, [debouncedQuery, results, history]);

  const clearHistory = useCallback(() => {
    commitHistory([]);
  }, []);

  // Apply TvType filter
  const filteredResults = useMemo(() => {
    if (!results) return [];
    if (selectedTypes.length === 0) return results;
    return results.filter((r) => selectedTypes.includes(r.type));
  }, [results, selectedTypes]);

  // ---- handlers ------------------------------------------------------------

  const handleProviderChip = (name: string) => {
    setSelectedProviders((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  };

  const handleTypeChip = (t: TvType) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleClearInput = () => {
    setInputValue("");
    setDebouncedQuery("");
    inputRef.current?.focus();
  };

  const handleHistoryClick = (q: string) => {
    setInputValue(q);
    setDebouncedQuery(q);
    setIsInputFocused(false);
    inputRef.current?.blur();
  };

  const showHistoryDropdown =
    isInputFocused && inputValue.length === 0 && history.length > 0;

  // ---- render --------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* Header + search input */}
      <div className="px-4 pt-4">
        <h1 className="text-xl font-semibold text-white sm:text-2xl">Search</h1>
        <p className="mt-0.5 text-xs text-[#a0a0a0]">
          Searches across all enabled providers in parallel.
        </p>

        {/* Search input row */}
        <div className="relative mt-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border bg-[#2d2d2d] px-3",
              "border-[#3d3d3d] transition-colors",
              "focus-within:border-[#7664ed]/60 focus-within:ring-2 focus-within:ring-[#7664ed]/30"
            )}
          >
            <SearchIcon className="size-5 shrink-0 text-[#a0a0a0]" />
            <input
              ref={inputRef}
              type="search"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setTimeout(() => setIsInputFocused(false), 150)}
              placeholder="Search movies, series, anime…"
              aria-label="Search query"
              className={cn(
                "h-12 flex-1 bg-transparent text-base text-white placeholder:text-[#a0a0a0]",
                "focus:outline-none"
              )}
            />
            {isSearching && <InlineSpinner className="text-[#7664ed]" />}
            {inputValue && (
              <button
                type="button"
                onClick={handleClearInput}
                aria-label="Clear search"
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-[#a0a0a0]",
                  "transition-colors hover:bg-white/10 hover:text-white"
                )}
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* History dropdown */}
          {showHistoryDropdown && (
            <div
              className={cn(
                "absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-[#3d3d3d]",
                "bg-[#2d2d2d] shadow-xl shadow-black/40"
              )}
              role="listbox"
              aria-label="Search history"
            >
              <div className="flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#a0a0a0]">
                  <History className="size-3.5" />
                  Recent searches
                </span>
                <button
                  type="button"
                  onClick={clearHistory}
                  className="text-xs text-[#a0a0a0] transition-colors hover:text-white"
                >
                  Clear
                </button>
              </div>
              <ul className="max-h-72 overflow-y-auto">
                {history.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleHistoryClick(q)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white",
                        "transition-colors hover:bg-[#7664ed]/20"
                      )}
                    >
                      <History className="size-3.5 text-[#a0a0a0]" />
                      <span className="flex-1 truncate">{q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Filter chips: providers */}
        <FilterRow
          icon={<Filter className="size-3.5" />}
          label="Providers"
          chips={providers.map((p) => ({
            label: p.name,
            value: p.name,
            active: selectedProviders.length === 0 || selectedProviders.includes(p.name),
            isAll: selectedProviders.length === 0,
          }))}
          onToggle={handleProviderChip}
          onAll={() => setSelectedProviders([])}
        />

        {/* Filter chips: TvType */}
        <FilterRow
          icon={<TrendingUp className="size-3.5" />}
          label="Type"
          chips={TV_TYPE_CHIPS.map((c) => ({
            label: c.label,
            value: c.value,
            active: selectedTypes.length === 0 || selectedTypes.includes(c.value),
            isAll: selectedTypes.length === 0,
          }))}
          onToggle={(v) => handleTypeChip(v as TvType)}
          onAll={() => setSelectedTypes([])}
        />
      </div>

      {/* Results area */}
      <div className="mt-2 min-h-[40vh]">
        {!debouncedQuery && (
          <EmptySearchState />
        )}

        {debouncedQuery && isSearching && (
          <PosterGridSkeleton count={18} />
        )}

        {debouncedQuery && !isSearching && isError && (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-[#F53B66]">
              {error instanceof Error ? error.message : "Search failed."}
            </p>
          </div>
        )}

        {debouncedQuery && !isSearching && !isError && filteredResults.length === 0 && (
          <NoResultsState query={debouncedQuery} />
        )}

        {debouncedQuery && !isSearching && !isError && filteredResults.length > 0 && (
          <>
            <div className="flex items-center justify-between px-4 py-2 text-xs text-[#a0a0a0]">
              <span>
                {filteredResults.length} {filteredResults.length === 1 ? "result" : "results"}
                {selectedTypes.length > 0 && " (filtered)"}
              </span>
            </div>
            <div
              className={cn(
                "grid grid-cols-2 gap-3 px-4 py-2",
                "sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
              )}
            >
              {filteredResults.map((r, idx) => (
                <PosterCard
                  key={`${r.url}-${idx}`}
                  searchResponse={r}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- subcomponents ---------------------------------------------------------

interface ChipDef {
  label: string;
  value: string;
  active: boolean;
  isAll: boolean; // true when "all" is selected (no specific selection)
}

function FilterRow({
  icon,
  label,
  chips,
  onToggle,
  onAll,
}: {
  icon: React.ReactNode;
  label: string;
  chips: ChipDef[];
  onToggle: (value: string) => void;
  onAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 flex items-start gap-2">
      <div className="flex shrink-0 items-center gap-1 pt-1.5 text-xs font-medium uppercase tracking-wider text-[#a0a0a0]">
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </div>
      <div className="flex flex-1 flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onAll}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            chips.every((c) => c.isAll)
              ? "border-[#7664ed] bg-[#7664ed]/20 text-[#BEC8FF]"
              : "border-[#3d3d3d] bg-[#2d2d2d] text-[#a0a0a0] hover:border-[#7664ed]/50 hover:text-white"
          )}
        >
          All
        </button>
        {chips.map((c) => {
          const active = !c.isAll && c.active;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onToggle(c.value)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/40",
                active
                  ? "border-[#7664ed] bg-[#7664ed]/20 text-[#BEC8FF]"
                  : "border-[#3d3d3d] bg-[#2d2d2d] text-[#a0a0a0] hover:border-[#7664ed]/50 hover:text-white"
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptySearchState() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
        <SearchIcon className="size-8 text-[#a0a0a0]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">Search for content</h2>
        <p className="max-w-md text-sm text-[#a0a0a0]">
          Type a title above. Results stream in from all enabled providers in
          parallel, deduplicated by URL.
        </p>
      </div>
    </div>
  );
}

function NoResultsState({ query }: { query: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
        <SearchIcon className="size-8 text-[#a0a0a0]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">
          No results for “{query}”
        </h2>
        <p className="max-w-md text-sm text-[#a0a0a0]">
          Try a different spelling, remove some filter chips, or install more
          provider extensions.
        </p>
      </div>
    </div>
  );
}
