import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FoliateTocItem } from "@/lib/foliate";

interface PdfReaderViewProps {
  filePath: string;
  lastPosition?: string | null; // page:{pageIndex}
  onRelocate?: (position: string, percent: number) => void;
  onChaptersLoaded?: (chapters: FoliateTocItem[]) => void;
  onError?: (error: Error) => void;
}

export interface PdfReaderViewHandle {
  goToPage: (pageIndex: number) => void;
}

interface PageCache {
  dataUrl: string | null;
  height: number | null;
  loading: boolean;
  error: string | null;
}

function normalizeImageDataUrl(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bookmarkToTocItem(node: unknown): FoliateTocItem | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title : "";
  const pageIndex =
    toFiniteNumber(obj.page_index ?? obj.pageIndex ?? obj.page) ?? 0;

  const rawChildren = obj.children ?? obj.subitems ?? obj.items;
  const children = Array.isArray(rawChildren) ? rawChildren : [];
  const subitems = children
    .map(bookmarkToTocItem)
    .filter((x): x is FoliateTocItem => !!x);

  const idx = Math.max(0, Math.floor(pageIndex));
  const item: FoliateTocItem = {
    label: title || `第 ${idx + 1} 页`,
    href: idx.toString(),
  };
  if (subitems.length > 0) item.subitems = subitems;
  return item;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function parseLastPosition(lastPosition: string | null | undefined): number | null {
  if (!lastPosition) return null;
  const m = /^page:(\d+)$/.exec(lastPosition.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

interface PdfPageItemProps {
  pageIndex: number;
  dataUrl: string | null;
  height: number | null;
  loading: boolean;
  error: string | null;
  estimatedHeight: number;
  registerEl: (pageIndex: number, el: HTMLDivElement | null) => void;
  onImageLoaded: (pageIndex: number, img: HTMLImageElement) => void;
}

const PdfPageItem = memo(function PdfPageItem({
  pageIndex,
  dataUrl,
  height,
  loading,
  error,
  estimatedHeight,
  registerEl,
  onImageLoaded,
}: PdfPageItemProps) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => registerEl(pageIndex, el),
    [pageIndex, registerEl]
  );

  const placeholderHeight = height ?? estimatedHeight;

  return (
    <div
      ref={setRef}
      data-page-index={pageIndex}
      className="mb-6 flex w-full justify-center"
    >
      <div className="w-full">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`第 ${pageIndex + 1} 页`}
            className="mx-auto block max-w-full"
            style={{ maxWidth: "100%", height: "auto" }}
            onLoad={(e) => onImageLoaded(pageIndex, e.currentTarget)}
          />
        ) : (
          <div
            className="mx-auto w-full rounded-md border border-border bg-muted/10"
            style={{ height: placeholderHeight }}
          />
        )}
        {(loading || error) && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            {error ? "渲染失败" : "渲染中…"}
          </div>
        )}
      </div>
    </div>
  );
});

