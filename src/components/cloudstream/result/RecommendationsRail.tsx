'use client';

import { HomeRail } from "../home/HomeRail";
import type { SearchResponse } from "@/lib/cloudstream/types";

/**
 * RecommendationsRail — wraps HomeRail but sources its items from
 * `LoadResponse.recommendations` (the "More like this" rail that providers
 * return at the bottom of a title-detail page).
 *
 * Mirrors the Android `result_recommendations.xml` block, which is a
 * horizontally-scrollable RecyclerView of `HomeResultGrid` items bound to
 * `LoadResponse.recommendations`.
 *
 * If the list is empty, this component renders nothing (the rail is hidden).
 */
export interface RecommendationsRailProps {
  items: SearchResponse[];
  title?: string;
}

export function RecommendationsRail({
  items,
  title = "More like this",
}: RecommendationsRailProps) {
  if (!items || items.length === 0) return null;
  return <HomeRail title={title} items={items} />;
}
