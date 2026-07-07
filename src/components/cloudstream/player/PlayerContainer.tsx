'use client';

/**
 * PlayerContainer — the wrapper that mounts PlayerView as a fixed full-screen
 * overlay when the app store has an active episode.
 *
 * Responsibilities:
 *   - Render PlayerView only when `currentPlayingEpisode` is set (defensive
 *     guard so the inner component never mounts with no data).
 *   - Lock body scroll while the player is open and restore it on unmount.
 *   - Manage global keyboard shortcuts (space / arrows / f / m / Esc) — these
 *     are easier to handle here than inside PlayerView because PlayerView is
 *     mounted late and may unmount during source switches.
 *   - Clean up: detach listeners, restore body scroll, exit fullscreen if we
 *     entered it.
 *
 * Mirrors the Android key-event routing in `AbstractPlayerFragment.kt`
 * (worklog Task D3 — `dispatchKeyEvent` forwards to PlayerView's
 * `onKeyUp`/`onKeyLongPress`).
 */

import { useCallback, useEffect } from "react";
import { useAppStore } from "@/lib/cloudstream/store/app-store";
import { PlayerView } from "./PlayerView";

export function PlayerContainer() {
  const currentPlayingEpisode = useAppStore((s) => s.currentPlayingEpisode);
  const closePlayer = useAppStore((s) => s.closePlayer);
  const isOpen = currentPlayingEpisode !== null;

  // ---- Body scroll lock while open ----------------------------------
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // ---- Global keyboard shortcuts ------------------------------------
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      // If focus is inside an input / textarea / contenteditable, let it
      // handle the key.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // If a picker (Radix Sheet / Popover) is open, defer to it except for
      // Escape which Radix handles itself.
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          // Dispatch a custom event the PlayerView listens for. We avoid
          // reaching into the store from here to keep a clean separation.
          window.dispatchEvent(new CustomEvent("cs-player:toggle-play"));
          break;
        case "ArrowLeft":
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("cs-player:seek", { detail: -10 })
          );
          break;
        case "ArrowRight":
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("cs-player:seek", { detail: 10 })
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("cs-player:volume-delta", { detail: 0.1 })
          );
          break;
        case "ArrowDown":
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("cs-player:volume-delta", { detail: -0.1 })
          );
          break;
        case "f":
        case "F":
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("cs-player:toggle-fullscreen"));
          break;
        case "m":
        case "M":
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("cs-player:toggle-mute"));
          break;
        case "Escape":
          // Radix popovers/sheets handle their own Escape. Only close the
          // player when nothing else is intercepting.
          // We can detect "is the event default-prevented by a Radix layer?"
          // by checking if document.activeElement is a Radix dialog content.
          // Simpler: defer the close to the next tick so Radix gets first
          // crack at preventDefault.
          setTimeout(() => {
            if (
              document.fullscreenElement == null &&
              !document.querySelector("[role='dialog'][data-state='open']")
            ) {
              closePlayer();
            }
          }, 0);
          break;
        default:
          break;
      }
    },
    [closePlayer, isOpen]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [handleKey, isOpen]);

  // ---- Cleanup on unmount: exit fullscreen --------------------------
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
          /* ignore */
        });
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Video player"
    >
      <PlayerView />
    </div>
  );
}
