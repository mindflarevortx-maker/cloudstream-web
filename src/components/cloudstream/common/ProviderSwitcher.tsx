'use client';

import { useMemo } from "react";
import { Menu, ChevronDown, Check, Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
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
 * ProviderSwitcher — a compact "filter" button used on the CloudStream home
 * screen to pick which provider's catalog to display.
 *
 * Mirrors the Android `home_provider_filter.xml` affordance:
 *   - a black/dark pill button with a hamburger icon + the active provider's
 *     name (or "All Providers") + a chevron
 *   - a dropdown listing every registered provider plus an "All" sentinel
 *
 * Selecting a provider writes `settings.defaultProvider` to the global app
 * store; HomeView's TanStack Query key depends on that field, so the rails
 * refetch automatically.
 *
 * `variant="home"` (default) is the chunky black pill shown inline above the
 * home rails; `variant="compact"` is a slimmer version for tight spaces.
 */

const ALL_PROVIDERS_SENTINEL = "all";

export interface ProviderSwitcherProps {
  variant?: "home" | "compact";
  className?: string;
}

export function ProviderSwitcher({
  variant = "home",
  className,
}: ProviderSwitcherProps) {
  const defaultProvider = useAppStore((s) => s.settings.defaultProvider);
  const updateSettings = useAppStore((s) => s.updateSettings);

  // Providers register synchronously at module-import time, so a one-shot
  // memo is safe. We re-read on every render via the array identity to keep
  // hot-reloaded providers visible during dev.
  const providers = useMemo(() => APIHolder.getAllProviders(), []);

  const currentLabel =
    defaultProvider === ALL_PROVIDERS_SENTINEL
      ? "All Providers"
      : (APIHolder.getApiByName(defaultProvider)?.name ?? defaultProvider);

  const handlePick = (name: string) => {
    updateSettings({ defaultProvider: name });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch provider. Current: ${currentLabel}`}
          className={cn(
            "flex items-center gap-2 rounded-md border border-[#3d3d3d] bg-black/70 text-white backdrop-blur",
            "transition-colors hover:border-[#7664ed]/60 hover:bg-black/90",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/70",
            variant === "home"
              ? "px-4 py-2 text-sm font-semibold shadow-md shadow-black/40"
              : "px-3 py-1.5 text-xs font-medium",
            className
          )}
        >
          <Menu className="size-4 shrink-0 text-[#BEC8FF]" />
          <span className="max-w-[200px] truncate">{currentLabel}</span>
          <ChevronDown className="size-4 shrink-0 text-[#a0a0a0]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(
          "max-h-[60vh] w-[260px] overflow-y-auto",
          "border-[#3d3d3d] bg-[#2d2d2d] text-white"
        )}
      >
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[#a0a0a0]">
          Filter by Provider
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
                style={{ background: isActive ? "#7664ed" : "#3d3d3d" }}
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
  );
}
