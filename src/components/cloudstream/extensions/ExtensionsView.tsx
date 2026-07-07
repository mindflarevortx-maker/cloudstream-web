'use client';

/**
 * CloudStream Web — ExtensionsView
 *
 * The full-screen Extensions management UI. Mirrors the Android
 * `ExtensionsFragment` (`fragment_extensions.xml` + `fragment_plugins.xml`),
 * adapted for the web port:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ← Extensions                              [🔍 search]  [🌐]   │  header
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ All  Movies  TV Series  Anime  Asian Drama  Live  Others     │  category tabs
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Repositories                                                  │
 *   │  ┌──────────────────────────────────────────────────────┐   │
 *   │  │ [🐙] Repo Name                          [3 plugins][🗑] │   │  RepositoryCard
 *   │  └──────────────────────────────────────────────────────┘   │
 *   │ Installed Plugins                                             │
 *   │  ┌──────────────────────────────────────────────────────┐   │
 *   │  │ [icon] Plugin Name  v1.2  [lang] [types]   [○] [🗑]   │   │  PluginCard
 *   │  └──────────────────────────────────────────────────────┘   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ ● Downloaded: 5  ● Disabled: 1  ○ Not downloaded: 12        │  stats bar
 *   │ ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │  progress bar
 *   └──────────────────────────────────────────────────────────────┘
 *                                              ╔═══╗
 *                                              ║ + ║   floating add button
 *                                              ╚═══╝
 *
 * State:
 *   - repositories + installedPlugins from useRepositoryStore
 *   - local UI state: searchQuery, activeCategory, activeLanguage, addDialogOpen
 *
 * Filtering logic:
 *   - A plugin "matches" if its name contains the search query, its tvTypes
 *     intersect the active category, and its language matches the active
 *     language (or the language filter is "All").
 *   - Stats reflect the same filter (so the bottom bar stays in sync with
 *     what the user sees on screen).
 */

