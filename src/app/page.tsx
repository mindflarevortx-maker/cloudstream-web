'use client';

import { useEffect } from "react";

import { useAppStore } from "@/lib/cloudstream/store/app-store";
import { initProviders } from "@/lib/cloudstream/providers";
import { initExtractors } from "@/lib/cloudstream/extractors";

import { AppShell } from "@/components/cloudstream/common/AppShell";
import { HomeView } from "@/components/cloudstream/home/HomeView";
import { SearchView } from "@/components/cloudstream/search/SearchView";
import { ResultView } from "@/components/cloudstream/result/ResultView";
import { PlayerContainer } from "@/components/cloudstream/player/PlayerContainer";
import { LibraryView } from "@/components/cloudstream/library/LibraryView";
import { SettingsView } from "@/components/cloudstream/settings/SettingsView";
import { ThemeProvider } from "@/components/cloudstream/settings/ThemeProvider";

/**
 * CloudStream Web — main entry point.
 *
 * Wires the global app store to the view switcher, boots the provider +
 * extractor registries on mount, and wraps the whole shell in a
 * `<ThemeProvider>` so the user's theme + accent color are applied to the
 * document before any view renders.
 *
 * The view router mirrors the Android bottom-nav / nav-graph model: a single
 * `currentView` field on the store decides which view renders inside the
 * `AppShell`. The `PlayerContainer` overlays the player on top of the shell
 * whenever `currentPlayingEpisode` is set.
 */
export default function Home() {
  const currentView = useAppStore((s) => s.currentView);

  useEffect(() => {
    // Boot the extension + extractor registries. Both init functions are
    // idempotent (guarded by a module-level `initialized` flag), so calling
    // them on every mount is safe.
    initProviders();
    initExtractors();
  }, []);

  return (
    <ThemeProvider>
      <AppShell>
        {currentView === "home" && <HomeView />}
        {currentView === "search" && <SearchView />}
        {currentView === "result" && <ResultView />}
        {currentView === "library" && <LibraryView />}
        {currentView === "settings" && <SettingsView />}
      </AppShell>
      <PlayerContainer />
    </ThemeProvider>
  );
}
