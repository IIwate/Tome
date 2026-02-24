import { useCallback, useEffect, useRef, useState } from "react";
import { ReadingProgressBar } from "./ReadingProgressBar";
import { ArrowLeft, List, Settings } from "lucide-react";

interface ControlOverlayProps {
  title: string;
  percent: number;
  hasChapters: boolean;
  onBack: () => void;
  onOpenChapters: () => void;
  onOpenSettings: () => void;
}

const IDLE_TIMEOUT = 3000;
const EDGE_ZONE = 40;

export function ControlOverlay({
  title,
  percent,
  hasChapters,
  onBack,
  onOpenChapters,
  onOpenSettings,
}: ControlOverlayProps) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visibleRef = useRef(true);

  const startHideTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      visibleRef.current = false;
    }, IDLE_TIMEOUT);
  }, []);

  const showOverlay = useCallback(() => {
    setVisible(true);
    visibleRef.current = true;
    startHideTimer();
  }, [startHideTimer]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (visibleRef.current) {
        // 已可见：重置隐藏计时器
        startHideTimer();
        return;
      }
      // 已隐藏：仅在边缘区域唤出
      const { clientY, clientX } = e;
      const { innerHeight, innerWidth } = window;
      const atEdge =
        clientY <= EDGE_ZONE ||
        clientY >= innerHeight - EDGE_ZONE ||
        clientX <= EDGE_ZONE ||
        clientX >= innerWidth - EDGE_ZONE;
      if (atEdge) showOverlay();
    };

    const handleClick = () => {
      if (!visibleRef.current) showOverlay();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("click", handleClick);
    startHideTimer();

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("click", handleClick);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [showOverlay, startHideTimer]);

  const interactiveClass = visible ? "pointer-events-auto" : "pointer-events-none";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between"
    >
      {/* 顶部栏（mr-2 避免遮挡滚动条） */}
      <div
        className={`${interactiveClass} mr-2 flex items-center gap-3 bg-background/80 px-4 py-2 backdrop-blur-md transition-all duration-300 ease-out`}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(-100%)",
        }}
      >
        <button
          onClick={onBack}
          aria-label="返回书架"
          className="rounded-lg p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="flex-1 truncate text-sm font-medium text-foreground">
          {title}
        </h2>
        {hasChapters && (
          <button
            onClick={onOpenChapters}
            aria-label="章节目录"
            className="rounded-lg p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
          >
            <List className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onOpenSettings}
          aria-label="排版设置"
          className="rounded-lg p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* 底部栏（mr-2 避免遮挡滚动条） */}
      <div
        className={`${interactiveClass} mr-2 bg-background/80 backdrop-blur-md transition-all duration-300 ease-out`}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(100%)",
        }}
      >
        <ReadingProgressBar percent={percent} />
      </div>
    </div>
  );
}