export const PdfReaderView = forwardRef<PdfReaderViewHandle, PdfReaderViewProps>(
  function PdfReaderView(
    { filePath, lastPosition, onRelocate, onChaptersLoaded, onError },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const [pageCount, setPageCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showSpinner, setShowSpinner] = useState(false);
    const [renderWidth, setRenderWidth] = useState(800);
    const [, forceRender] = useState(0);

    const fileTokenRef = useRef(0);
    const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
    const cacheRef = useRef<Map<number, PageCache>>(new Map());
    const nearPagesRef = useRef<Set<number>>(new Set());
    const visiblePagesRef = useRef<Set<number>>(new Set());
    const loadObserverRef = useRef<IntersectionObserver | null>(null);
    const visibleObserverRef = useRef<IntersectionObserver | null>(null);

    const onRelocateRef = useRef(onRelocate);
    onRelocateRef.current = onRelocate;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const progressPendingRef = useRef(false);
    const lastReportedRef = useRef<{ position: string; percent: number } | null>(
      null
    );

    const rerenderScheduledRef = useRef(false);
    const requestRerender = useCallback(() => {
      if (rerenderScheduledRef.current) return;
      rerenderScheduledRef.current = true;
      requestAnimationFrame(() => {
        rerenderScheduledRef.current = false;
        forceRender((v) => v + 1);
      });
    }, []);

    const registerEl = useCallback((pageIndex: number, el: HTMLDivElement | null) => {
      const map = pageElsRef.current;
      const prev = map.get(pageIndex);
      if (prev && prev !== el) {
        loadObserverRef.current?.unobserve(prev);
        visibleObserverRef.current?.unobserve(prev);
      }

      if (el) {
        map.set(pageIndex, el);
        loadObserverRef.current?.observe(el);
        visibleObserverRef.current?.observe(el);
      } else {
        if (prev) {
          loadObserverRef.current?.unobserve(prev);
          visibleObserverRef.current?.unobserve(prev);
        }
        map.delete(pageIndex);
      }
    }, []);

    const onImageLoaded = useCallback(
      (pageIndex: number, img: HTMLImageElement) => {
        const h = Math.ceil(img.getBoundingClientRect().height);
        if (!Number.isFinite(h) || h <= 0) return;
        const cache = cacheRef.current.get(pageIndex);
        if (!cache) return;
        if (cache.height !== h) {
          cache.height = h;
          cacheRef.current.set(pageIndex, cache);
          requestRerender();
        }
      },
      [requestRerender]
    );

    const ensureRenderPage = useCallback(
      async (pageIndex: number) => {
        const token = fileTokenRef.current;
        if (pageIndex < 0 || pageIndex >= pageCount) return;

        const map = cacheRef.current;
        const cache: PageCache = map.get(pageIndex) ?? {
          dataUrl: null,
          height: null,
          loading: false,
          error: null,
        };

        if (cache.dataUrl || cache.loading) {
          map.set(pageIndex, cache);
          return;
        }

        cache.loading = true;
        cache.error = null;
        map.set(pageIndex, cache);
        requestRerender();

        try {
          const width = Math.max(1, Math.round(renderWidth));
          const raw = await invoke<string>("render_pdf_page", {
            path: filePath,
            pageIndex,
            width,
          });
          if (fileTokenRef.current !== token) return;

          const next = map.get(pageIndex) ?? cache;
          next.dataUrl = normalizeImageDataUrl(raw);
          next.loading = false;
          next.error = null;
          map.set(pageIndex, next);
          requestRerender();
        } catch (err) {
          if (fileTokenRef.current !== token) return;
          const msg = err instanceof Error ? err.message : String(err);
          const next = map.get(pageIndex) ?? cache;
          next.loading = false;
          next.error = msg || "渲染失败";
          map.set(pageIndex, next);
          requestRerender();
          onErrorRef.current?.(err instanceof Error ? err : new Error(msg));
        }
      },
      [filePath, pageCount, renderWidth, requestRerender]
    );

    const processNearPages = useCallback(() => {
      if (pageCount <= 0) return;

      const near = nearPagesRef.current;
      if (near.size === 0) return;

      const wanted = new Set<number>();
      let minNear = Number.POSITIVE_INFINITY;
      let maxNear = Number.NEGATIVE_INFINITY;

      for (const idx of near) {
        minNear = Math.min(minNear, idx);
        maxNear = Math.max(maxNear, idx);
        for (let d = -2; d <= 2; d++) {
          const p = idx + d;
          if (p >= 0 && p < pageCount) wanted.add(p);
        }
      }

      for (const idx of wanted) {
        void ensureRenderPage(idx);
      }

      if (!Number.isFinite(minNear) || !Number.isFinite(maxNear)) return;

      const keepMin = Math.max(minNear - 6, 0);
      const keepMax = Math.min(maxNear + 6, pageCount - 1);

      let changed = false;
      const map = cacheRef.current;
      for (const [i, cache] of map) {
        if (cache.dataUrl && (i < keepMin || i > keepMax)) {
          cache.dataUrl = null;
          cache.loading = false;
          cache.error = null;
          map.set(i, cache);
          changed = true;
        }
      }
      if (changed) requestRerender();
    }, [ensureRenderPage, pageCount, requestRerender]);

    const nearProcessScheduledRef = useRef(false);
    const scheduleProcessNear = useCallback(() => {
      if (nearProcessScheduledRef.current) return;
      nearProcessScheduledRef.current = true;
      requestAnimationFrame(() => {
        nearProcessScheduledRef.current = false;
        processNearPages();
      });
    }, [processNearPages]);

    const scrollToPage = useCallback(
      (pageIndex: number, behavior: ScrollBehavior) => {
        const container = containerRef.current;
        if (!container || pageCount <= 0) return;

        const idx = clampInt(pageIndex, 0, pageCount - 1);
        const el =
          pageElsRef.current.get(idx) ??
          (container.querySelector(
            `[data-page-index="${idx}"]`
          ) as HTMLDivElement | null);

        el?.scrollIntoView({ behavior, block: "start" });
      },
      [pageCount]
    );

    useImperativeHandle(
      ref,
      () => ({
        goToPage: (pageIndex: number) => scrollToPage(pageIndex, "smooth"),
      }),
      [scrollToPage]
    );

    // 读取 PDF 信息（页数 + 书签）
    useEffect(() => {
      let cancelled = false;
      const token = ++fileTokenRef.current;

      setLoading(true);
      setError(null);
      setPageCount(0);
      cacheRef.current.clear();
      nearPagesRef.current.clear();
      visiblePagesRef.current.clear();
      lastReportedRef.current = null;

      (async () => {
        try {
          const info = await invoke<{
            page_count?: unknown;
            pageCount?: unknown;
            bookmarks?: unknown;
          }>("get_pdf_info", { path: filePath });
          if (cancelled || fileTokenRef.current !== token) return;

          const pcRaw = info.page_count ?? info.pageCount ?? 0;
          const pc = clampInt(toFiniteNumber(pcRaw) ?? 0, 0, 1_000_000);
          setPageCount(pc);

          const bookmarks = Array.isArray(info.bookmarks) ? info.bookmarks : [];
          const toc = bookmarks
            .map(bookmarkToTocItem)
            .filter((x): x is FoliateTocItem => !!x);
          onChaptersLoaded?.(toc);
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          onErrorRef.current?.(err instanceof Error ? err : new Error(msg));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // 延迟显示 spinner（避免短加载闪烁）
    useEffect(() => {
      if (!loading) {
        setShowSpinner(false);
        return;
      }
      const t = setTimeout(() => setShowSpinner(true), 300);
      return () => clearTimeout(t);
    }, [loading]);

    // 计算渲染宽度（用于 render_pdf_page）
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const update = () => {
        const w = Math.max(container.clientWidth - 32, 320);
        setRenderWidth(w);
      };

      update();
      const ro = new ResizeObserver(() => update());
      ro.observe(container);
      return () => ro.disconnect();
    }, []);

    // IntersectionObserver：懒加载 + 进度可见页集合
    useEffect(() => {
      const container = containerRef.current;
      if (!container || loading || error || pageCount <= 0) return;

      const loadObserver = new IntersectionObserver(
        (entries) => {
          let changed = false;
          const near = nearPagesRef.current;

          for (const entry of entries) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.pageIndex
            );
            if (!Number.isFinite(idx)) continue;
            if (entry.isIntersecting) {
              if (!near.has(idx)) {
                near.add(idx);
                changed = true;
              }
            } else {
              if (near.delete(idx)) changed = true;
            }
          }

          if (changed) scheduleProcessNear();
        },
        {
          root: container,
          rootMargin: "800px 0px 800px 0px",
          threshold: 0.01,
        }
      );
      loadObserverRef.current = loadObserver;

      const visibleObserver = new IntersectionObserver(
        (entries) => {
          const visible = visiblePagesRef.current;
          for (const entry of entries) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.pageIndex
            );
            if (!Number.isFinite(idx)) continue;
            if (entry.isIntersecting) visible.add(idx);
            else visible.delete(idx);
          }
        },
        { root: container, rootMargin: "0px", threshold: 0.01 }
      );
      visibleObserverRef.current = visibleObserver;

      for (const el of pageElsRef.current.values()) {
        loadObserver.observe(el);
        visibleObserver.observe(el);
      }

      return () => {
        loadObserver.disconnect();
        visibleObserver.disconnect();
        loadObserverRef.current = null;
        visibleObserverRef.current = null;
        nearPagesRef.current.clear();
        visiblePagesRef.current.clear();
      };
    }, [error, loading, pageCount, scheduleProcessNear]);

    // 滚动进度追踪（节流 100ms）
    useEffect(() => {
      const container = containerRef.current;
      if (!container || loading || error || pageCount <= 0) return;

      const flushProgress = () => {
        const visible = visiblePagesRef.current;
        const idx =
          visible.size > 0
            ? Math.min(...Array.from(visible))
            : clampInt(Math.round(container.scrollTop / Math.max(container.clientHeight, 1)), 0, pageCount - 1);

        const pageIndex = clampInt(idx, 0, pageCount - 1);
        const position = `page:${pageIndex}`;
        const percent = Math.round(
          (pageIndex / Math.max(pageCount - 1, 1)) * 100
        );

        const last = lastReportedRef.current;
        if (last && last.position === position && last.percent === percent) return;

        lastReportedRef.current = { position, percent };
        onRelocateRef.current?.(position, percent);
      };

      const requestFlush = () => {
        if (progressTimerRef.current) {
          progressPendingRef.current = true;
          return;
        }
        flushProgress();
        progressTimerRef.current = setTimeout(() => {
          progressTimerRef.current = null;
          if (progressPendingRef.current) {
            progressPendingRef.current = false;
            requestFlush();
          }
        }, 100);
      };

      const onScroll = () => requestFlush();
      container.addEventListener("scroll", onScroll, { passive: true });

      return () => {
        container.removeEventListener("scroll", onScroll);
        if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
        progressPendingRef.current = false;
        flushProgress();
      };
    }, [error, loading, pageCount]);

    // 恢复上次阅读位置
    useEffect(() => {
      if (loading || error || pageCount <= 0) return;
      const idx = parseLastPosition(lastPosition);
      if (idx == null) return;

      requestAnimationFrame(() => {
        scrollToPage(idx, "auto");
      });
    }, [error, lastPosition, loading, pageCount, scrollToPage]);

    // 键盘快捷键（与 EPUB 滚动模式一致）
    useEffect(() => {
      if (loading || error) return;

      const onKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (document.querySelector('[role="dialog"], [data-state="open"]')) return;

        const container = containerRef.current;
        if (!container) return;

        const step = container.clientHeight * 0.9;

        switch (e.key) {
          case "ArrowDown":
          case "PageDown":
            e.preventDefault();
            container.scrollBy({ top: step, behavior: "smooth" });
            break;
          case "ArrowUp":
          case "PageUp":
            e.preventDefault();
            container.scrollBy({ top: -step, behavior: "smooth" });
            break;
          case " ":
            e.preventDefault();
            container.scrollBy({
              top: e.shiftKey ? -step : step,
              behavior: "smooth",
            });
            break;
        }
      };

      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [error, loading]);

    const estimatedHeight = Math.max(Math.round(renderWidth * 1.4), 320);

    return (
      <div
        ref={containerRef}
        className="reader-scroll relative h-full overflow-y-auto bg-background"
      >
        {showSpinner && !error && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center"
            role="status"
          >
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-sm text-destructive">加载失败：{error}</div>
          </div>
        )}

        <div ref={contentRef} className="px-4 py-6">
          {pageCount > 0 &&
            Array.from({ length: pageCount }, (_, i) => {
              const cache = cacheRef.current.get(i);
              return (
                <PdfPageItem
                  key={i}
                  pageIndex={i}
                  dataUrl={cache?.dataUrl ?? null}
                  height={cache?.height ?? null}
                  loading={cache?.loading ?? false}
                  error={cache?.error ?? null}
                  estimatedHeight={estimatedHeight}
                  registerEl={registerEl}
                  onImageLoaded={onImageLoaded}
                />
              );
            })}
        </div>

        <div className="h-[40vh]" aria-hidden="true" />
      </div>
    );
  }
);

