'use client';

/**
 * CloudStream Web — AccentColorPicker
 *
 * Renders the 22 CloudStream accent colors as a grid of swatches.
 * Clicking a swatch writes it to `settings.accentColor` via `updateSettings`.
 *
 * Mirrors the Android `SettingsUI` → `accent_color` preference which opens a
 * `MaterialColorPicker` dialog populated from `Themes.md`'s accent table
 * (worklog D6 §2 UI / settings_ui.xml). On Android these are the entries in
 * `R.array.accent_color_values` paired with `R.array.accent_color_names`.
 *
 * The 22 accents (matching the CloudStream `Themes.md` spec):
 *   Normal (#7664ed) is the CloudStream brand purple and the default.
 *
 * Layout: a responsive grid (4 cols on mobile, 6 on tablet, 8 on desktop).
 * Each swatch is a 36×36 rounded square with a focus ring + checkmark when
 * selected. We compute a contrasting fg color (black/white) for the check.
 */

import { memo } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/cloudstream/store/app-store";

export interface AccentColor {
  /** Stable id used as the React key + the value stored in settings. */
  id: string;
  /** Display name shown in the title/aria-label. */
  name: string;
  /** Hex value (with leading #). */
  hex: string;
}

/**
 * The 22 CloudStream accent colors. Hex values are picked to match the
 * CloudStream `Themes.md` accent table as closely as possible; where the
 * upstream palette is ambiguous (e.g. "Party", "Monet"), we use the values
 * from the Android `Themes.md` reference.
 */
export const ACCENT_COLORS: AccentColor[] = [
  { id: "Normal",          name: "Normal",          hex: "#7664ed" },
  { id: "DandelionYellow", name: "Dandelion Yellow", hex: "#ffcb05" },
  { id: "CarnationPink",   name: "Carnation Pink",   hex: "#ff5e94" },
  { id: "Orange",          name: "Orange",           hex: "#ff8a3d" },
  { id: "DarkGreen",       name: "Dark Green",       hex: "#1b5e20" },
  { id: "Maroon",          name: "Maroon",           hex: "#7c1c1c" },
  { id: "NavyBlue",        name: "Navy Blue",        hex: "#1a237e" },
  { id: "Grey",            name: "Grey",             hex: "#757575" },
  { id: "White",           name: "White",            hex: "#ffffff" },
  { id: "CoolBlue",        name: "Cool Blue",        hex: "#3d9bff" },
  { id: "Brown",           name: "Brown",            hex: "#795548" },
  { id: "Blue",            name: "Blue",             hex: "#2196f3" },
  { id: "Red",             name: "Red",              hex: "#e53935" },
  { id: "Purple",          name: "Purple",           hex: "#9c27b0" },
  { id: "Green",           name: "Green",            hex: "#4caf50" },
  { id: "GreenApple",      name: "Green Apple",      hex: "#8bc34a" },
  { id: "Banana",          name: "Banana",           hex: "#ffe135" },
  { id: "Party",           name: "Party",            hex: "#e91e63" },
  { id: "Pink",            name: "Pink",             hex: "#ff80ab" },
  { id: "Lavender",        name: "Lavender",         hex: "#b39ddb" },
  { id: "Monet",           name: "Monet",            hex: "#5e72e4" },
  { id: "Monet2",          name: "Monet 2",          hex: "#7a5af8" },
];

function AccentColorPickerImpl() {
  const accentColor = useAppStore((s) => s.settings.accentColor);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <div
      role="radiogroup"
      aria-label="Accent color"
      className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8"
    >
      {ACCENT_COLORS.map((c) => {
        const selected = c.hex.toLowerCase() === accentColor.toLowerCase();
        const fg = contrastFg(c.hex);
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.name}
            title={c.name}
            onClick={() => updateSettings({ accentColor: c.hex })}
            className={cn(
              "group relative flex aspect-square items-center justify-center rounded-md ring-1 transition-transform",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e1e]",
              selected
                ? "scale-105 ring-2 ring-white/80"
                : "ring-inset ring-black/20 hover:scale-105"
            )}
            style={{ backgroundColor: c.hex }}
          >
            {selected && (
              <Check
                className="size-4 drop-shadow"
                style={{ color: fg }}
                aria-hidden="true"
              />
            )}
            {/* Always-visible name tooltip via title; sr-only for AT */}
            <span className="sr-only">{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export const AccentColorPicker = memo(AccentColorPickerImpl);

/** White on dark accents, black on light accents (WCAG luminance threshold). */
function contrastFg(hex: string): string {
  const c = hexToRgb(hex);
  if (!c) return "#ffffff";
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
