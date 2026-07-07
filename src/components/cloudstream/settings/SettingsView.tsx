'use client';

/**
 * CloudStream Web — SettingsView
 *
 * The Settings page. Mirrors the Android `SettingsFragment` hub + the six
 * nested `BasePreferenceFragmentCompat` screens (worklog D6 §1-§3):
 *   - General    → SettingsGeneral.kt (theme, accent, layout, languages, DNS…)
 *   - Player     → SettingsPlayer.kt  (autoplay, skip intro/outro, quality…)
 *   - Sync       → SettingsAccount.kt (AniList/MAL/LocalList login + logout)
 *   - Subtitles  → SubtitleSettings    (enable, languages, online providers)
 *   - Downloads  → SettingsGeneral §Downloads (parallel slider, path info)
 *   - Extensions → ExtensionsFragment  (provider toggles, add repository)
 *   - About      → SettingsUpdates §About (version, GitHub, license, credits)
 *
 * On web we collapse all of these into one scrollable page with collapsible
 * sections (shadcn `<Collapsible>`), since a separate-fragment-per-category
 * navigation model doesn't translate well to a single-page web app.
 *
 * Each setting reads from `useAppStore.settings` and writes via
 * `updateSettings(...)`. The store is persisted to localStorage by Zustand
 * `persist`, mirroring SharedPreferences on Android.
 *
 * Sync-account login state and per-provider enable/disable flags also live in
 * localStorage (keys: `cloudstream-sync-accounts`, `cloudstream-disabled-providers`,
 * `cloudstream-repos`) — there is no real OAuth backend wired up yet; the
 * login buttons just record a stub account locally so the Library view's
 * "Sync Library" tab has something to show.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Settings as SettingsIcon,
  ChevronDown,
  Sun, Moon, Monitor, Github, FileText, Users, Info,
  LogIn, LogOut, Plus, Trash2, ExternalLink, Palette,
  Play, Captions, Download, Library, RefreshCw, Languages, Tv, Smartphone,
  ShieldCheck, Wifi,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore, AppSettings } from "@/lib/cloudstream/store/app-store";
import { APIHolder } from "@/lib/cloudstream/MainAPI";
import { SyncIdName } from "@/lib/cloudstream/types";
import { useToast } from "@/hooks/use-toast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccentColorPicker } from "./AccentColorPicker";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const APP_VERSION = "1.0.0-web";
const GITHUB_URL = "https://github.com/recloudstream/cloudstream";
const LICENSE = "GPLv3";

const THEME_OPTIONS: { value: AppSettings["theme"]; label: string; Icon: typeof Moon }[] = [
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "amoled", label: "AMOLED", Icon: Moon },
  { value: "dracula", label: "Dracula", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
];

const LAYOUT_OPTIONS: { value: AppSettings["layout"]; label: string; Icon: typeof Tv }[] = [
  { value: "tv", label: "TV", Icon: Tv },
  { value: "mobile", label: "Mobile", Icon: Smartphone },
];

const QUALITY_OPTIONS = ["auto", "1080", "720", "480", "360"];

const SUBTITLE_FONTS = ["Inter", "Roboto", "Arial", "Helvetica", "Georgia", "Courier New", "Comic Sans MS"];

/** Common UI languages — mirrors a subset of CloudStream's 58-language table. */
const UI_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "ru", label: "Русский" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" },
  { code: "tr", label: "Türkçe" },
  { code: "pl", label: "Polski" },
  { code: "nl", label: "Nederlands" },
];

const SUBTITLE_LANGUAGES = UI_LANGUAGES;

/* ------------------------------------------------------------------ */
/*  localStorage-backed sync account store                             */
/* ------------------------------------------------------------------ */

const SYNC_ACCOUNTS_KEY = "cloudstream-sync-accounts";
const DISABLED_PROVIDERS_KEY = "cloudstream-disabled-providers";
const REPOS_KEY = "cloudstream-repos";

