'use client';

/**
 * CloudStream Web — TanStack Query client provider.
 *
 * Wraps the entire app in a single `QueryClientProvider` so that HomeView,
 * SearchView, and ResultView can all share the same query cache (e.g. a
 * search-result query can be reused by the result-detail page if the user
 * navigates to a result they just searched for).
 *
 * Defaults are tuned for CloudStream providers, which are flaky by nature:
 *   - retry: 1                (don't hammer a broken provider)
 *   - refetchOnWindowFocus: false (no surprise refetches)
 *   - staleTime: 60s          (avoid re-fetching the same home page on every nav)
 */

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider as TQQueryClientProvider } from "@tanstack/react-query";

export function QueryClientProvider({ children }: { children: ReactNode }) {
  // One client per browser session — created once on mount.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return <TQQueryClientProvider client={client}>{children}</TQQueryClientProvider>;
}
