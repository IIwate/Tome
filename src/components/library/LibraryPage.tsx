import { useMemo, useState } from "react";
import { useLibraryStore } from "@/stores/library";
import { BookGrid } from "./BookGrid";
import { ThemeSwitcher } from "@/components/layout/ThemeSwitcher";
import { Plus, FolderOpen, Search } from "lucide-react";
import type { Book } from "@/stores/library";

interface LibraryPageProps {
  onOpenBook: (book: Book) => void;
}

export function LibraryPage({ onOpenBook }: LibraryPageProps) {
  const books = useLibraryStore((s) => s.books);
  const importFiles = useLibraryStore((s) => s.importFiles);
  const scanFolder = useLibraryStore((s) => s.scanFolder);

  const [searchQuery, setSearchQuery] = useState("");

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
            data-testid="import-books-button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            导入
          </button>
        </div>
      </div>

      {/* 书架网格 */}
      <div className="flex-1 overflow-auto shelf-scroll">
        <BookGrid books={filteredBooks} onBookClick={onOpenBook} />
      </div>
    </div>
  );
}
