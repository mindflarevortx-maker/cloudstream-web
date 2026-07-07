'use client';

/**
 * CloudStream Web — ThemeProvider
 *
 * Applies the user's theme + accent color from `useAppStore.settings` to the
 * document at runtime. This mirrors the Android `SettingsGeneral` →
 * `applyThemes()` flow (worklog D6 §2 General) where the app reads
 * `theme_key` / `accent_color_key` from SharedPreferences and re-applies them
 * on every activity recreate.
 *
 * On web we don't have a Material3 theme engine, so we hand-roll a small
 * equivalent:
 *
 *   - The base background color is set on `document.body` so it fills the
 *     entire viewport (the html element already has the same color via the
 *     layout, but body is the safer target for runtime overrides).
 *   - A class is added to `document.body` so CSS can branch on theme
 *     (e.g. `theme-dark`, `theme-amoled`, `theme-dracula`, `theme-light`).
 *   - The accent color is exposed as the CSS custom property
 *     `--accent-color` on `:root` so any descendant can `var(--accent-color)`.
 *
 * The effect re-runs whenever the relevant settings fields change.
 *
 * Themes (mirroring the Android `AppTheme` enums, worklog D6 §2 General):
 *   - dark    → #1e1e1e   (Material3 dark surface)
 *   - amoled  → #000000   (true black for OLED screens)
 *   - dracula → #282a36   (Dracula color scheme)
 *   - light   → #ffffff   (light theme)
 */

import { useEffect } from "react";
import { useAppStore, AppSettings } from "@/lib/cloudstream/store/app-store";

const THEME_BG: Record<AppSettings["theme"], string> = {
  dark: "#1e1e1e",
  amoled: "#000000",
  dracula: "#282a36",
  light: "#ffffff",
};

const THEME_TEXT: Record<AppSettings["theme"], string> = {
  dark: "#ffffff",
  amoled: "#ffffff",
  dracula: "#f8f8f2",
  light: "#1e1e1e",
};

/** The previous theme class names we've added, so we can swap them out cleanly. */
const THEME_CLASSES = ["theme-dark", "theme-amoled", "theme-dracula", "theme-light"];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.settings.theme);
  const accentColor = useAppStore((s) => s.settings.accentColor);

  useEffect(() => {
    const body = document.body;
    if (!body) return;

    // Background + text color
    body.style.backgroundColor = THEME_BG[theme];
    body.style.color = THEME_TEXT[theme];

    // Swap theme class
    THEME_CLASSES.forEach((c) => body.classList.remove(c));
    body.classList.add(`theme-${theme}`);

    // Accent color on :root so any component can `var(--accent-color)`.
    const root = document.documentElement;
    root.style.setProperty("--accent-color", accentColor);

    // Also set a derived "accent foreground" — a high-contrast white for
    // text drawn on top of the accent color. The accent itself may be very
    // light (e.g. White, Banana) so we compute luminance to pick fg.
    root.style.setProperty("--accent-foreground", pickAccentFg(accentColor));

    // Sync the color-scheme property so native form controls (scrollbars,
    // date pickers) render in the right mode.
    root.style.colorScheme = theme === "light" ? "light" : "dark";
  }, [theme, accentColor]);

  return <>{children}</>;
}

/** Pick black or white as the foreground for a given accent hex. */
function pickAccentFg(hex: string): string {
  const c = hexToRgb(hex);
  if (!c) return "#ffffff";
  // Relative luminance (sRGB) per WCAG.
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return lum > 0.55 ? "#1e1e1e" : "#ffffff";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}
