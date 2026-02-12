import { useLibraryStore } from "@/stores/library";
import { BookGrid } from "./BookGrid";
import { ThemeSwitcher } from "@/components/layout/ThemeSwitcher";
import { Plus, FolderOpen } from "lucide-react";
import type { Book } from "@/stores/library";

interface LibraryPageProps {
  onOpenBook: (book: Book) => void;
}

export function LibraryPage({ onOpenBook }: LibraryPageProps) {
  const books = useLibraryStore((s) => s.books);
  const importFiles = useLibraryStore((s) => s.importFiles);
  const scanFolder = useLibraryStore((s) => s.scanFolder);

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h2 className="text-base font-semibold text-foreground">书架</h2>
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            导入
          </button>
        </div>
      </div>

      {/* 书架网格 */}
      <div className="flex-1 overflow-auto">
        <BookGrid books={books} onBookClick={onOpenBook} />
      </div>
    </div>
  );
}
