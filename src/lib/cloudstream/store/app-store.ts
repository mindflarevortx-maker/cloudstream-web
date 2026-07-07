/**
 * CloudStream Web — Global App Store (Zustand)
 * Manages: current view, current provider, settings, library (bookmarks + watch history)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TvType, SearchResponse, Episode, ExtractorLink } from "../types";
import { APIHolder } from "../MainAPI";

/** The main views (mirrors the Android bottom nav + extra screens) */
export type AppView = "home" | "search" | "library" | "settings" | "extensions" | "result" | "player";

export interface BookmarkEntry {
  searchResponse: SearchResponse;
  addedAt: number;
}

export interface WatchHistoryEntry {
  searchResponse: SearchResponse;
  episode: Episode;
  position: number; // seconds
  duration: number; // seconds
  watchedAt: number;
}

export interface AppSettings {
  defaultProvider: string;
  preferredLanguages: string[];
  theme: "dark" | "light" | "amoled" | "dracula";
  accentColor: string;
  subtitleFont: string;
  subtitleSize: number;
  subtitleColor: string;
  subtitleBackground: string;
  subtitleOutline: string;
  playerAutoPlay: boolean;
  playerSkipIntro: boolean;
  playerSkipOutro: boolean;
  playerDefaultQuality: string;
  parallelDownloads: number;
  enableSync: boolean;
  enableSubtitles: boolean;
  preferredSubtitleLanguages: string[];
  layout: "tv" | "mobile";
}

/** Provider preferences (mirrors Android Settings → Providers) */
export interface ProviderPreferences {
  /** Languages to show providers for (ISO 639-1: en, hi, ar, es, etc.) */
  languages: string[];
  /** Preferred media types (Movie, TvSeries, Anime, etc.) */
  preferredMedia: string[];
  /** Show dub/sub badges for anime */
  showDubSub: boolean;
  /** Enable NSFW providers */
  enableNsfw: boolean;
}

interface AppState {
  // Navigation
  currentView: AppView;
  currentResultUrl: string | null;
  currentResultApiName: string | null;
  currentPlayingEpisode: Episode | null;
  currentPlayingLinks: ExtractorLink[] | null;
  currentPlayingMetadata: SearchResponse | null;
  searchQuery: string;

  // Settings
  settings: AppSettings;

  // Provider management
  /** Names of providers that are enabled (default: all built-in) */
  enabledProviders: string[];
  /** Which provider's catalog to show on home ("all" = merge all enabled) */
  currentHomeProvider: string;
  /** Provider preference filters (language, media type, NSFW) */
  providerPreferences: ProviderPreferences;

  // Library
  bookmarks: BookmarkEntry[];
  watchHistory: WatchHistoryEntry[];
  subscriptions: SearchResponse[];

  // Actions
  setView: (view: AppView) => void;
  openResult: (url: string, apiName: string) => void;
  openPlayer: (episode: Episode, links: ExtractorLink[], metadata: SearchResponse) => void;
  closePlayer: () => void;
  setSearchQuery: (q: string) => void;

  updateSettings: (patch: Partial<AppSettings>) => void;

  // Provider actions
  toggleProvider: (name: string) => void;
  enableAllProviders: () => void;
  disableAllProviders: () => void;
  setEnabledProviders: (names: string[]) => void;
  setCurrentHomeProvider: (name: string) => void;
  updateProviderPreferences: (patch: Partial<ProviderPreferences>) => void;

  toggleBookmark: (sr: SearchResponse) => void;
  isBookmarked: (url: string) => boolean;
  clearBookmarks: () => void;

  recordWatch: (entry: Omit<WatchHistoryEntry, "watchedAt">) => void;
  clearWatchHistory: () => void;

  toggleSubscription: (sr: SearchResponse) => void;
  isSubscribed: (url: string) => boolean;
}

