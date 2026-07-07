'use client';

/**
 * CloudStream Web — AddRepositoryDialog
 *
 * A shadcn Dialog for adding a new CloudStream extension repository.
 * Mirrors the Android `add_repo_input.xml` flow but adapted for the web:
 *
 *   - Input accepts a `repo.json` URL (or `cloudstreamrepo://` scheme).
 *   - On "Add", we call `useRepositoryStore.addRepository(url)`, which fetches
 *     repo.json + plugins.json through the CORS proxy and stores the parsed
 *     plugin list.
 *   - On success, the dialog stays open and switches to a "plugin picker"
 *     view showing the just-added repo's plugins, each with an Install button.
 *   - On error, we show a destructive toast.
 *
 * NOTE for users coming from the Android app: the web port does NOT support
 * `.cs3` files (compiled Kotlin/Java). Plugins must be plain `.js` files
 * that call `registerProvider(new YourProvider())` — see `loader.ts`.
 */

import { useEffect, useState } from "react";
import {
  Plus,
  Loader2,
  Github,
  ExternalLink,
  Info,
  CheckCircle2,
  Download,
  Package,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  useRepositoryStore,
  Repository,
} from "@/lib/cloudstream/store/repository-store";
import { PluginCard } from "./PluginCard";

/* ------------------------------------------------------------------ */
/*  Sample repos — placeholders so the dialog isn't empty on first run */
/* ------------------------------------------------------------------ */

