import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useCallback, useState, useEffect } from "react";

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // 初始化时获取当前最大化状态
    appWindow.isMaximized().then(setMaximized);

    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [appWindow]);

  const handleMinimize = useCallback(() => {
    appWindow.minimize();
  }, [appWindow]);

  const handleToggleMaximize = useCallback(() => {
    appWindow.toggleMaximize();
  }, [appWindow]);

  const handleClose = useCallback(() => {
    appWindow.close();
  }, [appWindow]);

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3">
        <span
          data-tauri-drag-region
          className="text-sm font-medium text-foreground/80"
        >
          Reader
        </span>
      </div>

      <div className="flex h-full items-center">
        <button
          onClick={handleMinimize}
          className="inline-flex h-full w-11 items-center justify-center text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="inline-flex h-full w-11 items-center justify-center text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          {maximized ? (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="5" width="8" height="8" rx="1" />
              <path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2H12.5A1.5 1.5 0 0 1 14 3.5V9.5A1.5 1.5 0 0 1 12.5 11H11" />
            </svg>
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="inline-flex h-full w-11 items-center justify-center text-foreground/60 transition-colors hover:bg-red-500/90 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}
