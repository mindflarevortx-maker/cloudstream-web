'use client';

/**
 * CloudStream Web — LibraryView
 *
 * The Library page. Mirrors the Android Library screen but adapted for web:
 *
 *   - **Bookmarks**      — from `useAppStore.bookmarks` (local, mirrors the
 *                          Android Bookmarks fragment / DataStoreHelper
 *                          getBookmarkedData).
 *   - **Watch History**  — from `useAppStore.watchHistory` (local, mirrors
 *                          DataStoreHelper.getResumeWatching). Each row shows
 *                          episode info + a progress bar + a Resume button.
 *   - **Subscriptions**  — from `useAppStore.subscriptions` (local). Mirrors
 *                          the Android "subscriptions" notifications list —
 *                          for now we just show the poster grid.
 *   - **Sync Library**   — shown only when at least one sync provider is
 *                          logged in. Mirrors the Android LibraryFragment
 *                          which is *exclusively* sync-driven (MAL / AniList /
 *                          Simkl / etc. lists). Fetches and shows library
 *                          items from sync providers; since the sync API is
 *                          not wired up yet, this tab reads the logged-in
 *                          accounts from localStorage and shows a per-account
 *                          placeholder with the items that would be shown.
 *
 * Each tab supports:
 *   - Sort options: recently added / alphabetical / recently watched
 *   - Empty state with an actionable message
 *   - Clear all (with confirmation) — calls the relevant store action
 *
 * The Android LibraryFragment has 9 sorting modes (ListSorting enum: Query,
 * RatingHigh, RatingLow, UpdatedNew, UpdatedOld, AlphabeticalA,
 * AlphabeticalZ, ReleaseDateNew, ReleaseDateOld) — we expose a sensible
 * subset that maps to the local data we actually have.
 */

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Bookmark, History as HistoryIcon, Rss, RefreshCw,
  Trash2, Search, Play, Clock, Inbox, LogIn,
  Calendar, ArrowDownAZ,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  useAppStore,
  WatchHistoryEntry,
} from "@/lib/cloudstream/store/app-store";
import { SearchResponse, LibraryItem } from "@/lib/cloudstream/types";
import { useToast } from "@/hooks/use-toast";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PosterCard } from "../common/PosterCard";

/* ------------------------------------------------------------------ */
/*  Sort options                                                       */
/* ------------------------------------------------------------------ */

type SortMode = "recent" | "alpha" | "watched";

const SORT_OPTIONS: { value: SortMode; label: string; Icon: typeof Calendar }[] = [
  { value: "recent", label: "Recently added", Icon: Calendar },
  { value: "alpha", label: "A → Z", Icon: ArrowDownAZ },
  { value: "watched", label: "Recently watched", Icon: Clock },
];