const SAMPLE_REPOS: { url: string; label: string; note: string }[] = [
  {
    url: "https://raw.githubusercontent.com/recloudstream/cloudstream/master/repo.json",
    label: "CloudStream official",
    note: "Reference repo (CS3 — sample only on web)",
  },
  {
    url: "https://raw.githubusercontent.com/recloudstream/extensions-repo/main/repo.json",
    label: "Extensions repo",
    note: "Community extensions (sample)",
  },
  {
    url: "cloudstreamrepo://example.com/repo.json",
    label: "cloudstreamrepo:// scheme",
    note: "Scheme prefix is auto-stripped to https://",
  },
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface AddRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: a specific repository to show plugins for after adding.
   *  When set, the dialog renders in "plugin picker" mode immediately. */
  initialRepo?: Repository | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AddRepositoryDialog({
  open,
  onOpenChange,
  initialRepo = null,
}: AddRepositoryDialogProps) {
  const { toast } = useToast();
  const addRepository = useRepositoryStore((s) => s.addRepository);
  const installPlugin = useRepositoryStore((s) => s.installPlugin);
  const isPluginInstalled = useRepositoryStore((s) => s.isPluginInstalled);
  const installedPlugins = useRepositoryStore((s) => s.installedPlugins);

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addedRepo, setAddedRepo] = useState<Repository | null>(initialRepo);
  const [installingName, setInstallingName] = useState<string | null>(null);

  // If the dialog is opened with an initialRepo, jump straight to picker.
  useEffect(() => {
    if (open) {
      setAddedRepo(initialRepo);
    } else {
      // Reset state when the dialog closes.
      setUrl("");
      setAddedRepo(null);
      setInstallingName(null);
    }
  }, [open, initialRepo]);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const result = await addRepository(trimmed);
      if (result.ok) {
        // Find the freshly-added repo by URL.
        const normalized = trimmed.startsWith("cloudstreamrepo://")
          ? "https://" + trimmed.slice("cloudstreamrepo://".length)
          : trimmed;
        const fresh = useRepositoryStore
          .getState()
          .repositories.find((r) => r.url === normalized);
        setAddedRepo(fresh ?? null);
        toast({
          title: "Repository added",
          description: fresh?.name ?? trimmed,
        });
        if (!fresh) {
          // No repo found — close dialog.
          onOpenChange(false);
        }
      } else {
        toast({
          title: "Could not add repository",
          description: result.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "Could not add repository",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleInstall = async (internalName: string) => {
    if (!addedRepo) return;
    setInstallingName(internalName);
    try {
      const result = await installPlugin(addedRepo.url, internalName);
      if (result.ok) {
        toast({
          title: "Plugin installed",
          description: addedRepo.plugins.find(
            (p) => p.internalName === internalName
          )?.name,
        });
      } else {
        toast({
          title: "Install failed",
          description: result.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setInstallingName(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-hidden border-[#3d3d3d] bg-[#2d2d2d] p-0 text-white sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader className="border-b border-[#3d3d3d] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg text-white">
            <Github className="size-5 text-[#7664ed]" />
            {addedRepo ? "Repository plugins" : "Add Repository"}
          </DialogTitle>
          <DialogDescription className="text-[#a0a0a0]">
            {addedRepo
              ? `${addedRepo.name} — ${addedRepo.plugins.length} plugin${addedRepo.plugins.length === 1 ? "" : "s"} available`
              : "Add a CloudStream extension repository. Plugins must be plain .js files (not .cs3)."}
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col">
          {!addedRepo ? (
            <div className="space-y-4 px-5 py-4">
              {/* URL input */}
              <div className="space-y-1.5">
                <Label htmlFor="repo-url" className="text-sm text-white">
                  Repository URL
                </Label>
                <Input
                  id="repo-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !adding && url.trim()) {
                      e.preventDefault();
                      void handleAdd();
                    }
                  }}
                  placeholder="https://example.com/repo.json"
                  disabled={adding}
                  className="bg-[#1e1e1e] font-mono text-sm text-white"
                  autoFocus
                />
                <p className="flex items-start gap-1.5 text-xs text-[#a0a0a0]">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-[#7664ed]" />
                  <span>
                    The URL must point to a <code className="text-[#BEC8FF]">repo.json</code>{" "}
                    manifest. The <code className="text-[#BEC8FF]">cloudstreamrepo://</code>{" "}
                    scheme is also accepted (auto-stripped to <code>https://</code>).
                    Web plugins are <strong className="text-white">.js files</strong>, not
                    .cs3 — the loader expects a JS file that calls{" "}
                    <code className="text-[#BEC8FF]">registerProvider(new YourProvider())</code>.
                  </span>
                </p>
              </div>

              {/* Sample repos */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-[#a0a0a0]">
                  Example repositories
                </Label>
                <ul className="space-y-1.5">
                  {SAMPLE_REPOS.map((s) => (
                    <li key={s.url}>
                      <button
                        type="button"
                        onClick={() => setUrl(s.url)}
                        disabled={adding}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border border-[#3d3d3d] bg-[#1e1e1e]/60 px-3 py-2 text-left",
                          "transition-colors hover:border-[#7664ed]/40 hover:bg-[#1e1e1e]",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7664ed]/60"
                        )}
                      >
                        <Package className="mt-0.5 size-3.5 shrink-0 text-[#7664ed]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-white">
                              {s.label}
                            </span>
                          </div>
                          <p className="truncate font-mono text-[10px] text-[#a0a0a0]">
                            {s.url}
                          </p>
                          <p className="mt-0.5 text-[10px] text-[#a0a0a0]/70">
                            {s.note}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 size-3 shrink-0 text-[#a0a0a0]" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <ScrollArea className="max-h-[55vh] px-5 py-4">
              {addedRepo.plugins.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#3d3d3d] p-8 text-center">
                  <Package className="mx-auto size-8 text-[#a0a0a0]" />
                  <p className="mt-2 text-sm text-[#a0a0a0]">
                    No plugins found in this repository.
                  </p>
                  <p className="mt-1 text-xs text-[#a0a0a0]/70">
                    The repo.json didn&apos;t list any pluginLists, or its
                    plugins.json was empty / unreachable.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {addedRepo.plugins.map((entry) => {
                    const installed = isPluginInstalled(entry.internalName);
                    const installedEntry = installedPlugins.find(
                      (p) => p.internalName === entry.internalName
                    );
                    return (
                      <PluginCard
                        key={entry.internalName}
                        entry={entry}
                        installed={installed}
                        enabled={installedEntry?.enabled ?? false}
                        onInstall={handleInstall}
                        installing={installingName === entry.internalName}
                        compact
                      />
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t border-[#3d3d3d] px-5 py-3">
          {!addedRepo ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={adding}
                className="text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleAdd()}
                disabled={adding || !url.trim()}
                className="gap-1.5 bg-[#7664ed] hover:bg-[#7664ed]/90"
              >
                {adding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Add Repository
              </Button>
            </>
          ) : (
            <>
              <div className="mr-auto flex items-center gap-2 text-xs text-[#a0a0a0]">
                <CheckCircle2 className="size-3.5 text-[#7664ed]" />
                {addedRepo.plugins.length} plugin
                {addedRepo.plugins.length === 1 ? "" : "s"} ·{" "}
                {addedRepo.plugins.filter((p) =>
                  isPluginInstalled(p.internalName)
                ).length}{" "}
                installed
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddedRepo(null)}
                className="gap-1.5 text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white"
              >
                <Download className="size-3.5" />
                Add another
              </Button>
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                className="bg-[#7664ed] hover:bg-[#7664ed]/90"
              >
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
