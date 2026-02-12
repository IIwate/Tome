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
}

/** 从 CSS 变量获取计算后的颜色值 */
function getCssColor(varName: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return raw ? `hsl(${raw})` : "";
}

export const ReaderView = forwardRef<ReaderViewHandle, ReaderViewProps>(
  function ReaderView(
    { filePath, lastPosition, onRelocate, onTocLoaded, onError },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<FoliateView | null>(null);
    const [loading, setLoading] = useState(true);

    // 从设置 store 获取排版参数
    const fontFamily = useSettingsStore((s) => s.fontFamily);
    const fontSize = useSettingsStore((s) => s.fontSize);
    const lineHeight = useSettingsStore((s) => s.lineHeight);
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
          color: getCssColor("--foreground"),
          background: getCssColor("--background"),
        });
      },
      [fontFamily, fontSize, lineHeight, theme]
    );

    // 暴露 goTo 方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        goTo: async (target: string | number) => {
          try {
            await viewRef.current?.goTo(target);
          } catch (err) {
            console.error("章节跳转失败:", err);
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
      container.appendChild(view);

      (async () => {
        try {
          setLoading(true);
          // 从 Rust 读取文件字节
          const bytes = await invoke<ArrayBuffer>("read_file_bytes", {
            path: filePath,
          });
          if (cancelled) return;

          await openEpub(view, new Uint8Array(bytes), {
            lastLocation: lastPosition ?? undefined,
            onRelocate,
            // getter 模式：每次事件触发时获取最新回调
            getOnLoad: () => handleLoadRef.current,
          });

          if (cancelled) return;

          // 通知 TOC 加载完成
          if (view.book?.toc) {
            onTocLoaded?.(view.book.toc);
          }
        } catch (err) {
          if (!cancelled) {
            console.error("EPUB 加载失败:", err);
            onError?.(err instanceof Error ? err : new Error(String(err)));
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
            color: getCssColor("--foreground"),
            background: getCssColor("--background"),
          });
        }
      }
    }, [fontFamily, fontSize, lineHeight, theme]);

    return (
      <div ref={containerRef} className="relative h-full w-full bg-background">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-sm text-muted-foreground">加载中…</div>
          </div>
        )}
      </div>
    );
  }
);
