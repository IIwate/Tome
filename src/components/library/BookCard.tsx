import type { Book } from "@/stores/library";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface BookCardProps {
  book: Book;
  selectionMode: boolean;
  selected: boolean;
  onClick: () => void;
}

export function BookCard({ book, selectionMode, selected, onClick }: BookCardProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selectionMode ? selected : undefined}
      aria-label={
        selectionMode
          ? `${selected ? "取消选中" : "选中"}《${book.title}》`
          : `打开《${book.title}》`
      }
      className="group w-full cursor-pointer text-left focus:outline-none"
    >
      <div
        className={cn(
          "relative aspect-[3/4] overflow-hidden rounded-xl",
          "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_4px_16px_-4px_rgba(0,0,0,0.08)]",
          "transition-all duration-300 ease-out",
          selected
            ? "ring-2 ring-primary shadow-[0_10px_28px_-8px_hsl(var(--primary)/0.45)]"
            : "ring-1 ring-border/50",
          selectionMode
            ? "group-hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.15),0_4px_12px_-2px_rgba(0,0,0,0.1)]"
            : "group-hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.15),0_4px_12px_-2px_rgba(0,0,0,0.1)] group-hover:scale-[1.03] group-hover:-translate-y-0.5",
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

        {selectionMode && (
          <div
            className={cn(
              "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white/95 transition-colors",
              selected && "border-primary bg-primary text-primary-foreground"
            )}
          >
            <Check className="h-3.5 w-3.5" />
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
