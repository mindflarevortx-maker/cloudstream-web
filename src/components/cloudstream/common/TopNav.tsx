'use client';

import { useMemo, useState } from "react";
import {
  Home as HomeIcon,
  Search as SearchIcon,
  Library as LibraryIcon,
  Settings as SettingsIcon,
  Puzzle as PuzzleIcon,
  ChevronDown,
  Check,
  Cloud,
  Layers,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore, AppView } from "@/lib/cloudstream/store/app-store";
import { APIHolder } from "@/lib/cloudstream/MainAPI";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

/**
 * TopNav — the CloudStream TV-layout top navigation bar.
 *
 * Layout (left → right):
 *   [CloudStream logo]  [Home] [Search] [Library] [Settings]    [provider switcher ▾]
 *
 * Mirrors the Android TV `activity_main_tv.xml` top region — though on Android the
 * nav lives in a left rail (NavigationRailView). On the web we use a top bar
 * because that's the standard expectation for desktop/TV browsers.
 *
 * Active button: highlighted with the CloudStream purple accent (#7664ed).
 * Provider switcher: lists all providers from APIHolder.getAllProviders()
 * plus an "All providers" sentinel. Selecting one calls
 * `useAppStore.updateSettings({ defaultProvider })`.
 */

const NAV_ITEMS: { view: AppView; label: string; Icon: typeof HomeIcon }[] = [
  { view: "home", label: "Home", Icon: HomeIcon },
  { view: "search", label: "Search", Icon: SearchIcon },
  { view: "library", label: "Library", Icon: LibraryIcon },
  { view: "extensions", label: "Extensions", Icon: PuzzleIcon },
  { view: "settings", label: "Settings", Icon: SettingsIcon },
];

const ALL_PROVIDERS_SENTINEL = "all";

export function TopNav() {
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const defaultProvider = useAppStore((s) => s.settings.defaultProvider);
  const updateSettings = useAppStore((s) => s.updateSettings);

  // Snapshot the provider list once on mount — providers register synchronously
  // at import time, so this is safe. We re-read on every render via a memo so
  // hot-reloaded providers show up too.
  const providers = useMemo(() => APIHolder.getAllProviders(), []);

  const currentProviderLabel =
    defaultProvider === ALL_PROVIDERS_SENTINEL
      ? "All Providers"
      : (APIHolder.getApiByName(defaultProvider)?.name ?? defaultProvider);

  const handlePick = (name: string) => {
    updateSettings({ defaultProvider: name });
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b border-[#3d3d3d]",
        "bg-[#1e1e1e]/95 backdrop-blur supports-[backdrop-filter]:bg-[#1e1e1e]/80"
      )}
      role="banner"
    >
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-4 sm:gap-4">
        {/* Brand / logo (left) */}
        <button
          type="button"
          onClick={() => setView("home")}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-md px-2 py-1",
            "transition-colors hover:bg-white/5",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
          )}
          aria-label="CloudStream home"
        >
          <span
            className="flex size-8 items-center justify-center rounded-md bg-[#7664ed] shadow-md shadow-[#7664ed]/30"
            aria-hidden="true"
          >
            <Cloud className="size-5 text-white" />
          </span>
          <span className="hidden text-lg font-semibold tracking-tight text-white sm:inline">
            Cloud<span className="text-[#7664ed]">Stream</span>
          </span>
        </button>

        {/* Nav buttons (left/center) */}
        <nav
          className="flex items-center gap-1"
          role="navigation"
          aria-label="Primary"
        >
          {NAV_ITEMS.map(({ view, label, Icon }) => {
            const active = currentView === view;
            return (
              <button
                key={view}
                type="button"
                onClick={() => setView(view)}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                title={label}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  "min-h-[40px] min-w-[40px] justify-center sm:min-w-[auto]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
                  active
                    ? "bg-[#7664ed]/15 text-[#BEC8FF] shadow-inner shadow-[#7664ed]/10"
                    : "text-[#a0a0a0] hover:bg-white/5 hover:text-white"
                )}
              >
                <Icon className="size-5" />
                <span className="hidden md:inline">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Provider switcher (right) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex max-w-[260px] items-center gap-2 rounded-md border border-[#3d3d3d] bg-[#2d2d2d] px-3 py-1.5 text-sm",
                "text-white transition-colors hover:border-[#7664ed]/50 hover:bg-[#333] ",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
              )}
              aria-label="Switch provider"
            >
              <Layers className="size-4 shrink-0 text-[#a0a0a0]" />
              <span className="truncate font-medium">{currentProviderLabel}</span>
              <ChevronDown className="size-4 shrink-0 text-[#a0a0a0]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-[60vh] w-[260px] overflow-y-auto border-[#3d3d3d] bg-[#2d2d2d] text-white"
          >
            <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[#a0a0a0]">
              Default Provider
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[#3d3d3d]" />

            {/* All providers option */}
            <DropdownMenuItem
              onSelect={() => handlePick(ALL_PROVIDERS_SENTINEL)}
              className="gap-2 focus:bg-[#7664ed]/20 focus:text-white"
            >
              <Layers className="size-4 text-[#7664ed]" />
              <span className="flex-1">All Providers</span>
              {defaultProvider === ALL_PROVIDERS_SENTINEL && (
                <Check className="size-4 text-[#7664ed]" />
              )}
            </DropdownMenuItem>

            {providers.length > 0 && (
              <DropdownMenuSeparator className="bg-[#3d3d3d]" />
            )}

            {/* One item per registered provider */}
            {providers.map((p) => {
              const isActive = defaultProvider === p.name;
              return (
                <DropdownMenuItem
                  key={p.name}
                  onSelect={() => handlePick(p.name)}
                  className="gap-2 focus:bg-[#7664ed]/20 focus:text-white"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      background: isActive ? "#7664ed" : "#3d3d3d",
                    }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  {isActive && <Check className="size-4 text-[#7664ed]" />}
                </DropdownMenuItem>
              );
            })}

            {providers.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-[#a0a0a0]">
                No providers registered.
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