export interface SyncAccount {
  provider: SyncIdName;
  username: string;
  loggedInAt: number;
}

function readSyncAccounts(): SyncAccount[] {
  try {
    const raw = localStorage.getItem(SYNC_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSyncAccounts(accounts: SyncAccount[]): void {
  try {
    localStorage.setItem(SYNC_ACCOUNTS_KEY, JSON.stringify(accounts));
    // Notify other components (Library) that the account list changed.
    window.dispatchEvent(new CustomEvent("cloudstream-sync-accounts-changed"));
  } catch (e) {
    console.warn("[Settings] could not persist sync accounts:", e);
  }
}

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export function SettingsView() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-[#2d2d2d] ring-1 ring-[#3d3d3d]">
          <SettingsIcon className="size-5 text-[#7664ed]" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
          <p className="text-sm text-[#a0a0a0]">
            Configure providers, player, sync accounts, subtitles and more.
          </p>
        </div>
      </header>

      <div className="space-y-3">
        <GeneralSection defaultOpen />
        <PlayerSection />
        <SyncSection />
        <SubtitlesSection />
        <DownloadsSection />
        <ExtensionsSection />
        <AboutSection />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible section wrapper                                        */
/* ------------------------------------------------------------------ */

interface SectionProps {
  title: string;
  description?: string;
  Icon: typeof SettingsIcon;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function SettingsSection({
  title,
  description,
  Icon,
  defaultOpen = false,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border border-[#3d3d3d] bg-[#2d2d2d]/60"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
            "hover:bg-[#3d3d3d]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60",
            "min-h-[44px]"
          )}
          aria-expanded={open}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e] ring-1 ring-[#3d3d3d]">
            <Icon className="size-4 text-[#7664ed]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-white">{title}</h2>
            {description && (
              <p className="truncate text-xs text-[#a0a0a0]">{description}</p>
            )}
          </div>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-[#a0a0a0] transition-transform",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-5 border-t border-[#3d3d3d]/60 px-4 py-5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable rows                                                      */
/* ------------------------------------------------------------------ */

function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-white">
          {label}
        </Label>
        {description && (
          <p className="mt-0.5 text-xs text-[#a0a0a0]">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  General section                                                    */
/* ------------------------------------------------------------------ */

function GeneralSection({ defaultOpen }: { defaultOpen?: boolean }) {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const providers = useMemo(() => APIHolder.getAllProviders(), []);
  const providerOptions = useMemo(() => {
    const opts = [{ value: "all", label: "All providers" }];
    for (const p of providers) opts.push({ value: p.name, label: p.name });
    return opts;
  }, [providers]);

  return (
    <SettingsSection
      title="General"
      description="Theme, accent, layout, default provider, languages"
      Icon={SettingsIcon}
      defaultOpen={defaultOpen}
    >
      {/* Theme */}
      <Row label="Theme" description="Choose the base color scheme">
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map((opt) => {
            const active = settings.theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateSettings({ theme: opt.value })}
                aria-pressed={active}
                className={cn(
                  "flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-[#7664ed] bg-[#7664ed]/15 text-white"
                    : "border-[#3d3d3d] bg-[#1e1e1e] text-[#a0a0a0] hover:border-[#7664ed]/50 hover:text-white"
                )}
              >
                <opt.Icon className="size-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </Row>

      {/* Accent color */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Palette className="size-4 text-[#7664ed]" />
          <Label className="text-sm font-medium text-white">Accent color</Label>
          <Badge variant="secondary" className="ml-1 font-mono text-[10px]">
            {settings.accentColor}
          </Badge>
        </div>
        <p className="text-xs text-[#a0a0a0]">
          22 CloudStream accent colors. Applied as the app&apos;s highlight color.
        </p>
        <AccentColorPicker />
      </div>

      {/* Layout */}
      <Row label="Layout" description="TV layout (rails) or mobile layout (grid)">
        <div className="flex gap-2">
          {LAYOUT_OPTIONS.map((opt) => {
            const active = settings.layout === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateSettings({ layout: opt.value })}
                aria-pressed={active}
                className={cn(
                  "flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-[#7664ed] bg-[#7664ed]/15 text-white"
                    : "border-[#3d3d3d] bg-[#1e1e1e] text-[#a0a0a0] hover:border-[#7664ed]/50 hover:text-white"
                )}
              >
                <opt.Icon className="size-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </Row>

      {/* Default provider */}
      <Row label="Default provider" description="Provider used for the home page">
        <Select
          value={settings.defaultProvider}
          onValueChange={(v) => updateSettings({ defaultProvider: v })}
        >
          <SelectTrigger className="w-[200px] bg-[#1e1e1e]">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent className="max-h-72 bg-[#2d2d2d]">
            {providerOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {/* Preferred languages (multi-select chips) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Languages className="size-4 text-[#7664ed]" />
          <Label className="text-sm font-medium text-white">Preferred languages</Label>
        </div>
        <p className="text-xs text-[#a0a0a0]">
          Providers whose language matches one of these will be preferred in
          search and home results.
        </p>
        <MultiLanguageChips
          selected={settings.preferredLanguages}
          onChange={(langs) => updateSettings({ preferredLanguages: langs })}
        />
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Player section                                                     */
/* ------------------------------------------------------------------ */

function PlayerSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <SettingsSection
      title="Player"
      description="Autoplay, skip buttons, default quality"
      Icon={Play}
    >
      <Row
        label="Autoplay"
        description="Start playing the next episode automatically"
        htmlFor="autoplay"
      >
        <Switch
          id="autoplay"
          checked={settings.playerAutoPlay}
          onCheckedChange={(v) => updateSettings({ playerAutoPlay: v })}
        />
      </Row>

      <Row label="Skip intro" description="Show a skip-intro button when available">
        <Switch
          checked={settings.playerSkipIntro}
          onCheckedChange={(v) => updateSettings({ playerSkipIntro: v })}
        />
      </Row>

      <Row label="Skip outro" description="Show a skip-outro button when available">
        <Switch
          checked={settings.playerSkipOutro}
          onCheckedChange={(v) => updateSettings({ playerSkipOutro: v })}
        />
      </Row>

      <Row label="Default quality" description="Preferred video quality">
        <Select
          value={settings.playerDefaultQuality}
          onValueChange={(v) => updateSettings({ playerDefaultQuality: v })}
        >
          <SelectTrigger className="w-[140px] bg-[#1e1e1e]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#2d2d2d]">
            {QUALITY_OPTIONS.map((q) => (
              <SelectItem key={q} value={q}>
                {q === "auto" ? "Auto" : `${q}p`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Subtitle font" description="Font family for subtitle rendering">
        <Select
          value={settings.subtitleFont}
          onValueChange={(v) => updateSettings({ subtitleFont: v })}
        >
          <SelectTrigger className="w-[180px] bg-[#1e1e1e]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#2d2d2d]">
            {SUBTITLE_FONTS.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {/* Subtitle size slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-white">Subtitle size</Label>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {settings.subtitleSize}px
          </Badge>
        </div>
        <Slider
          min={12}
          max={48}
          step={1}
          value={[settings.subtitleSize]}
          onValueChange={([v]) => updateSettings({ subtitleSize: v })}
          className="py-2"
        />
      </div>

      {/* Subtitle color / background pickers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row label="Subtitle color">
          <ColorInput
            value={settings.subtitleColor}
            onChange={(v) => updateSettings({ subtitleColor: v })}
            ariaLabel="Subtitle text color"
          />
        </Row>
        <Row label="Subtitle background">
          <ColorInput
            value={settings.subtitleBackground}
            onChange={(v) => updateSettings({ subtitleBackground: v })}
            ariaLabel="Subtitle background color"
          />
        </Row>
      </div>

      {/* Live preview */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-white">Preview</Label>
        <div className="flex items-center justify-center rounded-md bg-black p-6">
          <span
            className="rounded px-2 py-1 text-center"
            style={{
              color: settings.subtitleColor,
              backgroundColor: settings.subtitleBackground,
              fontFamily: settings.subtitleFont,
              fontSize: `${settings.subtitleSize}px`,
            }}
          >
            The quick brown fox jumps over the lazy dog.
          </span>
        </div>
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Sync section                                                       */
/* ------------------------------------------------------------------ */

function SyncSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<SyncAccount[]>([]);

  // Load accounts from localStorage on mount + whenever the custom event
  // fires (e.g. when logout happens elsewhere).
  useEffect(() => {
    const refresh = () => setAccounts(readSyncAccounts());
    refresh();
    window.addEventListener("cloudstream-sync-accounts-changed", refresh);
    return () => window.removeEventListener("cloudstream-sync-accounts-changed", refresh);
  }, []);

  const startLogin = useCallback(
    (provider: SyncIdName) => {
      // No real OAuth backend yet — prompt for a username and persist locally.
      const username = window.prompt(
        `Sign in to ${provider}\n\nThis is a stub OAuth flow — enter your ${provider} username to simulate login. The real OAuth redirect will be wired up when the sync API is implemented.`
      );
      if (!username) return;
      const next: SyncAccount = {
        provider,
        username: username.trim(),
        loggedInAt: Date.now(),
      };
      const withoutExisting = accounts.filter((a) => a.provider !== provider);
      const newList = [...withoutExisting, next];
      writeSyncAccounts(newList);
      setAccounts(newList);
      toast({
        title: `Signed in to ${provider}`,
        description: `Logged in as ${next.username}`,
      });
    },
    [accounts, toast]
  );

  const logout = useCallback(
    (provider: SyncIdName) => {
      const newList = accounts.filter((a) => a.provider !== provider);
      writeSyncAccounts(newList);
      setAccounts(newList);
      toast({
        title: `Signed out of ${provider}`,
      });
    },
    [accounts, toast]
  );

  const isLogged = (p: SyncIdName) => accounts.some((a) => a.provider === p);
  const accountFor = (p: SyncIdName) => accounts.find((a) => a.provider === p);

  return (
    <SettingsSection
      title="Sync"
      description="AniList, MAL, LocalList — keep your watch progress in sync"
      Icon={RefreshCw}
    >
      <Row
        label="Enable sync"
        description="Push watch progress and ratings to sync providers"
        htmlFor="enable-sync"
      >
        <Switch
          id="enable-sync"
          checked={settings.enableSync}
          onCheckedChange={(v) => updateSettings({ enableSync: v })}
        />
      </Row>

      <SyncAccountRow
        provider={SyncIdName.Anilist}
        logged={isLogged(SyncIdName.Anilist)}
        username={accountFor(SyncIdName.Anilist)?.username}
        onLogin={() => startLogin(SyncIdName.Anilist)}
        onLogout={() => logout(SyncIdName.Anilist)}
      />
      <SyncAccountRow
        provider={SyncIdName.MyAnimeList}
        logged={isLogged(SyncIdName.MyAnimeList)}
        username={accountFor(SyncIdName.MyAnimeList)?.username}
        onLogin={() => startLogin(SyncIdName.MyAnimeList)}
        onLogout={() => logout(SyncIdName.MyAnimeList)}
      />

      {/* LocalList is always on */}
      <div className="flex items-center justify-between gap-4 rounded-md border border-[#3d3d3d]/60 bg-[#1e1e1e]/40 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ShieldCheck className="size-5 text-[#7664ed]" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">LocalList</p>
            <p className="text-xs text-[#a0a0a0]">
              Built-in local tracking — always on, no account needed.
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="bg-[#7664ed]/15 text-[#BEC8FF]">
          Always on
        </Badge>
      </div>
    </SettingsSection>
  );
}

function SyncAccountRow({
  provider,
  logged,
  username,
  onLogin,
  onLogout,
}: {
  provider: SyncIdName;
  logged: boolean;
  username?: string;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-[#3d3d3d]/60 bg-[#1e1e1e]/40 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#7664ed]/15 ring-1 ring-[#7664ed]/40">
          <span className="text-xs font-semibold text-[#BEC8FF]">
            {provider.slice(0, 2)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{provider}</p>
          <p className="truncate text-xs text-[#a0a0a0]">
            {logged ? `Signed in as ${username}` : "Not signed in"}
          </p>
        </div>
      </div>
      {logged ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className="h-8 gap-1.5 text-[#a0a0a0] hover:text-white"
        >
          <LogOut className="size-3.5" />
          Sign out
        </Button>
      ) : (
        <Button
          variant="default"
          size="sm"
          onClick={onLogin}
          className="h-8 gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
        >
          <LogIn className="size-3.5" />
          Sign in
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subtitles section                                                  */
/* ------------------------------------------------------------------ */

function SubtitlesSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <SettingsSection
      title="Subtitles"
      description="Enable, preferred languages, online providers"
      Icon={Captions}
    >
      <Row
        label="Enable subtitles"
        description="Load subtitles automatically when available"
        htmlFor="enable-subtitles"
      >
        <Switch
          id="enable-subtitles"
          checked={settings.enableSubtitles}
          onCheckedChange={(v) => updateSettings({ enableSubtitles: v })}
        />
      </Row>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Languages className="size-4 text-[#7664ed]" />
          <Label className="text-sm font-medium text-white">
            Preferred subtitle languages
          </Label>
        </div>
        <p className="text-xs text-[#a0a0a0]">
          When multiple subtitle tracks are available, prefer these languages in order.
        </p>
        <MultiLanguageChips
          selected={settings.preferredSubtitleLanguages}
          onChange={(langs) => updateSettings({ preferredSubtitleLanguages: langs })}
          options={SUBTITLE_LANGUAGES}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-white">Online subtitle providers</Label>
        <p className="text-xs text-[#a0a0a0]">
          Fetch subtitles from online catalogs (e.g. OpenSubtitles) when the
          video stream doesn&apos;t include any.
        </p>
        <div className="space-y-2">
          <OnlineSubtitleProviderToggle name="OpenSubtitles" defaultOn />
          <OnlineSubtitleProviderToggle name="Subscene" defaultOn={false} />
          <OnlineSubtitleProviderToggle name="Addic7ed" defaultOn={false} />
        </div>
      </div>
    </SettingsSection>
  );
}

function OnlineSubtitleProviderToggle({
  name,
  defaultOn,
}: {
  name: string;
  defaultOn: boolean;
}) {
  // Per-provider on/off is stored in localStorage so it survives reloads
  // without bloating the main app store. We read it lazily on the client
  // (guarded against SSR where `localStorage` is undefined).
  const storageKey = `cloudstream-subtitle-provider-${name}`;
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultOn;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw === null ? defaultOn : raw === "1";
    } catch {
      return defaultOn;
    }
  });

  const toggle = (v: boolean) => {
    setOn(v);
    try {
      window.localStorage.setItem(storageKey, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <Row label={name} description={on ? "Enabled" : "Disabled"}>
      <Switch checked={on} onCheckedChange={toggle} />
    </Row>
  );
}

/* ------------------------------------------------------------------ */
/*  Downloads section                                                  */
/* ------------------------------------------------------------------ */

function DownloadsSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <SettingsSection
      title="Downloads"
      description="Parallel downloads and download path"
      Icon={Download}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-white">Parallel downloads</Label>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {settings.parallelDownloads}
          </Badge>
        </div>
        <p className="text-xs text-[#a0a0a0]">
          Number of episodes that can download at the same time.
        </p>
        <Slider
          min={1}
          max={5}
          step={1}
          value={[settings.parallelDownloads]}
          onValueChange={([v]) => updateSettings({ parallelDownloads: v })}
          className="py-2"
        />
        <div className="flex justify-between text-[10px] text-[#a0a0a0]">
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>4</span>
          <span>5</span>
        </div>
      </div>

      <Row
        label="Download path"
        description="Web browsers cannot pick arbitrary download folders — downloads go to your browser's default location."
      >
        <div className="flex items-center gap-2 rounded-md border border-[#3d3d3d] bg-[#1e1e1e] px-3 py-1.5 text-xs text-[#a0a0a0]">
          <Download className="size-3.5" />
          <span>Browser default</span>
        </div>
      </Row>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Extensions section                                                 */
/* ------------------------------------------------------------------ */

function ExtensionsSection() {
  const { toast } = useToast();
  const setView = useAppStore((s) => s.setView);

  const providers = useMemo(() => APIHolder.getAllProviders(), []);
  // Lazy-init from localStorage via useState initializer — avoids the
  // `setState in effect` lint rule and runs only on the client (this is a
  // 'use client' component, so the initializer runs at hydration time).
  const [disabled, setDisabled] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(DISABLED_PROVIDERS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [repos, setRepos] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(REPOS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [newRepo, setNewRepo] = useState("");

  const persistDisabled = (next: Set<string>) => {
    setDisabled(next);
    try {
      localStorage.setItem(DISABLED_PROVIDERS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const toggleProvider = (name: string) => {
    const next = new Set(disabled);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    persistDisabled(next);
  };

  const addRepo = () => {
    const url = newRepo.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast({
        title: "Invalid URL",
        description: "Repository URL must start with http:// or https://",
        variant: "destructive",
      });
      return;
    }
    if (repos.includes(url)) {
      toast({ title: "Already added", description: url });
      return;
    }
    const next = [...repos, url];
    setRepos(next);
    setNewRepo("");
    try {
      localStorage.setItem(REPOS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast({ title: "Repository added", description: url });
  };

  const removeRepo = (url: string) => {
    const next = repos.filter((r) => r !== url);
    setRepos(next);
    try {
      localStorage.setItem(REPOS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <SettingsSection
      title="Extensions"
      description="Enabled providers and extension repositories"
      Icon={Library}
    >
      {/* Manage Extensions launcher */}
      <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-[#7664ed]/30 bg-[#7664ed]/5 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Manage Extensions</p>
          <p className="mt-0.5 text-xs text-[#a0a0a0]">
            Add repositories, browse and install plugins, toggle providers on
            or off — just like the Android app&apos;s Extensions screen.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setView("extensions")}
          className="shrink-0 gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
        >
          <ExternalLink className="size-4" />
          <span className="hidden sm:inline">Open</span>
          <span className="sm:hidden">→</span>
        </Button>
      </div>

      {providers.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#3d3d3d] p-6 text-center">
          <p className="text-sm text-[#a0a0a0]">
            No providers registered yet. Built-in providers will appear here
            once the provider modules finish loading.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-white">
            Providers ({providers.length})
          </Label>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-[#3d3d3d] bg-[#1e1e1e]/40 p-2 cs-scrollbar">
            {providers.map((p) => {
              const isOff = disabled.has(p.name);
              return (
                <div
                  key={p.name}
                  className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-[#3d3d3d]/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{p.name}</p>
                    <p className="truncate text-[11px] text-[#a0a0a0]">
                      {p.lang} · {p.supportedTypes.length} types
                    </p>
                  </div>
                  <Switch
                    checked={!isOff}
                    onCheckedChange={() => toggleProvider(p.name)}
                    aria-label={`Toggle ${p.name}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-sm font-medium text-white">Extension repositories</Label>
        <p className="text-xs text-[#a0a0a0]">
          Add CloudStream extension repository URLs. (Stored locally — actual
          repo fetching will be wired up when the plugin loader is implemented.)
        </p>

        <div className="flex gap-2">
          <Input
            value={newRepo}
            onChange={(e) => setNewRepo(e.target.value)}
            placeholder="https://example.com/repo.json"
            className="flex-1 bg-[#1e1e1e]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRepo();
              }
            }}
          />
          <Button
            type="button"
            onClick={addRepo}
            className="gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {repos.length > 0 && (
          <ul className="space-y-1.5">
            {repos.map((url) => (
              <li
                key={url}
                className="flex items-center gap-2 rounded-md border border-[#3d3d3d] bg-[#1e1e1e]/40 px-3 py-2"
              >
                <Github className="size-4 shrink-0 text-[#a0a0a0]" />
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-xs text-[#BEC8FF] hover:underline"
                  title={url}
                >
                  {url}
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-[#a0a0a0] hover:text-red-400"
                  onClick={() => removeRepo(url)}
                  aria-label={`Remove ${url}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  About section                                                      */
/* ------------------------------------------------------------------ */

function AboutSection() {
  return (
    <SettingsSection
      title="About"
      description="Version, license, credits"
      Icon={Info}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AboutCard label="Version" value={APP_VERSION} Icon={Info} />
        <AboutCard label="License" value={LICENSE} Icon={FileText} />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-md border border-[#3d3d3d] bg-[#1e1e1e]/40 px-3 py-2.5 transition-colors hover:border-[#7664ed]/50"
        >
          <Github className="size-5 text-[#7664ed]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[#a0a0a0]">Source</p>
            <p className="truncate text-sm font-medium text-white">GitHub</p>
          </div>
          <ExternalLink className="size-4 text-[#a0a0a0]" />
        </a>
        <AboutCard label="Maintainers" value="recloudstream" Icon={Users} />
      </div>

      <div className="rounded-md border border-[#3d3d3d] bg-[#1e1e1e]/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Users className="size-4 text-[#7664ed]" />
          <h3 className="text-sm font-semibold text-white">Credits</h3>
        </div>
        <p className="text-xs leading-relaxed text-[#a0a0a0]">
          CloudStream Web is a TypeScript port of the CloudStream Android app,
          originally developed by Lagradost and now maintained by the
          recloudstream community. Licensed under the GNU General Public
          License v3. Thanks to all the extension authors, translators and
          contributors who make this possible.
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 rounded-md border border-[#3d3d3d]/60 bg-[#1e1e1e]/40 px-3 py-2 text-xs text-[#a0a0a0]">
        <Wifi className="size-3.5" />
        <Monitor className="size-3.5" />
        <span>Built with Next.js · TypeScript · Tailwind CSS · shadcn/ui</span>
      </div>
    </SettingsSection>
  );
}

function AboutCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: typeof Info;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-[#3d3d3d] bg-[#1e1e1e]/40 px-3 py-2.5">
      <Icon className="size-5 text-[#7664ed]" />
      <div className="min-w-0">
        <p className="text-xs text-[#a0a0a0]">{label}</p>
        <p className="truncate text-sm font-medium text-white">{value}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

function ColorInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="size-9 cursor-pointer rounded-md border border-[#3d3d3d] bg-transparent p-0.5"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 bg-[#1e1e1e] font-mono text-xs"
        aria-label={`${ariaLabel} hex`}
      />
    </div>
  );
}

function MultiLanguageChips({
  selected,
  onChange,
  options = UI_LANGUAGES,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  options?: { code: string; label: string }[];
}) {
  const toggle = (code: string) => {
    if (selected.includes(code)) onChange(selected.filter((c) => c !== code));
    else onChange([...selected, code]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = selected.includes(o.code);
        return (
          <button
            key={o.code}
            type="button"
            onClick={() => toggle(o.code)}
            aria-pressed={active}
            className={cn(
              "min-h-[32px] rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-[#7664ed] bg-[#7664ed]/15 text-white"
                : "border-[#3d3d3d] bg-[#1e1e1e] text-[#a0a0a0] hover:border-[#7664ed]/50 hover:text-white"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
