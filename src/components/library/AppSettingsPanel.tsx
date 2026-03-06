import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  flushSettingsPersist,
  useSettingsStore,
  type BookDeleteMode,
} from "@/stores/settings";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { DebugLogDialog } from "./DebugLogDialog";
import {
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

const FONT_OPTIONS = [
  { value: "system-ui", label: "系统默认" },
  { value: '"SimSun", "宋体", serif', label: "宋体" },
  { value: '"KaiTi", "楷体", serif', label: "楷体" },
  { value: '"SimHei", "黑体", sans-serif', label: "黑体" },
];

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

/** 将浮点值归一化到最近的步进值 */
function snapToStep(value: number, min: number, step: number): number {
  return Math.round((value - min) / step) * step + min;
}

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

function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
}) {
  const id = `app-settings-${label}`;
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <span className="text-xs font-medium tabular-nums text-foreground">
          {displayValue}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(snapToStep(Number(e.target.value), min, step))}
        className="settings-slider w-full"
        style={{
          background: `linear-gradient(to right, hsl(var(--primary) / 0.5) ${percent}%, hsl(var(--muted)) ${percent}%)`,
        }}
      />
    </div>
  );
}

export function AppSettingsPanel({ open, onClose }: AppSettingsPanelProps) {
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const margin = useSettingsStore((s) => s.margin);
  const pdfCacheBaseDir = useSettingsStore((s) => s.pdfCacheBaseDir);
  const bookDeleteSkipConfirm = useSettingsStore(
    (s) => s.bookDeleteSkipConfirm
  );
  const bookDeleteMode = useSettingsStore((s) => s.bookDeleteMode);
  const debugMode = useSettingsStore((s) => s.debugMode);

  const setFontFamily = useSettingsStore((s) => s.setFontFamily);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const setLineHeight = useSettingsStore((s) => s.setLineHeight);
  const setMargin = useSettingsStore((s) => s.setMargin);
  const setPdfCacheBaseDir = useSettingsStore((s) => s.setPdfCacheBaseDir);
  const setBookDeleteSkipConfirm = useSettingsStore(
    (s) => s.setBookDeleteSkipConfirm
  );
  const setBookDeleteMode = useSettingsStore((s) => s.setBookDeleteMode);
  const setDebugMode = useSettingsStore((s) => s.setDebugMode);

  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [cacheConfig, setCacheConfig] = useState<PdfCacheConfig | null>(null);
  const [cacheStats, setCacheStats] = useState<PdfCacheStats | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const logEntries = useSyncExternalStore(
    logger.subscribe,
    logger.getEntries,
    logger.getEntries
  );
  const logEntryCount = logEntries.length;

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
      setLogDialogOpen(false);
      setCacheError(null);
      return;
    }
    void refreshPdfCacheInfo();
  }, [open, refreshPdfCacheInfo]);

  useEffect(() => {
    if (!debugMode) {
      setLogDialogOpen(false);
    }
  }, [debugMode]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (logDialogOpen) {
        setLogDialogOpen(false);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, logDialogOpen, onClose]);

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
          <div className="space-y-4">
            <span className="text-xs font-medium text-foreground">
              阅读默认值
            </span>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">字体</span>
              <div className="grid grid-cols-2 gap-1.5">
                {FONT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFontFamily(opt.value)}
                    className={cn(
                      "rounded-lg px-3 py-2 text-xs font-medium transition-all",
                      fontFamily === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                    style={{ fontFamily: `${opt.value}, system-ui` }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <RangeSlider
              label="字号"
              value={fontSize}
              min={14}
              max={32}
              step={2}
              displayValue={`${fontSize}px`}
              onChange={setFontSize}
            />

            <RangeSlider
              label="行高"
              value={lineHeight}
              min={1.4}
              max={2.4}
              step={0.2}
              displayValue={lineHeight.toFixed(1)}
              onChange={setLineHeight}
            />

            <RangeSlider
              label="边距"
              value={margin}
              min={40}
              max={120}
              step={20}
              displayValue={`${margin}px`}
              onChange={setMargin}
            />
          </div>

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
            <span className="text-xs font-medium text-foreground">高级</span>

            <div className="space-y-2 rounded-lg border border-border/60 bg-background/80 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    PDF 缓存目录
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {cacheConfig?.using_default
                      ? "当前使用系统默认缓存目录"
                      : "当前使用自定义缓存基目录"}
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
                  {cacheConfig?.effective_dir ?? "正在读取缓存目录..."}
                </p>
                {pdfCacheBaseDir && (
                  <p className="mt-1 break-all text-[11px] text-muted-foreground">
                    基目录：{pdfCacheBaseDir}
                  </p>
                )}
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
                  选择目录
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

            <div className="space-y-1">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={(e) => setDebugMode(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                调试模式
              </label>
              <p className="text-[11px] text-muted-foreground">
                开启后会记录内存日志，便于排查问题。
              </p>
            </div>

            {debugMode && (
              <button
                type="button"
                onClick={() => setLogDialogOpen(true)}
                className="inline-flex w-full items-center justify-center rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent/60"
              >
                查看日志 ({logEntryCount})
              </button>
            )}
          </div>
        </div>
      </div>

      <DebugLogDialog
        open={logDialogOpen}
        onClose={() => setLogDialogOpen(false)}
      />
    </>
  );
}

