interface ReadingProgressBarProps {
  percent: number;
}

export function ReadingProgressBar({ percent }: ReadingProgressBarProps) {
  const clamped = Math.max(0, Math.min(Math.round(percent), 100));

  return (
    <div className="flex items-center gap-3 border-t border-border/50 px-4 py-1.5">
      <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/70 transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="min-w-[3ch] text-right text-xs tabular-nums text-muted-foreground">
        {clamped}%
      </span>
    </div>
  );
}
