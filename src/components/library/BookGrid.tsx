import type { Book } from "@/stores/library";
import { BookCard } from "./BookCard";
import { BookPlus } from "lucide-react";

interface BookGridProps {
  books: Book[];
  onBookClick: (book: Book) => void;
}

export function BookGrid({ books, onBookClick }: BookGridProps) {
  if (books.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <BookPlus className="mx-auto h-16 w-16 text-muted-foreground/30" />
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6 p-6">
      {books.map((book) => (
        <BookCard key={book.id} book={book} onClick={() => onBookClick(book)} />
      ))}
    </div>
  );
}
