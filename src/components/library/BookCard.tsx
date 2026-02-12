import type { Book } from "@/stores/library";
import { cn } from "@/lib/utils";

interface BookCardProps {
  book: Book;
  onClick: () => void;
}

export function BookCard({ book, onClick }: BookCardProps) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left focus:outline-none"
    >
      <div
        className={cn(
          "aspect-[3/4] overflow-hidden rounded-xl shadow-md",
          "transition-all duration-200",
          "group-hover:shadow-lg group-hover:scale-[1.02]",
          "group-focus-visible:ring-2 group-focus-visible:ring-ring"
        )}
      >
        {book.coverDataUrl ? (
          <img
            src={book.coverDataUrl}
            alt={book.title}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <span className="text-4xl text-muted-foreground/40">
              {book.title[0] || "?"}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1 px-0.5">
        <p className="truncate text-sm font-medium text-foreground">
          {book.title}
        </p>
        {book.author && (
          <p className="truncate text-xs text-muted-foreground">
            {book.author}
          </p>
        )}
        {book.progress.percent > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/60 transition-all"
                style={{ width: `${book.progress.percent}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {Math.round(book.progress.percent)}%
            </span>
          </div>
        )}
      </div>
    </button>
  );
}
