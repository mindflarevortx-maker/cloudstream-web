/**
 * CloudStream Web — Global App Store (Zustand)
 * Manages: current view, current provider, settings, library (bookmarks + watch history)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TvType, SearchResponse, Episode, ExtractorLink } from "../types";

/** The 4 main views (mirrors the Android bottom nav) */
export type AppView = "home" | "search" | "library" | "settings" | "result" | "player";

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
        bookmarks: s.bookmarks,
        watchHistory: s.watchHistory,
        subscriptions: s.subscriptions,
      }),
    }
  )
);