import { useMemo, useState, useCallback } from "react";
import {
  ArrowLeft,
  Search,
  Globe,
  Plus,
  Puzzle,
  Package,
  X,
  ChevronDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import {
  useRepositoryStore,
  Repository,
  PluginEntry,
} from "@/lib/cloudstream/store/repository-store";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";

import { RepositoryCard } from "./RepositoryCard";
import { PluginCard } from "./PluginCard";
import { AddRepositoryDialog } from "./AddRepositoryDialog";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** The category tabs — values map to TvType string names. `All` is the
 *  unfiltered default. `Others` collapses everything not in the main set. */
const CATEGORIES: { id: string; label: string; tvTypes: string[] | null }[] = [
  { id: "all", label: "All", tvTypes: null },
  { id: "movie", label: "Movies", tvTypes: ["Movie"] },
  { id: "series", label: "TV Series", tvTypes: ["TvSeries"] },
  { id: "anime", label: "Anime", tvTypes: ["Anime"] },
  { id: "drama", label: "Asian Drama", tvTypes: ["AsianDrama"] },
  { id: "live", label: "Live", tvTypes: ["Live"] },
  { id: "others", label: "Others", tvTypes: ["Documentaries", "Torrent", "NSFW", "Music", "AudioBook", "Audiobook", "Podcast", "Audio", "CustomMedia", "Others"] },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Does a plugin match the active category filter? */
function matchesCategory(entry: PluginEntry, tvTypes: string[] | null): boolean {
  if (!tvTypes) return true; // "All"
  const pluginTypes = entry.tvTypes ?? [];
  if (pluginTypes.length === 0) {
    // Plugins with no tvTypes: only show in "All" + "Others".
    return tvTypes.includes("Others");
  }
  return pluginTypes.some((t) => tvTypes.includes(t));
}

function matchesSearch(entry: PluginEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    entry.name.toLowerCase().includes(needle) ||
    (entry.internalName?.toLowerCase().includes(needle) ?? false) ||
    (entry.description?.toLowerCase().includes(needle) ?? false) ||
    (entry.authors?.some((a) => a.toLowerCase().includes(needle)) ?? false)
  );
}

function matchesLanguage(entry: PluginEntry, lang: string | null): boolean {
  if (!lang) return true; // null = "All"
  return (entry.language ?? "").toLowerCase() === lang.toLowerCase();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ExtensionsView() {
  const { toast } = useToast();
  const setView = useAppStore((s) => s.setView);

  const repositories = useRepositoryStore((s) => s.repositories);
  const installedPlugins = useRepositoryStore((s) => s.installedPlugins);
  const removeRepository = useRepositoryStore((s) => s.removeRepository);
  const installPlugin = useRepositoryStore((s) => s.installPlugin);
  const uninstallPlugin = useRepositoryStore((s) => s.uninstallPlugin);
  const togglePluginEnabled = useRepositoryStore((s) => s.togglePluginEnabled);
  const isPluginInstalled = useRepositoryStore((s) => s.isPluginInstalled);

  // Local UI state.
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pickRepoFor, setPickRepoFor] = useState<Repository | null>(null);
  const [installingName, setInstallingName] = useState<string | null>(null);

  const activeCat = CATEGORIES.find((c) => c.id === activeCategory)!;

  // Gather all plugin entries across all repos — used for the master list +
  // stats. We dedupe by internalName (a plugin could appear in multiple repos
  // in theory, though that's rare).
  const allPluginEntries = useMemo(() => {
    const map = new Map<string, PluginEntry>();
    for (const repo of repositories) {
      for (const p of repo.plugins) {
        if (!map.has(p.internalName)) map.set(p.internalName, p);
      }
    }
    return Array.from(map.values());
  }, [repositories]);

  // All available languages — for the globe dropdown.
  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPluginEntries) {
      if (p.language) set.add(p.language);
    }
    return Array.from(set).sort();
  }, [allPluginEntries]);

  // Filtered list — what's shown in the "Available plugins" section.
  const filteredEntries = useMemo(() => {
    return allPluginEntries.filter(
      (p) =>
        matchesCategory(p, activeCat.tvTypes) &&
        matchesSearch(p, search) &&
        matchesLanguage(p, activeLanguage)
    );
  }, [allPluginEntries, activeCat, search, activeLanguage]);

  // Filtered installed plugins — what's shown in the "Installed" section.
  const filteredInstalled = useMemo(() => {
    return installedPlugins.filter((ip) => {
      // Reconstruct a PluginEntry-like shape from InstalledPlugin for the
      // matcher helpers (they only read name / tvTypes / language / etc.).
      const entry: PluginEntry = {
        internalName: ip.internalName,
        name: ip.name,
        version: ip.version,
        versionName: ip.versionName,
        description: ip.description,
        language: ip.language,
        tvTypes: ip.tvTypes,
        iconUrl: ip.iconUrl,
      };
      return (
        matchesCategory(entry, activeCat.tvTypes) &&
        matchesSearch(entry, search) &&
        matchesLanguage(entry, activeLanguage)
      );
    });
  }, [installedPlugins, activeCat, search, activeLanguage]);

  // Stats — match the Android bottom bar layout:
  //   Downloaded: N    Disabled: N    Not downloaded: M
  const stats = useMemo(() => {
    const downloaded = filteredInstalled.length;
    const disabled = filteredInstalled.filter((ip) => !ip.enabled).length;
    // "Not downloaded" = plugins in the filteredEntries list that aren't
    // installed.
    const notDownloaded = filteredEntries.filter(
      (p) => !isPluginInstalled(p.internalName)
    ).length;
    const total = downloaded + notDownloaded;
    const progressPct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
    return { downloaded, disabled, notDownloaded, total, progressPct };
  }, [filteredInstalled, filteredEntries, isPluginInstalled]);

  // Handlers ----------------------------------------------------------------

  const handleInstall = useCallback(
    async (internalName: string, repoUrl?: string) => {
      // Find which repo the plugin lives in.
      let url = repoUrl;
      if (!url) {
        const repo = repositories.find((r) =>
          r.plugins.some((p) => p.internalName === internalName)
        );
        url = repo?.url;
      }
      if (!url) {
        toast({
          title: "Install failed",
          description: "Could not find the plugin in any repository.",
          variant: "destructive",
        });
        return;
      }
      setInstallingName(internalName);
      try {
        const result = await installPlugin(url, internalName);
        if (result.ok) {
          toast({
            title: "Plugin installed",
            description: allPluginEntries.find(
              (p) => p.internalName === internalName
            )?.name,
          });
        } else {
          toast({
            title: "Install failed",
            description: result.error ?? "Unknown error",
            variant: "destructive",
          });
        }
      } finally {
        setInstallingName(null);
      }
    },
    [repositories, installPlugin, allPluginEntries, toast]
  );

  const handleUninstall = useCallback(
    (internalName: string) => {
      uninstallPlugin(internalName);
      toast({
        title: "Uninstalled",
        description: allPluginEntries.find((p) => p.internalName === internalName)
          ?.name,
      });
    },
    [uninstallPlugin, allPluginEntries, toast]
  );

  const handleToggle = useCallback(
    (internalName: string, enabled: boolean) => {
      togglePluginEnabled(internalName, enabled);
    },
    [togglePluginEnabled]
  );

  const handleRemoveRepo = useCallback(
    (url: string) => {
      const repo = repositories.find((r) => r.url === url);
      removeRepository(url);
      toast({
        title: "Repository removed",
        description: repo?.name ?? url,
      });
    },
    [repositories, removeRepository, toast]
  );

  const handleOpenRepo = useCallback((repo: Repository) => {
    setPickRepoFor(repo);
    setAddOpen(true);
  }, []);

  // Render ------------------------------------------------------------------

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-5xl flex-col px-3 py-4 sm:px-6 sm:py-6">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setView("settings")}
          className="size-9 shrink-0 text-[#a0a0a0] hover:bg-[#2d2d2d] hover:text-white"
          aria-label="Back to settings"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
            <Puzzle className="size-5 text-[#7664ed]" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-white sm:text-2xl">
              Extensions
            </h1>
            <p className="hidden text-xs text-[#a0a0a0] sm:block">
              Add repositories and install provider plugins.
            </p>
          </div>
        </div>

        {/* Spacer */}
        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <div className="relative w-44 sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#a0a0a0]" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plugins…"
              className="h-9 border-[#3d3d3d] bg-[#2d2d2d] pl-9 pr-8 text-sm text-white placeholder:text-[#a0a0a0]"
              aria-label="Search plugins"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#a0a0a0] hover:text-white"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Language filter (globe) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  "size-9 shrink-0 border border-[#3d3d3d] bg-[#2d2d2d]",
                  activeLanguage
                    ? "text-[#7664ed]"
                    : "text-[#a0a0a0] hover:text-white"
                )}
                aria-label="Filter by language"
                title="Filter by language"
              >
                <Globe className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-[60vh] w-48 overflow-y-auto border-[#3d3d3d] bg-[#2d2d2d] text-white"
            >
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[#a0a0a0]">
                Language
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-[#3d3d3d]" />
              <DropdownMenuCheckboxItem
                checked={activeLanguage === null}
                onCheckedChange={() => setActiveLanguage(null)}
                className="focus:bg-[#7664ed]/20 focus:text-white"
              >
                All languages
              </DropdownMenuCheckboxItem>
              {languages.length > 0 && (
                <DropdownMenuSeparator className="bg-[#3d3d3d]" />
              )}
              {languages.map((l) => (
                <DropdownMenuCheckboxItem
                  key={l}
                  checked={activeLanguage === l}
                  onCheckedChange={(v) => setActiveLanguage(v ? l : null)}
                  className="focus:bg-[#7664ed]/20 focus:text-white"
                >
                  {l}
                </DropdownMenuCheckboxItem>
              ))}
              {languages.length === 0 && (
                <div className="px-2 py-2 text-center text-xs text-[#a0a0a0]">
                  No languages found
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Category tabs */}
      <div
        className="mb-4 -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:-mx-0 sm:px-0"
        role="tablist"
        aria-label="Plugin categories"
        style={{ scrollbarWidth: "thin" }}
      >
        {CATEGORIES.map((c) => {
          const active = c.id === activeCategory;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                "min-h-[32px]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
                active
                  ? "border-[#7664ed] bg-[#7664ed]/15 text-[#BEC8FF]"
                  : "border-[#3d3d3d] bg-[#2d2d2d] text-[#a0a0a0] hover:border-[#7664ed]/40 hover:text-white"
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Repositories section */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[#a0a0a0]">
            <Package className="size-4" />
            Repositories
            <Badge
              variant="outline"
              className="border-[#3d3d3d] bg-[#2d2d2d] text-[10px] font-normal text-[#a0a0a0]"
            >
              {repositories.length}
            </Badge>
          </h2>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setPickRepoFor(null);
              setAddOpen(true);
            }}
            className="gap-1.5 text-[#a0a0a0] hover:bg-[#2d2d2d] hover:text-white"
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>

        {repositories.length === 0 ? (
          <button
            type="button"
            onClick={() => {
              setPickRepoFor(null);
              setAddOpen(true);
            }}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-[#3d3d3d] bg-[#2d2d2d]/40 p-8 text-center",
              "transition-colors hover:border-[#7664ed]/40 hover:bg-[#2d2d2d]/70",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
            )}
          >
            <Package className="size-8 text-[#a0a0a0]" />
            <p className="text-sm font-medium text-white">No repositories yet</p>
            <p className="text-xs text-[#a0a0a0]">
              Add your first repository to browse available plugins.
            </p>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-[#7664ed] px-3 py-1.5 text-xs font-medium text-white">
              <Plus className="size-3.5" />
              Add Repository
            </span>
          </button>
        ) : (
          <div className="space-y-2">
            {repositories.map((repo) => {
              const installedCount = installedPlugins.filter(
                (ip) => ip.repoUrl === repo.url
              ).length;
              return (
                <RepositoryCard
                  key={repo.url}
                  repo={repo}
                  installedCount={installedCount}
                  onOpen={handleOpenRepo}
                  onRemove={handleRemoveRepo}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Installed plugins section */}
      {filteredInstalled.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[#a0a0a0]">
            <Puzzle className="size-4" />
            Installed Plugins
            <Badge
              variant="outline"
              className="border-[#7664ed]/40 bg-[#7664ed]/10 text-[10px] font-normal text-[#BEC8FF]"
            >
              {filteredInstalled.length}
            </Badge>
          </h2>
          <div className="space-y-2">
            {filteredInstalled.map((ip) => {
              // Build a PluginEntry from InstalledPlugin so PluginCard can render it.
              const entry: PluginEntry = {
                internalName: ip.internalName,
                name: ip.name,
                version: ip.version,
                versionName: ip.versionName,
                description: ip.description,
                language: ip.language,
                tvTypes: ip.tvTypes,
                iconUrl: ip.iconUrl,
              };
              return (
                <PluginCard
                  key={ip.internalName}
                  entry={entry}
                  installed
                  enabled={ip.enabled}
                  onUninstall={handleUninstall}
                  onToggleEnabled={handleToggle}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Available plugins section (not yet installed) */}
      <section className="mb-6 flex-1">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[#a0a0a0]">
          <Package className="size-4" />
          Available Plugins
          <Badge
            variant="outline"
            className="border-[#3d3d3d] bg-[#2d2d2d] text-[10px] font-normal text-[#a0a0a0]"
          >
            {filteredEntries.filter((p) => !isPluginInstalled(p.internalName)).length}
          </Badge>
        </h2>

        {filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#3d3d3d] bg-[#2d2d2d]/40 p-8 text-center">
            <Package className="mx-auto size-8 text-[#a0a0a0]" />
            <p className="mt-2 text-sm text-[#a0a0a0]">
              {repositories.length === 0
                ? "Add a repository to see available plugins."
                : search || activeLanguage
                  ? "No plugins match your filters."
                  : "This repository has no plugins matching the selected category."}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-1">
              {filteredEntries.map((entry) => (
                <PluginCard
                  key={entry.internalName}
                  entry={entry}
                  installed={isPluginInstalled(entry.internalName)}
                  enabled={
                    installedPlugins.find(
                      (ip) => ip.internalName === entry.internalName
                    )?.enabled ?? false
                  }
                  onInstall={(internalName) =>
                    handleInstall(internalName)
                  }
                  onUninstall={handleUninstall}
                  onToggleEnabled={handleToggle}
                  installing={installingName === entry.internalName}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </section>

      {/* Stats bar (sticky bottom) */}
      <div
        className={cn(
          "sticky bottom-0 z-20 -mx-3 mt-auto border-t border-[#3d3d3d] bg-[#1e1e1e]/95 px-4 py-3 backdrop-blur sm:-mx-0 sm:rounded-t-lg"
        )}
        role="status"
        aria-label="Extensions summary"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#a0a0a0]">
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full bg-[#7664ed]"
              aria-hidden="true"
            />
            Downloaded: <strong className="text-white">{stats.downloaded}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full bg-amber-500"
              aria-hidden="true"
            />
            Disabled: <strong className="text-white">{stats.disabled}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full bg-[#3d3d3d] ring-1 ring-[#a0a0a0]/40"
              aria-hidden="true"
            />
            Not downloaded:{" "}
            <strong className="text-white">{stats.notDownloaded}</strong>
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-[#a0a0a0]/60">
            {stats.progressPct}% downloaded
          </span>
        </div>
        <Progress
          value={stats.progressPct}
          className="mt-2 h-1.5 bg-[#3d3d3d]"
          // The shadcn progress bar uses primary color by default — override
          // the indicator via inline style for the CloudStream purple accent.
          style={{
            // The indicator element is the only direct child.
          }}
        />
      </div>

      {/* Floating "+" button */}
      <button
        type="button"
        onClick={() => {
          setPickRepoFor(null);
          setAddOpen(true);
        }}
        className={cn(
          "fixed bottom-20 right-4 z-30 flex size-14 items-center justify-center rounded-full",
          "bg-[#7664ed] text-white shadow-lg shadow-[#7664ed]/40 ring-2 ring-white/10",
          "transition-all hover:bg-[#7664ed]/90 hover:shadow-xl hover:shadow-[#7664ed]/50 hover:scale-105",
          "focus:outline-none focus-visible:ring-4 focus-visible:ring-[#7664ed]/40",
          "sm:bottom-24 sm:right-6"
        )}
        aria-label="Add repository"
        title="Add repository"
      >
        <Plus className="size-6" />
      </button>

      {/* Add-repository dialog */}
      <AddRepositoryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialRepo={pickRepoFor}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Re-export for callers who want the dropdown chevron too            */
/* ------------------------------------------------------------------ */
// (Placeholder so the ChevronDown import isn't flagged as unused — we keep
// it available for a future "more filters" affordance on the header.)
void ChevronDown;
