import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, FileX2, Trash2, X } from "lucide-react";
import type { BookDeleteMode } from "@/stores/settings";

interface DeleteConfirmDialogProps {
  open: boolean;
  count: number;
  mode: BookDeleteMode;
  rememberChoice: boolean;
  loading: boolean;
  onModeChange: (mode: BookDeleteMode) => void;
  onRememberChange: (remember: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  count,
  mode,
  rememberChoice,
  loading,
  onModeChange,
  onRememberChange,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]"
        onClick={loading ? undefined : onCancel}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="批量删除确认"
        className="fixed left-1/2 top-1/2 z-50 w-[min(520px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              删除 {count} 本书
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              请选择删除方式。删除源文件后无法恢复。
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            aria-label="关闭"
            className="rounded-lg p-1 text-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => onModeChange("library-only")}
            disabled={loading}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
              mode === "library-only"
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border/60 bg-background hover:bg-accent/60",
              loading && "cursor-not-allowed opacity-60"
            )}
          >
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-medium">仅移出书架</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                不删除磁盘文件，可再次导入。
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onModeChange("library-and-file")}
            disabled={loading}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
              mode === "library-and-file"
                ? "border-destructive/60 bg-destructive/10 text-foreground"
                : "border-border/60 bg-background hover:bg-accent/60",
              loading && "cursor-not-allowed opacity-60"
            )}
          >
            <FileX2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-medium">移出并删除源文件</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                会尝试删除磁盘文件，失败的项目会保留在书架。
              </p>
            </div>
          </button>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => onRememberChange(e.target.checked)}
            disabled={loading}
            className="h-3.5 w-3.5 rounded border-border"
          />
          不再询问（记住本次选择）
        </label>

        {mode === "library-and-file" && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            源文件删除后通常无法恢复。
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              mode === "library-and-file"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {loading ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </>
  );
}
