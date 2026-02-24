import type { Book } from "@/stores/library";
import { BookCard } from "./BookCard";
import { BookPlus } from "lucide-react";

interface BookGridProps {
  books: Book[];
  onBookClick: (book: Book) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

export function BookGrid({
  books,
  onBookClick,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: BookGridProps) {
  if (books.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-muted/60">
            <BookPlus className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <p className="mt-4 text-lg font-medium text-muted-foreground">
            书架空空如也
          </p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            点击上方导入按钮添加书籍
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-6 p-6">
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          selectionMode={selectionMode}
          selected={selectedIds.has(book.id)}
          onClick={
            selectionMode ? () => onToggleSelect(book.id) : () => onBookClick(book)
          }
        />
      ))}
    </div>
  );
}
