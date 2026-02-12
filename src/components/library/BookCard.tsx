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
          "aspect-[3/4] overflow-hidden rounded-xl",
          "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_4px_16px_-4px_rgba(0,0,0,0.08)]",
          "ring-1 ring-border/50",
          "transition-all duration-300 ease-out",
          "group-hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.15),0_4px_12px_-2px_rgba(0,0,0,0.1)]",
          "group-hover:scale-[1.03] group-hover:-translate-y-0.5",
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
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-secondary">
            <span className="text-4xl font-bold text-muted-foreground/30">
              {book.title[0] || "?"}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-1 px-0.5">
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
                className="h-full rounded-full bg-primary/50 transition-[width] duration-300 ease-out"
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
