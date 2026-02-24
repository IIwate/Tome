import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore, type BookDeleteMode } from "@/stores/settings";
import { BookGrid } from "./BookGrid";
import { ThemeSwitcher } from "@/components/layout/ThemeSwitcher";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { Plus, FolderOpen, Search, CheckSquare, Trash2, X } from "lucide-react";
import type { Book } from "@/stores/library";

interface LibraryPageProps {
  onOpenBook: (book: Book) => void;
}

export function LibraryPage({ onOpenBook }: LibraryPageProps) {
  const books = useLibraryStore((s) => s.books);
  const importFiles = useLibraryStore((s) => s.importFiles);
  const scanFolder = useLibraryStore((s) => s.scanFolder);
  const removeBooks = useLibraryStore((s) => s.removeBooks);

  const bookDeleteSkipConfirm = useSettingsStore((s) => s.bookDeleteSkipConfirm);
  const bookDeleteMode = useSettingsStore((s) => s.bookDeleteMode);
  const setBookDeleteSkipConfirm = useSettingsStore(
    (s) => s.setBookDeleteSkipConfirm
  );
  const setBookDeleteMode = useSettingsStore((s) => s.setBookDeleteMode);

  const [searchQuery, setSearchQuery] = useState("");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteMode, setPendingDeleteMode] =
    useState<BookDeleteMode>("library-only");
  const [rememberDeleteChoice, setRememberDeleteChoice] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "warning";
    text: string;
  } | null>(null);

  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      if (a.lastOpenedAt && b.lastOpenedAt) return b.lastOpenedAt - a.lastOpenedAt;
      if (a.lastOpenedAt && !b.lastOpenedAt) return -1;
      if (!a.lastOpenedAt && b.lastOpenedAt) return 1;
      return b.addedAt - a.addedAt;
    });
  }, [books]);

  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedBooks;
    return sortedBooks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q)
    );
  }, [sortedBooks, searchQuery]);

  const filteredBookIdSet = useMemo(
    () => new Set(filteredBooks.map((b) => b.id)),
    [filteredBooks]
  );

  const selectedBooks = useMemo(
    () => books.filter((book) => selectedIds.has(book.id)),
    [books, selectedIds]
  );
  const allFilteredSelected = useMemo(() => {
    if (filteredBooks.length === 0) return false;
    return filteredBooks.every((book) => selectedIds.has(book.id));
  }, [filteredBooks, selectedIds]);

  useEffect(() => {
    if (!isSelectionMode) return;
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (filteredBookIdSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [filteredBookIdSet, isSelectionMode]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => {
      setFeedback(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const enterSelectionMode = () => {
    setFeedback(null);
    setIsSelectionMode(true);
    setSelectedIds(new Set());
  };

  const cancelSelectionMode = () => {
    if (isDeleting) return;
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    setDeleteDialogOpen(false);
    setRememberDeleteChoice(false);
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteDialogOpen(false);
    setRememberDeleteChoice(false);
  };

  const toggleBookSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (isDeleting || filteredBooks.length === 0) return;
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredBooks.map((book) => book.id)));
  };

  const executeDelete = async (mode: BookDeleteMode, rememberChoice: boolean) => {
    if (selectedBooks.length === 0 || isDeleting) return;

    setIsDeleting(true);
    setFeedback(null);

    if (rememberChoice) {
      setBookDeleteMode(mode);
      setBookDeleteSkipConfirm(true);
    }

    try {
      if (mode === "library-only") {
        removeBooks(selectedBooks.map((book) => book.id));
        setSelectedIds(new Set());
        setIsSelectionMode(false);
        setFeedback({
          type: "success",
          text: `已从书架移除 ${selectedBooks.length} 本书`,
        });
        return;
      }

      const results = await Promise.all(
        selectedBooks.map(async (book) => {
          try {
            await invoke<void>("delete_book_file", { path: book.path });
            return { book, ok: true as const };
          } catch (error) {
            console.error(`删除源文件失败: ${book.path}`, error);
            return { book, ok: false as const };
          }
        })
      );

      const successIds = results.filter((r) => r.ok).map((r) => r.book.id);
      const failedBooks = results.filter((r) => !r.ok).map((r) => r.book);

      if (successIds.length > 0) {
        removeBooks(successIds);
      }

      if (failedBooks.length === 0) {
        setSelectedIds(new Set());
        setIsSelectionMode(false);
        setFeedback({
          type: "success",
          text: `已删除 ${successIds.length} 本书及源文件`,
        });
        return;
      }

      setSelectedIds(new Set(failedBooks.map((book) => book.id)));
      setFeedback({
        type: "warning",
        text: `已删除 ${successIds.length} 本；${failedBooks.length} 本源文件删除失败并已保留`,
      });
    } finally {
      setDeleteDialogOpen(false);
      setRememberDeleteChoice(false);
      setIsDeleting(false);
    }
  };

  const handleDeleteClick = () => {
    if (selectedBooks.length === 0 || isDeleting) return;

    if (bookDeleteSkipConfirm) {
      void executeDelete(bookDeleteMode, false);
      return;
    }

    setPendingDeleteMode(bookDeleteMode);
    setRememberDeleteChoice(false);
    setDeleteDialogOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h2 className="text-base font-semibold text-foreground">书架</h2>
        <div className="relative mx-4 flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索书名或作者…"
            className="w-full rounded-lg border border-border/50 bg-muted/30 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>
        <div className="flex items-center gap-3">
          {isSelectionMode ? (
            <>
              <span className="text-xs font-medium text-foreground/70">
                已选 {selectedIds.size} 本
              </span>
              <button
                onClick={toggleSelectAll}
                disabled={filteredBooks.length === 0 || isDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allFilteredSelected ? "取消全选" : "全选"}
              </button>
              <button
                onClick={handleDeleteClick}
                disabled={selectedIds.size === 0 || isDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
              <button
                onClick={cancelSelectionMode}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                取消
              </button>
            </>
          ) : (
            <>
              <ThemeSwitcher />
              <div className="h-5 w-px bg-border" />
              <button
                onClick={scanFolder}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                扫描
              </button>
              <button
                onClick={importFiles}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                导入
              </button>
              <button
                onClick={enterSelectionMode}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                选择
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={cn(
            "flex items-center justify-between gap-2 border-b px-6 py-2 text-xs",
            feedback.type === "warning"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-primary/20 bg-primary/10 text-foreground"
          )}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            aria-label="关闭提示"
            className="inline-flex items-center rounded p-0.5 text-current/70 transition-colors hover:bg-black/10 hover:text-current"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 书架网格 */}
      <div className="flex-1 overflow-auto shelf-scroll">
        <BookGrid
          books={filteredBooks}
          onBookClick={onOpenBook}
          selectionMode={isSelectionMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleBookSelection}
        />
      </div>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        count={selectedIds.size}
        mode={pendingDeleteMode}
        rememberChoice={rememberDeleteChoice}
        loading={isDeleting}
        onModeChange={setPendingDeleteMode}
        onRememberChange={setRememberDeleteChoice}
        onCancel={closeDeleteDialog}
        onConfirm={() => void executeDelete(pendingDeleteMode, rememberDeleteChoice)}
      />
    </div>
  );
}
