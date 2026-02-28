import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Copy, Trash2, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger, type LogEntry, type LogLevel } from "@/lib/logger";

type NormalizedLogEntry = {
  id: string;
  time: number;
  level: LogLevel;
  source: string;
  message: string;
  detail?: string;
};

interface DebugLogDialogProps {
  open: boolean;
  onClose: () => void;
}

function coerceEpochMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Date.now();
  // 兼容秒级时间戳
  if (value > 1e9 && value < 1e12) return value * 1000;
  return value;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function toDetailString(detail: unknown): string | undefined {
  if (detail == null) return undefined;
  if (typeof detail === "string") return detail.trim() ? detail : undefined;
  if (detail instanceof Error) return detail.stack || detail.message;
  try {
    const text = JSON.stringify(detail, null, 2);
    return text.trim() ? text : undefined;
  } catch {
    return String(detail);
  }
}

function normalizeEntry(entry: LogEntry, index: number): NormalizedLogEntry {
  const time = coerceEpochMs(entry.timestamp);
  const level = entry.level as LogLevel;
  const source = entry.source;
  const message = entry.message;
  const detail = toDetailString(entry.detailText ?? entry.detail);
  const id = String(entry.id ?? `${time}-${index}`);
  return { id, time, level, source, message, detail };
}

function useLogEntries(): readonly LogEntry[] {
  return useSyncExternalStore(logger.subscribe, logger.getEntries, logger.getEntries);
}

async function writeToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function DebugLogDialog({ open, onClose }: DebugLogDialogProps) {
  const rawEntries = useLogEntries();
  const entries = useMemo(
    () => rawEntries.map((e, i) => normalizeEntry(e, i)),
    [rawEntries]
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setExpandedIds(new Set());
  }, [open]);

  if (!open) return null;

  const count = entries.length;

  const handleCopy = async () => {
    try {
      await writeToClipboard(logger.exportAsText());
    } catch (err) {
      console.warn("复制日志失败", err);
    }
  };

  const handleClear = () => {
    try {
      logger.clearEntries();
    } catch (err) {
      console.warn("清空日志失败", err);
    }
  };

  const toggleDetail = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[55] bg-black/35 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="调试日志"
        className="fixed left-1/2 top-1/2 z-[60] flex max-h-[70vh] w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            日志 ({count})
          </h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1 text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={count === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" />
              复制
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={count === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {count === 0 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-10 text-xs text-muted-foreground">
              暂无日志
            </div>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => {
                const isExpanded = expandedIds.has(e.id);
                const isError = e.level === "error";
                const isInfo = e.level === "info";
                const badgeClass = cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  isError && "border-destructive/30 bg-destructive/10 text-destructive",
                  isInfo &&
                    "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                  !isError &&
                    !isInfo &&
                    "border-border/60 bg-muted/40 text-foreground/70"
                );

                return (
                  <li
                    key={e.id}
                    className="rounded-xl border border-border/60 bg-background/50 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="tabular-nums text-muted-foreground">
                        {formatTime(e.time)}
                      </span>
                      <span className={badgeClass}>{String(e.level)}</span>
                      {e.source ? (
                        <span className="text-foreground/70">{e.source}</span>
                      ) : (
                        <span className="text-muted-foreground/70">unknown</span>
                      )}
                    </div>

                    <div className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                      {e.message || <span className="text-muted-foreground">（无消息）</span>}
                    </div>

                    {e.detail && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => toggleDetail(e.id)}
                          className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              isExpanded && "rotate-180"
                            )}
                          />
                          {isExpanded ? "收起详情" : "展开详情"}
                        </button>
                        {isExpanded && (
                          <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border/50 bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                            {e.detail}
                          </pre>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