const defaultSettings: AppSettings = {
  defaultProvider: "all",
  preferredLanguages: ["en"],
  theme: "dark",
  accentColor: "#7664ed",
  subtitleFont: "Inter",
  subtitleSize: 18,
  subtitleColor: "#ffffff",
  subtitleBackground: "#000000",
  subtitleOutline: "#000000",
  playerAutoPlay: true,
  playerSkipIntro: true,
  playerSkipOutro: true,
  playerDefaultQuality: "auto",
  parallelDownloads: 3,
  enableSync: true,
  enableSubtitles: true,
  preferredSubtitleLanguages: ["en"],
  layout: "tv",
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentView: "home",
      currentResultUrl: null,
      currentResultApiName: null,
      currentPlayingEpisode: null,
      currentPlayingLinks: null,
      currentPlayingMetadata: null,
      searchQuery: "",

      settings: defaultSettings,

      // Provider management — default: all built-in providers enabled, "all" selected
      enabledProviders: [], // empty = "all enabled" (resolved at runtime against APIHolder)
      currentHomeProvider: "all",
      providerPreferences: {
        languages: ["en"],
        preferredMedia: ["Movie", "TvSeries", "Anime", "Live"],
        showDubSub: true,
        enableNsfw: false,
      },

      bookmarks: [],
      watchHistory: [],
      subscriptions: [],

      setView: (view) => set({ currentView: view }),

      openResult: (url, apiName) =>
        set({
          currentView: "result",
          currentResultUrl: url,
          currentResultApiName: apiName,
        }),

      openPlayer: (episode, links, metadata) =>
        set({
          currentView: "player",
          currentPlayingEpisode: episode,
          currentPlayingLinks: links,
          currentPlayingMetadata: metadata,
        }),

      closePlayer: () =>
        set({
          currentView: "result",
          currentPlayingEpisode: null,
          currentPlayingLinks: null,
          currentPlayingMetadata: null,
        }),

      setSearchQuery: (q) => set({ searchQuery: q }),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      // Provider actions
      toggleProvider: (name) =>
        set((s) => {
          const allNames = APIHolder.getAllProviders().map((p) => p.name);
          const current = s.enabledProviders.length === 0 ? allNames : s.enabledProviders;
          const exists = current.includes(name);
          return {
            enabledProviders: exists
              ? current.filter((n) => n !== name)
              : [...current, name],
          };
        }),

      enableAllProviders: () => set({ enabledProviders: [] }), // empty = all

      disableAllProviders: () => set({ enabledProviders: ["__none__"] }), // sentinel

      setEnabledProviders: (names) => set({ enabledProviders: names }),

      setCurrentHomeProvider: (name) => set({ currentHomeProvider: name }),

      updateProviderPreferences: (patch) =>
        set((s) => ({
          providerPreferences: { ...s.providerPreferences, ...patch },
        })),

      toggleBookmark: (sr) =>
        set((s) => {
          const exists = s.bookmarks.some((b) => b.searchResponse.url === sr.url);
          return {
            bookmarks: exists
              ? s.bookmarks.filter((b) => b.searchResponse.url !== sr.url)
              : [...s.bookmarks, { searchResponse: sr, addedAt: Date.now() }],
          };
        }),

      isBookmarked: (url) => get().bookmarks.some((b) => b.searchResponse.url === url),

      clearBookmarks: () => set({ bookmarks: [] }),

      recordWatch: (entry) =>
        set((s) => ({
          watchHistory: [
            { ...entry, watchedAt: Date.now() },
            ...s.watchHistory.filter(
              (w) =>
                !(
                  w.searchResponse.url === entry.searchResponse.url &&
                  w.episode.episode === entry.episode.episode &&
                  w.episode.season === entry.episode.season
                )
            ),
          ].slice(0, 200),
        })),

      clearWatchHistory: () => set({ watchHistory: [] }),

      toggleSubscription: (sr) =>
        set((s) => {
          const exists = s.subscriptions.some((sub) => sub.url === sr.url);
          return {
            subscriptions: exists
              ? s.subscriptions.filter((sub) => sub.url !== sr.url)
              : [...s.subscriptions, sr],
          };
        }),

      isSubscribed: (url) => get().subscriptions.some((s) => s.url === url),
    }),
    {
      name: "cloudstream-web-store",
      partialize: (s) => ({
        settings: s.settings,
        enabledProviders: s.enabledProviders,
        currentHomeProvider: s.currentHomeProvider,
        providerPreferences: s.providerPreferences,
        bookmarks: s.bookmarks,
        watchHistory: s.watchHistory,
        subscriptions: s.subscriptions,
      }),
    }
  )
);

/**
 * Resolve the actual list of enabled MainAPI providers from the store state.
 * - If `enabledProviders` is empty, all registered providers are enabled.
 * - If it contains "__none__" sentinel, no providers are enabled.
 * - Otherwise, only providers whose name is in the array are enabled.
 *
 * Also applies the `providerPreferences` filters (language + NSFW).
 */
export function getEnabledApiProviders(state: AppState): typeof APIHolder.providers {
  const allProviders = APIHolder.getAllProviders();
  const { enabledProviders, providerPreferences } = state;

  // Step 1: resolve enabled set
  let enabled: typeof APIHolder.providers;
  if (enabledProviders.length === 0) {
    enabled = allProviders;
  } else if (enabledProviders.includes("__none__")) {
    enabled = [];
  } else {
    enabled = allProviders.filter((p) => enabledProviders.includes(p.name));
  }

  // Step 2: filter by language preference (empty languages = all)
  if (providerPreferences.languages.length > 0) {
    enabled = enabled.filter(
      (p) =>
        providerPreferences.languages.includes(p.lang) ||
        providerPreferences.languages.length === 0
    );
  }

  // Step 3: filter out NSFW providers if not enabled
  if (!providerPreferences.enableNsfw) {
    enabled = enabled.filter((p) => !p.supportedTypes?.includes(TvType.NSFW));
  }

  return enabled;
}

/**
 * Get the single selected home provider (or null if "all" is selected).
 */
export function getHomeProvider(state: AppState): typeof APIHolder.providers[0] | null {
  if (state.currentHomeProvider === "all") return null;
  return APIHolder.getApiByName(state.currentHomeProvider);
}
