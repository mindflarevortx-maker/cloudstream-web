'use client';

import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import { TopNav } from "./TopNav";

/**
 * AppShell — top-level layout shell for the CloudStream TV-layout UI.
 *
 * Renders:
 *   - The sticky TopNav (logo + 4 nav buttons + provider switcher)
 *   - A main content area populated by `children` — the caller (page.tsx) is
 *     responsible for switching on `useAppStore.currentView` and rendering the
 *     matching view (HomeView / SearchView / LibraryView / SettingsView /
 *     ResultView). The player is rendered as a sibling overlay by
 *     `<PlayerContainer>` in page.tsx, not inside this shell.
 *
 * The whole shell is wrapped in a `min-h-screen flex flex-col` so the
 * footer sticks to the bottom of the viewport when content is short
 * and gets pushed down naturally when content overflows.
 *
 * The background is the CloudStream Material3 Dark `#1e1e1e`. The runtime
 * theme (amoled / dracula / light) is applied to `document.body` by the
 * `<ThemeProvider>` in page.tsx, so this shell intentionally does not hard-
 * code theme colors beyond the Material3 dark defaults — those defaults are
 * overridden at runtime by the ThemeProvider's body style.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // Subscribe to currentView so the shell re-renders on navigation even
  // though the actual view switching happens in the caller. This keeps the
  // TopNav's active-state highlight in sync without prop-drilling.
  useAppStore((s) => s.currentView);

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-[#1e1e1e] text-white",
        "antialiased"
      )}
    >
      <TopNav />

      <main
        id="main-content"
        role="main"
        className="flex-1 pb-12"
        // Skip-link target
        tabIndex={-1}
      >
        {children}
      </main>

      {/* Minimal footer so the layout looks finished. */}
      <footer
        className={cn(
          "mt-auto border-t border-[#3d3d3d] bg-[#1e1e1e]",
          "px-4 py-3 text-center text-xs text-[#a0a0a0]"
        )}
        role="contentinfo"
      >
        CloudStream Web · TV Layout · Material3 Dark
      </footer>
    </div>
  );
}
