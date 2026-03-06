import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  flushSettingsPersist,
  useSettingsStore,
  type BookDeleteMode,
} from "@/stores/settings";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  FileX2,
  FolderOpen,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";

interface AppSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface PdfCacheConfig {
  base_dir: string;
  effective_dir: string;
  using_default: boolean;
}

interface PdfCacheValidateResult {
  effective_dir: string;
}

interface PdfCacheStats {
  effective_dir: string;
  file_count: number;
  total_bytes: number;
}

const DELETE_MODES: {
  value: BookDeleteMode;
  label: string;
  desc: string;
  icon: typeof Trash2;
  activeClass: string;
}[] = [
  {
    value: "library-only",
    label: "仅移出书架",
    desc: "不删除磁盘文件",
    icon: Trash2,
    activeClass: "border-primary/60 bg-primary/10",
  },
  {
    value: "library-and-file",
    label: "移出并删除源文件",
    desc: "同时删除磁盘文件",
    icon: FileX2,
    activeClass: "border-destructive/60 bg-destructive/10",
  },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fixed = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fixed)} ${units[unitIndex]}`;
}

function getDisplayCacheDir(config: PdfCacheConfig | null): string {
  if (!config) return "正在读取缓存目录...";
  if (config.base_dir) return config.base_dir;

  const normalized = config.effective_dir.replace(/\\/g, "/");
  const suffix = "/pdf_pages/v1";
  if (!normalized.endsWith(suffix)) return config.effective_dir;

  const root = normalized.slice(0, -suffix.length);
  if (!root) return config.effective_dir;

  return config.effective_dir.includes("\\")
    ? root.replace(/\//g, "\\")
    : root;
}

export function AppSettingsPanel({ open, onClose }: AppSettingsPanelProps) {
  const bookDeleteSkipConfirm = useSettingsStore(
    (s) => s.bookDeleteSkipConfirm
  );
  const bookDeleteMode = useSettingsStore((s) => s.bookDeleteMode);

  const setPdfCacheBaseDir = useSettingsStore((s) => s.setPdfCacheBaseDir);
  const setBookDeleteSkipConfirm = useSettingsStore(
    (s) => s.setBookDeleteSkipConfirm
  );
  const setBookDeleteMode = useSettingsStore((s) => s.setBookDeleteMode);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cacheConfig, setCacheConfig] = useState<PdfCacheConfig | null>(null);
  const [cacheStats, setCacheStats] = useState<PdfCacheStats | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const displayCacheDir = getDisplayCacheDir(cacheConfig);

  const refreshPdfCacheInfo = useCallback(async () => {
    setCacheBusy(true);
    try {
      const [config, stats] = await Promise.all([
        invoke<PdfCacheConfig>("pdf_cache_get_config"),
        invoke<PdfCacheStats>("pdf_cache_get_stats"),
      ]);
      setCacheConfig(config);
      setCacheStats(stats);
      setCacheError(null);
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setCacheBusy(false);
    }
  }, []);

  const handleSelectPdfCacheDir = useCallback(async () => {
    const selected = await openDialog({ directory: true });
    if (!selected || Array.isArray(selected)) return;

    setCacheBusy(true);
    try {
      const result = await invoke<PdfCacheValidateResult>("pdf_cache_validate_dir", {
        dir: selected,
      });
      setPdfCacheBaseDir(selected);
      await flushSettingsPersist();
      setCacheConfig({
        base_dir: selected,
        effective_dir: result.effective_dir,
        using_default: false,
      });
      setCacheError(null);
      await refreshPdfCacheInfo();
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setCacheBusy(false);
    }
  }, [refreshPdfCacheInfo, setPdfCacheBaseDir]);

  const handleUseDefaultPdfCacheDir = useCallback(async () => {
    setCacheBusy(true);
    try {
      const result = await invoke<PdfCacheValidateResult>("pdf_cache_validate_dir", {
        dir: "",
      });
      setPdfCacheBaseDir("");
      await flushSettingsPersist();
      setCacheConfig({
        base_dir: "",
        effective_dir: result.effective_dir,
        using_default: true,
      });
      setCacheError(null);
      await refreshPdfCacheInfo();
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setCacheBusy(false);
    }
  }, [refreshPdfCacheInfo, setPdfCacheBaseDir]);

  const handleClearPdfCache = useCallback(async () => {
    setCacheBusy(true);
    try {
      await invoke("pdf_cache_clear");
      setCacheError(null);
      await refreshPdfCacheInfo();
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setCacheBusy(false);
    }
  }, [refreshPdfCacheInfo]);

  useEffect(() => {
    if (!open) {
      setAdvancedOpen(false);
      setCacheError(null);
      return;
    }
    void refreshPdfCacheInfo();
  }, [open, refreshPdfCacheInfo]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="应用设置"
        className="fixed right-0 top-0 z-50 flex h-full w-72 flex-col border-l border-border/50 bg-card/80 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right duration-200"
      >
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">设置</h3>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="rounded-lg p-1 text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">
              删除设置
            </span>

            <div className="grid gap-1.5">
              {DELETE_MODES.map(
                ({ value, label, desc, icon: Icon, activeClass }) => (
                  <button
                    key={value}
                    onClick={() => setBookDeleteMode(value)}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      bookDeleteMode === value
                        ? activeClass
                        : "border-border/60 hover:bg-accent/60"
                    )}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium">{label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {desc}
                      </p>
                    </div>
                  </button>
                )
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
              <input
                type="checkbox"
                checked={bookDeleteSkipConfirm}
                onChange={(e) => setBookDeleteSkipConfirm(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border"
              />
              删除时不再询问确认
            </label>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-left transition-colors hover:bg-accent/60"
              aria-expanded={advancedOpen}
            >
              <span className="text-xs font-medium text-foreground">高级设置</span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  advancedOpen && "rotate-90"
                )}
              />
            </button>

            {advancedOpen && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-background/80 p-3">
                <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    缓存目录
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {cacheConfig?.using_default
                      ? "当前使用系统默认缓存目录"
                      : "当前使用自定义缓存目录"}
                  </p>
                </div>
                  <button
                    type="button"
                    onClick={() => void refreshPdfCacheInfo()}
                    disabled={cacheBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-foreground/80 transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCcw
                      className={cn("h-3 w-3", cacheBusy && "animate-spin")}
                    />
                    刷新
                  </button>
                </div>

                <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
                  <p className="break-all text-[11px] text-foreground/80">
                    {displayCacheDir}
                  </p>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>缓存大小</span>
                  <span>
                    {cacheStats
                      ? `${formatBytes(cacheStats.total_bytes)} · ${cacheStats.file_count} 个文件`
                      : "正在读取..."}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleSelectPdfCacheDir()}
                    disabled={cacheBusy}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    更改目录
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUseDefaultPdfCacheDir()}
                    disabled={cacheBusy}
                    className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    使用默认
                  </button>
                </div>

                {cacheError && (
                  <p className="text-[11px] text-destructive">{cacheError}</p>
                )}

                <button
                  type="button"
                  onClick={() => void handleClearPdfCache()}
                  disabled={cacheBusy}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清除缓存
                </button>

              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