function SortBar({
  value,
  onChange,
  count,
  onClear,
  clearLabel,
  search,
  onSearchChange,
  placeholder = "Filter…",
}: {
  value: SortMode;
  onChange: (m: SortMode) => void;
  count: number;
  onClear: () => void;
  clearLabel: string;
  search: string;
  onSearchChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {SORT_OPTIONS.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={cn(
                "flex min-h-[32px] items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-[#7664ed] bg-[#7664ed]/15 text-white"
                  : "border-[#3d3d3d] bg-[#1e1e1e] text-[#a0a0a0] hover:border-[#7664ed]/50 hover:text-white"
              )}
            >
              <o.Icon className="size-3.5" />
              {o.label}
            </button>
          );
        })}
      </div>

      <div className="relative ml-auto">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[#a0a0a0]" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-44 pl-7 text-xs bg-[#1e1e1e]"
        />
      </div>

      <Badge variant="secondary" className="font-mono text-[10px]">
        {count}
      </Badge>

      {count > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-[#a0a0a0] hover:text-red-400"
            >
              <Trash2 className="size-3.5" />
              {clearLabel}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-[#3d3d3d] bg-[#2d2d2d] text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all?</AlertDialogTitle>
              <AlertDialogDescription className="text-[#a0a0a0]">
                This will remove all {count} item(s) from your {clearLabel.toLowerCase()}. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-[#3d3d3d] bg-[#1e1e1e] text-white hover:bg-[#3d3d3d]">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onClear}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Clear all
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({
  Icon,
  title,
  description,
  action,
}: {
  Icon: typeof Inbox;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
        <Icon className="size-8 text-[#7664ed]" />
      </div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="max-w-sm text-sm text-[#a0a0a0]">{description}</p>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Poster grid                                                        */
/* ------------------------------------------------------------------ */

function PosterGrid({ items }: { items: SearchResponse[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((sr) => (
        <PosterCard key={`${sr.apiName}-${sr.url}`} searchResponse={sr} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

export function LibraryView() {
  const [tab, setTab] = useState("bookmarks");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
          <Bookmark className="size-5 text-[#7664ed]" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-white">Library</h1>
          <p className="text-sm text-[#a0a0a0]">
            Bookmarks, watch history, subscriptions and sync libraries.
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="bg-[#2d2d2d] p-1">
          <TabsTrigger
            value="bookmarks"
            className="gap-1.5 data-[state=active]:bg-[#7664ed] data-[state=active]:text-white"
          >
            <Bookmark className="size-3.5" />
            Bookmarks
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="gap-1.5 data-[state=active]:bg-[#7664ed] data-[state=active]:text-white"
          >
            <HistoryIcon className="size-3.5" />
            History
          </TabsTrigger>
          <TabsTrigger
            value="subscriptions"
            className="gap-1.5 data-[state=active]:bg-[#7664ed] data-[state=active]:text-white"
          >
            <Rss className="size-3.5" />
            Subscriptions
          </TabsTrigger>
          <TabsTrigger
            value="sync"
            className="gap-1.5 data-[state=active]:bg-[#7664ed] data-[state=active]:text-white"
          >
            <RefreshCw className="size-3.5" />
            Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bookmarks" className="mt-4">
          <BookmarksTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="subscriptions" className="mt-4">
          <SubscriptionsTab />
        </TabsContent>
        <TabsContent value="sync" className="mt-4">
          <SyncLibraryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bookmarks tab                                                      */
/* ------------------------------------------------------------------ */

function BookmarksTab() {
  const bookmarks = useAppStore((s) => s.bookmarks);
  const clearBookmarks = useAppStore((s) => s.clearBookmarks);
  const setView = useAppStore((s) => s.setView);

  const [sort, setSort] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = bookmarks.slice();
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((b) =>
        b.searchResponse.name.toLowerCase().includes(q)
      );
    }
    switch (sort) {
      case "alpha":
        list.sort((a, b) =>
          a.searchResponse.name.localeCompare(b.searchResponse.name)
        );
        break;
      case "watched":
        // Bookmarks don't carry watch info; fall back to addedAt desc.
      case "recent":
      default:
        list.sort((a, b) => b.addedAt - a.addedAt);
        break;
    }
    return list;
  }, [bookmarks, search, sort]);

  if (bookmarks.length === 0) {
    return (
      <EmptyState
        Icon={Bookmark}
        title="No bookmarks yet"
        description="Bookmark titles from search or the result page to find them quickly here."
        action={
          <Button
            onClick={() => setView("search")}
            className="gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
          >
            <Search className="size-4" />
            Find something to watch
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <SortBar
        value={sort}
        onChange={setSort}
        count={filtered.length}
        onClear={clearBookmarks}
        clearLabel="Clear bookmarks"
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter bookmarks…"
      />
      {filtered.length === 0 ? (
        <EmptyState
          Icon={Search}
          title="No matches"
          description="Try a different filter or sort option."
        />
      ) : (
        <PosterGrid items={filtered.map((b) => b.searchResponse)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Watch History tab                                                  */
/* ------------------------------------------------------------------ */

function HistoryTab() {
  const history = useAppStore((s) => s.watchHistory);
  const clearWatchHistory = useAppStore((s) => s.clearWatchHistory);
  const openResult = useAppStore((s) => s.openResult);
  const setView = useAppStore((s) => s.setView);

  const [sort, setSort] = useState<SortMode>("watched");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = history.slice();
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((w) =>
        w.searchResponse.name.toLowerCase().includes(q)
      );
    }
    switch (sort) {
      case "alpha":
        list.sort((a, b) =>
          a.searchResponse.name.localeCompare(b.searchResponse.name)
        );
        break;
      case "recent":
        // Bookmarks-style: by addedAt — for history, treat watchedAt as addedAt.
        list.sort((a, b) => b.watchedAt - a.watchedAt);
        break;
      case "watched":
      default:
        list.sort((a, b) => b.watchedAt - a.watchedAt);
        break;
    }
    return list;
  }, [history, search, sort]);

  if (history.length === 0) {
    return (
      <EmptyState
        Icon={HistoryIcon}
        title="No watch history yet"
        description="Episodes you watch will appear here so you can pick up where you left off."
        action={
          <Button
            onClick={() => setView("home")}
            className="gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
          >
            <Play className="size-4" />
            Browse home
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <SortBar
        value={sort}
        onChange={setSort}
        count={filtered.length}
        onClear={clearWatchHistory}
        clearLabel="Clear history"
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter history…"
      />
      {filtered.length === 0 ? (
        <EmptyState
          Icon={Search}
          title="No matches"
          description="Try a different filter or sort option."
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((entry, idx) => (
            <HistoryRow
              key={`${entry.searchResponse.url}-${entry.episode.season}-${entry.episode.episode}-${idx}`}
              entry={entry}
              onResume={() =>
                openResult(
                  entry.searchResponse.url,
                  entry.searchResponse.apiName
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryRow({
  entry,
  onResume,
}: {
  entry: WatchHistoryEntry;
  onResume: () => void;
}) {
  const { searchResponse: sr, episode, position, duration, watchedAt } = entry;
  const pct = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
  const isMovie = sr.type === "Movie" || (episode.season === 0 && episode.episode === 0);
  const epLabel = isMovie
    ? "Movie"
    : `S${episode.season} · E${episode.episode}`;
  const epName = episode.name && episode.name.trim() !== ""
    ? episode.name
    : epLabel;

  return (
    <li className="flex items-center gap-3 rounded-lg border border-[#3d3d3d] bg-[#2d2d2d]/60 p-3 transition-colors hover:border-[#7664ed]/40">
      {/* Poster thumb */}
      <button
        type="button"
        onClick={onResume}
        className="relative size-16 shrink-0 overflow-hidden rounded-md bg-[#1e1e1e] ring-1 ring-[#3d3d3d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]"
        aria-label={`Resume ${sr.name}`}
      >
        {sr.posterUrl ? (
          <img
            src={sr.posterUrl}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Play className="size-5 text-[#7664ed]" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity hover:opacity-100">
          <div className="flex size-8 items-center justify-center rounded-full bg-[#7664ed]/90 ring-2 ring-white/20">
            <Play className="size-4 translate-x-0.5 fill-white text-white" />
          </div>
        </div>
      </button>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-sm font-semibold text-white">{sr.name}</h3>
          <Badge variant="secondary" className="shrink-0 bg-[#7664ed]/15 text-[10px] text-[#BEC8FF]">
            {sr.apiName}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-[#a0a0a0]">
          {epLabel} · {epName}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#1e1e1e]">
            <div
              className="absolute inset-y-0 left-0 bg-[#7664ed] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] text-[#a0a0a0]">
            {fmtTime(position)} / {fmtTime(duration)}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-[#a0a0a0]">
          Watched {formatRelative(watchedAt)}
        </p>
      </div>

      {/* Resume button */}
      <Button
        onClick={onResume}
        size="sm"
        className="shrink-0 gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
      >
        <Play className="size-3.5 fill-white" />
        Resume
      </Button>
    </li>
  );
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

/* ------------------------------------------------------------------ */
/*  Subscriptions tab                                                  */
/* ------------------------------------------------------------------ */

function SubscriptionsTab() {
  const subscriptions = useAppStore((s) => s.subscriptions);
  const setView = useAppStore((s) => s.setView);

  // For now, "new episode" check is a placeholder — we'd normally poll each
  // subscription's `load()` for new episodes since last seen. Since the
  // providers may not be wired up, we just display the subscription grid.
  const [sort, setSort] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = subscriptions.slice();
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    switch (sort) {
      case "alpha":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "watched":
      case "recent":
      default:
        // Subscriptions don't have a timestamp in the store; keep insertion order.
        break;
    }
    return list;
  }, [subscriptions, search, sort]);

  // We can't truly "clear" subscriptions from the store (no clearSubscriptions
  // action); emulate by unsubscribing all. Read toggleSubscription per-item.
  const toggleSubscription = useAppStore((s) => s.toggleSubscription);
  const { toast } = useToast();
  const clearAll = useCallback(() => {
    subscriptions.forEach((s) => toggleSubscription(s));
    toast({ title: "Unsubscribed from all" });
  }, [subscriptions, toggleSubscription, toast]);

  if (subscriptions.length === 0) {
    return (
      <EmptyState
        Icon={Rss}
        title="No subscriptions"
        description="Subscribe to a show from its result page to be notified when new episodes are released."
        action={
          <Button
            onClick={() => setView("search")}
            className="gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
          >
            <Search className="size-4" />
            Find shows
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <SortBar
        value={sort}
        onChange={setSort}
        count={filtered.length}
        onClear={clearAll}
        clearLabel="Unsubscribe all"
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter subscriptions…"
      />
      {filtered.length === 0 ? (
        <EmptyState
          Icon={Search}
          title="No matches"
          description="Try a different filter or sort option."
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-md border border-[#3d3d3d]/60 bg-[#1e1e1e]/40 px-3 py-2 text-xs text-[#a0a0a0]">
            <Rss className="size-3.5 text-[#7664ed]" />
            New-episode detection will be wired up when the provider modules finish loading. Showing your subscriptions for now.
          </div>
          <PosterGrid items={filtered} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sync Library tab                                                   */
/* ------------------------------------------------------------------ */

interface SyncAccountLite {
  provider: string;
  username: string;
  loggedInAt: number;
}

const SYNC_ACCOUNTS_KEY = "cloudstream-sync-accounts";

function readSyncAccountsLite(): SyncAccountLite[] {
  try {
    const raw = localStorage.getItem(SYNC_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function SyncLibraryTab() {
  const [accounts, setAccounts] = useState<SyncAccountLite[]>([]);
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    const refresh = () => setAccounts(readSyncAccountsLite());
    refresh();
    window.addEventListener("cloudstream-sync-accounts-changed", refresh);
    return () =>
      window.removeEventListener("cloudstream-sync-accounts-changed", refresh);
  }, []);

  if (accounts.length === 0) {
    return (
      <EmptyState
        Icon={LogIn}
        title="Sign in to a sync provider"
        description="The Sync Library tab shows your lists from AniList, MyAnimeList and other sync providers. Sign in to one to populate this tab."
        action={
          <Button
            onClick={() => setView("settings")}
            className="gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
          >
            <LogIn className="size-4" />
            Open Settings → Sync
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-[#3d3d3d]/60 bg-[#1e1e1e]/40 px-3 py-2 text-xs text-[#a0a0a0]">
        <RefreshCw className="size-3.5 text-[#7664ed]" />
        Sync library items will appear here once the sync API is wired up. Showing your logged-in accounts below.
      </div>
      {accounts.map((acc) => (
        <SyncAccountLibrary key={acc.provider} account={acc} />
      ))}
    </div>
  );
}

function SyncAccountLibrary({ account }: { account: SyncAccountLite }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // No real sync API yet — simulate a network call that returns an empty
      // list after a short delay, then surface a "no items" state. When the
      // sync API is wired up, this will call `syncApi.library()` and map
      // `allLibraryLists` → `LibraryItem[]`.
      await new Promise((r) => setTimeout(r, 600));
      setItems([]);
    } catch (e) {
      console.warn("[SyncLibrary] refresh failed:", e);
      toast({
        title: "Could not load library",
        description: String(e),
        variant: "destructive",
      });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
    // `refresh` is stable enough for this effect; intentionally only re-run
    // when the account provider changes.
  }, [account.provider]);

  return (
    <section className="rounded-xl border border-[#3d3d3d] bg-[#2d2d2d]/60 p-4">
      <header className="mb-3 flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-[#7664ed]/15 ring-1 ring-[#7664ed]/40">
          <span className="text-xs font-semibold text-[#BEC8FF]">
            {account.provider.slice(0, 2)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">
            {account.provider}
          </h2>
          <p className="truncate text-xs text-[#a0a0a0]">
            Signed in as {account.username} · {formatRelative(account.loggedInAt)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="h-8 gap-1.5 text-[#a0a0a0] hover:text-white"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {loading && items === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] animate-pulse rounded-md bg-[#1e1e1e]"
            />
          ))}
        </div>
      ) : items && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((it) => (
            <SyncLibraryItemCard key={it.id} item={it} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[#3d3d3d] py-10 text-center">
          <Inbox className="size-6 text-[#a0a0a0]" />
          <p className="text-sm text-[#a0a0a0]">
            No library items yet. Items you add on {account.provider} will appear here.
          </p>
        </div>
      )}
    </section>
  );
}

function SyncLibraryItemCard({ item }: { item: LibraryItem }) {
  const progressPct =
    item.maxEpisodes && item.maxEpisodes > 0
      ? Math.min(100, Math.round(((item.watchedEpisodes ?? 0) / item.maxEpisodes) * 100))
      : 0;

  return (
    <div className="flex flex-col">
      <div
        className="relative overflow-hidden rounded-md bg-[#1e1e1e] ring-1 ring-[#3d3d3d]"
        style={{ aspectRatio: "2 / 3" }}
      >
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-full items-center justify-center p-2 text-center text-[10px] text-[#a0a0a0]">
            {item.title}
          </div>
        )}
        {item.status && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/90">
            {item.status}
          </span>
        )}
        {progressPct > 0 && (
          <div className="absolute bottom-0 left-0 h-1 bg-[#7664ed]" style={{ width: `${progressPct}%` }} />
        )}
      </div>
      <h3 className="mt-1.5 line-clamp-1 text-xs font-medium text-white" title={item.title}>
        {item.title}
      </h3>
      <p className="text-[10px] text-[#a0a0a0]">
        {item.watchedEpisodes ?? 0}
        {item.maxEpisodes ? ` / ${item.maxEpisodes}` : ""} eps
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  End of file                                                        */
/* ------------------------------------------------------------------ */
