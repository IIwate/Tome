import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createView,
  openEpub,
  injectStyles,
  closeView,
  type FoliateView,
  type FoliateLocation,
  type FoliateTocItem,
} from "@/lib/foliate";
import { useSettingsStore } from "@/stores/settings";
import { logError, logInfo } from "@/lib/logger";

interface ReaderViewProps {
  /** EPUB 文件绝对路径 */
  filePath: string;
  /** 上次阅读位置 (CFI) */
  lastPosition?: string | null;
  /** 进度变更回调 */
  onRelocate?: (location: FoliateLocation) => void;
  /** TOC 加载完成回调 */
  onTocLoaded?: (toc: FoliateTocItem[]) => void;
  /** 加载错误回调 */
  onError?: (error: Error) => void;
}

export interface ReaderViewHandle {
  goTo: (target: string | number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
}

/** 从 CSS 变量获取计算后的颜色值 */
function getCssColor(varName: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return raw ? `hsl(${raw})` : "";
}

const SOURCE = "reader/ReaderView";

function countTocItems(items: FoliateTocItem[] | undefined): number {
  if (!items || items.length === 0) return 0;
  let count = 0;
  for (const item of items) {
    count += 1;
    if (item.subitems) count += countTocItems(item.subitems);
  }
  return count;
}

export const ReaderView = forwardRef<ReaderViewHandle, ReaderViewProps>(
  function ReaderView(
    { filePath, lastPosition, onRelocate, onTocLoaded, onError },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<FoliateView | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showSpinner, setShowSpinner] = useState(false);

    // 从设置 store 获取排版参数
    const fontFamily = useSettingsStore((s) => s.fontFamily);
    const fontSize = useSettingsStore((s) => s.fontSize);
    const lineHeight = useSettingsStore((s) => s.lineHeight);
    const margin = useSettingsStore((s) => s.margin);
    const theme = useSettingsStore((s) => s.theme);

    // 用 ref 存储最新的样式注入函数，避免闭包过期
    const handleLoadRef = useRef(
      (_detail: { doc: Document; index: number }) => {}
    );

    handleLoadRef.current = useCallback(
      ({ doc }: { doc: Document; index: number }) => {
        injectStyles(doc, {
          fontFamily,
          fontSize,
          lineHeight,
          margin,
          color: getCssColor("--foreground"),
          background: getCssColor("--background"),
        });
      },
      [fontFamily, fontSize, lineHeight, margin, theme]
    );

    // 暴露导航方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        goTo: async (target: string | number) => {
          try {
            await viewRef.current?.goTo(target);
          } catch (err) {
            logError(SOURCE, "章节跳转失败", err);
          }
        },
        next: async () => {
          try {
            await viewRef.current?.next();
          } catch (err) {
            logError(SOURCE, "下一章失败", err);
          }
        },
        prev: async () => {
          try {
            await viewRef.current?.prev();
          } catch (err) {
            logError(SOURCE, "上一章失败", err);
          }
        },
      }),
      []
    );

    // 初始化 EPUB 阅读器
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let cancelled = false;
      const view = createView();
      viewRef.current = view;

      // 全屏尺寸
      view.style.width = "100%";
      view.style.height = "100%";
      // 暴露 CSS part 以便从外部样式化内部滚动条
      view.setAttribute("exportparts", "container");
      container.appendChild(view);

      (async () => {
        try {
          setLoading(true);
          setError(null);
          // 从 Rust 读取文件字节
          const bytes = await invoke<ArrayBuffer>("read_file_bytes", {
            path: filePath,
          });
          if (cancelled) return;

          // 带超时的 openEpub，防止 CSP 等问题导致永久挂起
          await Promise.race([
            openEpub(view, new Uint8Array(bytes), {
              lastLocation: lastPosition ?? undefined,
              onRelocate,
              // getter 模式：每次事件触发时获取最新回调
              getOnLoad: () => handleLoadRef.current,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("EPUB 加载超时")), 30_000)
            ),
          ]);

          if (cancelled) return;

          logInfo(SOURCE, "EPUB 加载成功", {
            chapterCount: view.book?.sections?.length ?? 0,
            tocCount: countTocItems(view.book?.toc),
          });

          // 通知 TOC 加载完成
          if (view.book?.toc) {
            onTocLoaded?.(view.book.toc);
          }
        } catch (err) {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : String(err);
            logError(SOURCE, "EPUB 加载失败", err);
            setError(msg);
            onError?.(err instanceof Error ? err : new Error(msg));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
        if (viewRef.current) {
          closeView(viewRef.current);
          viewRef.current = null;
        }
      };
      // filePath 变更时重新加载
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // 设置变更时重新注入样式到已加载的 sections
    useEffect(() => {
      const view = viewRef.current;
      if (!view?.renderer) return;
      const contents = view.renderer.getContents?.();
      if (contents) {
        for (const { doc } of contents) {
          injectStyles(doc, {
            fontFamily,
            fontSize,
            lineHeight,
            margin,
            color: getCssColor("--foreground"),
            background: getCssColor("--background"),
          });
        }
      }
    }, [fontFamily, fontSize, lineHeight, margin, theme]);

    // 延迟显示 spinner（避免短加载闪烁）
    useEffect(() => {
      if (!loading) {
        setShowSpinner(false);
        return;
      }
      const timer = setTimeout(() => setShowSpinner(true), 300);
      return () => clearTimeout(timer);
    }, [loading]);

    // 章节间导航：iframe 内 wheel 边界检测 + 键盘快捷键
    // foliate 在 iframe 中渲染章节内容，wheel 事件不会跨文档冒泡，
    // 因此必须在每个章节文档内部监听 wheel 事件。
    useEffect(() => {
      const view = viewRef.current;
      if (loading || error || !view) return;

      const renderer = view.renderer;
      if (!renderer) return;

      const THRESHOLD = 10;
      let navigating = false;
      let cooldownTimer: ReturnType<typeof setTimeout> | undefined;

      const navigate = (dir: "next" | "prev") => {
        if (navigating) return;
        navigating = true;
        if (cooldownTimer) clearTimeout(cooldownTimer);
        view[dir]()
          .catch(() => {})
          .finally(() => {
            cooldownTimer = setTimeout(() => {
              navigating = false;
            }, 400);
          });
      };

      // 边界检测逻辑（在 iframe 文档的 wheel 事件中调用）
      const handleWheel = (e: WheelEvent) => {
        if (navigating) return;

        const vSize = renderer.viewSize ?? 0;
        const size = renderer.size ?? 0;
        const isShort = vSize <= size + THRESHOLD;

        if (isShort) {
          // 短内容（不溢出视口）：直接翻章
          if (e.deltaY > 0) navigate("next");
          else if (e.deltaY < 0) navigate("prev");
          return;
        }

        // 长内容：检测滚动边界
        const start = renderer.start ?? 0;
        const end = renderer.end ?? 0;

        if (e.deltaY > 0 && vSize - end <= THRESHOLD) {
          navigate("next");
        } else if (e.deltaY < 0 && start <= THRESHOLD) {
          navigate("prev");
        }
      };

      // 每个章节加载后，在其 iframe 文档内注册 wheel 监听
      const onChapterLoad = ((
        e: CustomEvent<{ doc: Document; index: number }>
      ) => {
        e.detail.doc.addEventListener("wheel", handleWheel, {
          passive: true,
        });
      }) as EventListener;

      view.addEventListener("load", onChapterLoad);

      // 键盘快捷键（面板打开时跳过）
      // view.next()/prev() 自带 section 内滚动 + 边界翻章逻辑
      const onKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (
          document.querySelector('[role="dialog"], [data-state="open"]')
        )
          return;

        switch (e.key) {
          case "ArrowRight":
          case "PageDown":
            e.preventDefault();
            view.next();
            break;
          case "ArrowLeft":
          case "PageUp":
            e.preventDefault();
            view.prev();
            break;
          case " ":
            e.preventDefault();
            e.shiftKey ? view.prev() : view.next();
            break;
        }
      };

      window.addEventListener("keydown", onKeyDown);

      return () => {
        if (cooldownTimer) clearTimeout(cooldownTimer);
        view.removeEventListener("load", onChapterLoad);
        window.removeEventListener("keydown", onKeyDown);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, error]);

    return (
      <div ref={containerRef} className="relative h-full w-full bg-background">
        {showSpinner && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center" role="status">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-sm text-destructive">加载失败：{error}</div>
          </div>
        )}
      </div>
    );
  }
);
