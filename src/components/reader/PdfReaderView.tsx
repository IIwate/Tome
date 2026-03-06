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
import type { BookConfig } from "@/lib/book-config";
import { fromPdfBookmarks, type BookDocTocItem } from "@/lib/book-doc";
import { calcRenderWindow } from "@/lib/render-window";
import { logInfo } from "@/lib/logger";

interface PdfReaderViewProps {
  filePath: string;
  lastPosition?: string | null; // page:{pageIndex}
  config: BookConfig;
  onRelocate?: (position: string, percent: number) => void;
  onChaptersLoaded?: (chapters: BookDocTocItem[]) => void;
  onError?: (error: Error) => void;
}

export interface PdfReaderViewHandle {
  goToPage: (pageIndex: number) => void;
}

export interface PageCache {
  url: string | null;
  height: number | null;
  loading: boolean;
  error: string | null;
}

export type RenderPageResult =
  | { kind: "file"; page_index: number; width: number; resource_url: string }
  | { kind: "data"; page_index: number; width: number; data_url: string };

export interface EvictPdfPageCacheByDistanceOptions {
  cacheKeys: Iterable<number>;
  pinned: Iterable<number>;
  anchors: Iterable<number>;
  max: number;
}

type RenderTaskPriority = 0 | 1 | 2;

interface PendingRenderTask {
  pageIndex: number;
  priority: RenderTaskPriority;
  sequence: number;
}

interface RenderScheduler {
  token: number;
  runningCount: number;
  runningPages: Set<number>;
  queue: Map<number, PendingRenderTask>;
  desiredPriorities: Map<number, RenderTaskPriority>;
  sequence: number;
  cancelled: boolean;
}

export const MAX_CACHED_PAGES = 200;
const RENDER_CONCURRENCY = 2;

function distanceToAnchors(pageIndex: number, anchors: readonly number[]): number {
  if (anchors.length === 0) return 0;
  return Math.min(...anchors.map((anchor) => Math.abs(anchor - pageIndex)));
}

function createRenderScheduler(token: number): RenderScheduler {
  return {
    token,
    runningCount: 0,
    runningPages: new Set(),
    queue: new Map(),
    desiredPriorities: new Map(),
    sequence: 0,
    cancelled: false,
  };
}

export function resolveRenderPageUrl(result: RenderPageResult): string {
  return result.kind === "file" ? result.resource_url : result.data_url;
}

export function applyRenderPageResult(
  cache: PageCache,
  result: RenderPageResult
): PageCache {
  return {
    ...cache,
    url: resolveRenderPageUrl(result),
    loading: false,
    error: null,
  };
}

export function evictPdfPageCacheByDistance({
  cacheKeys,
  pinned,
  anchors,
  max,
}: EvictPdfPageCacheByDistanceOptions): Set<number> {
  const keyList = Array.from(new Set(cacheKeys)).filter((key) =>
    Number.isInteger(key)
  );
  if (keyList.length <= max) return new Set<number>();

  const pinnedSet = new Set(
    Array.from(new Set(pinned)).filter((key) => Number.isInteger(key))
  );
  const anchorList = Array.from(new Set(anchors)).filter((key) =>
    Number.isInteger(key)
  );
  const removable = keyList.filter((key) => !pinnedSet.has(key));
  const overflow = Math.min(keyList.length - max, removable.length);

  removable.sort((a, b) => {
    const distDiff = distanceToAnchors(b, anchorList) - distanceToAnchors(a, anchorList);
    if (distDiff !== 0) return distDiff;
    return b - a;
  });

  return new Set(removable.slice(0, overflow));
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
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

const SOURCE = "reader/PdfReaderView";
const PAGE_GAP_PX = 24; // tailwind: mb-6（默认 1.5rem = 24px）
const WINDOW_BUFFER_PAGES = 8;
const LOAD_ROOT_MARGIN_PX = 320;
// 与后端 src-tauri/src/commands/pdf.rs 的 MAX_RENDER_WIDTH 对齐
const MAX_RENDER_PDF_PAGE_WIDTH = 2000;

interface PdfPageItemProps {
  pageIndex: number;
  url: string | null;
  height: number | null;
  loading: boolean;
  error: string | null;
  estimatedHeight: number;
  registerEl: (pageIndex: number, el: HTMLDivElement | null) => void;
  onImageLoaded: (pageIndex: number, img: HTMLImageElement) => void;
  onImageError: (pageIndex: number) => void;
}

export const PdfPageItem = memo(function PdfPageItem({
  pageIndex,
  url,
  height,
  loading,
  error,
  estimatedHeight,
  registerEl,
  onImageLoaded,
  onImageError,
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
        {url ? (
          <img
            src={url}
            alt={`第 ${pageIndex + 1} 页`}
            className="mx-auto block max-w-full"
            style={{ maxWidth: "100%", height: "auto" }}
            onLoad={(e) => onImageLoaded(pageIndex, e.currentTarget)}
            onError={() => onImageError(pageIndex)}
          />
        ) : (
          <div
            className="mx-auto flex w-full items-center justify-center"
            style={{ height: placeholderHeight }}
          >
            {error ? (
              <div
                data-testid="pdf-page-error"
                className="text-sm text-destructive"
              >
                渲染失败
              </div>
            ) : loading ? (
              <div
                data-testid="pdf-page-loading"
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                <span>加载中...</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
});

export const PdfReaderView = forwardRef<PdfReaderViewHandle, PdfReaderViewProps>(
  function PdfReaderView(
    { filePath, lastPosition, config: _config, onRelocate, onChaptersLoaded, onError },
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
    const [scrollAnchor, setScrollAnchor] = useState(0);
    const scrollAnchorRef = useRef(0);

    const fileTokenRef = useRef(0);
    const renderSchedulerRef = useRef<RenderScheduler>(createRenderScheduler(0));
    const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
    const cacheRef = useRef<Map<number, PageCache>>(new Map());
    const nearPagesRef = useRef<Set<number>>(new Set());
    const visiblePagesRef = useRef<Set<number>>(new Set());
    const firstPageSettledRef = useRef(false);
    const scheduleProcessNearRef = useRef<() => void>(() => {});
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
        nearPagesRef.current.delete(pageIndex);
        visiblePagesRef.current.delete(pageIndex);
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
        if (!firstPageSettledRef.current && pageIndex === scrollAnchorRef.current) {
          firstPageSettledRef.current = true;
          scheduleProcessNearRef.current();
        }
      },
      [requestRerender]
    );

    const onImageError = useCallback(
      (pageIndex: number) => {
        const cache = cacheRef.current.get(pageIndex);
        if (!cache) return;
        cache.url = null;
        cache.loading = false;
        cache.error = "渲染失败";
        cacheRef.current.set(pageIndex, cache);
        requestRerender();
        onErrorRef.current?.(new Error(`PDF 页面图片加载失败: page=${pageIndex}`));
      },
      [requestRerender]
    );

    const resetPendingPage = useCallback(
      (pageIndex: number) => {
        const cache = cacheRef.current.get(pageIndex);
        if (!cache || cache.url || !cache.loading) return;
        cache.loading = false;
        cache.error = null;
        cacheRef.current.set(pageIndex, cache);
      },
      []
    );

    const pumpRenderQueueRef = useRef<(scheduler?: RenderScheduler) => void>(() => {});

    const runRenderTask = useCallback(
      async (task: PendingRenderTask, scheduler: RenderScheduler) => {
        try {
          if (scheduler.cancelled || fileTokenRef.current !== scheduler.token) return;

          const width = Math.min(
            Math.max(1, Math.round(renderWidth)),
            MAX_RENDER_PDF_PAGE_WIDTH
          );
          const result = await invoke<RenderPageResult>("render_pdf_page", {
            path: filePath,
            pageIndex: task.pageIndex,
            width,
          });

          if (scheduler.cancelled || fileTokenRef.current !== scheduler.token) return;

          const cache = cacheRef.current.get(task.pageIndex);
          if (!cache) return;
          const next = applyRenderPageResult(cache, result);
          cacheRef.current.set(task.pageIndex, next);
          requestRerender();
        } catch (err) {
          if (scheduler.cancelled || fileTokenRef.current !== scheduler.token) return;
          const msg = err instanceof Error ? err.message : String(err);
          const cache = cacheRef.current.get(task.pageIndex);
          if (!cache) return;
          cache.loading = false;
          cache.error = msg || "渲染失败";
          cacheRef.current.set(task.pageIndex, cache);
          requestRerender();
          onErrorRef.current?.(err instanceof Error ? err : new Error(msg));
        } finally {
          scheduler.runningPages.delete(task.pageIndex);
          scheduler.runningCount = Math.max(0, scheduler.runningCount - 1);
          if (!scheduler.cancelled) {
            pumpRenderQueueRef.current(scheduler);
          }
        }
      },
      [filePath, renderWidth, requestRerender]
    );

    const pumpRenderQueue = useCallback(
      (scheduler: RenderScheduler = renderSchedulerRef.current) => {
        if (scheduler.cancelled) return;

        while (scheduler.runningCount < RENDER_CONCURRENCY) {
          const candidates = Array.from(scheduler.queue.values()).filter((task) =>
            scheduler.desiredPriorities.has(task.pageIndex)
          );
          if (candidates.length === 0) return;

          candidates.sort((left, right) => {
            if (left.priority !== right.priority) {
              return left.priority - right.priority;
            }

            const leftDistance = Math.abs(left.pageIndex - scrollAnchorRef.current);
            const rightDistance = Math.abs(right.pageIndex - scrollAnchorRef.current);
            if (leftDistance !== rightDistance) {
              return leftDistance - rightDistance;
            }

            return left.sequence - right.sequence;
          });

          const task = candidates[0];
          if (!task) return;

          scheduler.queue.delete(task.pageIndex);
          scheduler.runningPages.add(task.pageIndex);
          scheduler.runningCount += 1;
          void runRenderTask(task, scheduler);
        }
      },
      [runRenderTask]
    );
    pumpRenderQueueRef.current = pumpRenderQueue;

    const queueRenderPage = useCallback(
      (pageIndex: number, priority: RenderTaskPriority) => {
        const scheduler = renderSchedulerRef.current;
        if (scheduler.cancelled) return;
        if (pageIndex < 0 || pageIndex >= pageCount) return;

        const cache = cacheRef.current.get(pageIndex) ?? {
          url: null,
          height: null,
          loading: false,
          error: null,
        };

        if (cache.url) {
          cacheRef.current.set(pageIndex, cache);
          return;
        }

        scheduler.desiredPriorities.set(pageIndex, priority);

        const existing = scheduler.queue.get(pageIndex);
        if (existing) {
          existing.priority = Math.min(existing.priority, priority) as RenderTaskPriority;
          return;
        }

        if (scheduler.runningPages.has(pageIndex)) {
          return;
        }

        cache.loading = true;
        cache.error = null;
        cacheRef.current.set(pageIndex, cache);
        requestRerender();

        scheduler.sequence += 1;
        scheduler.queue.set(pageIndex, {
          pageIndex,
          priority,
          sequence: scheduler.sequence,
        });
      },
      [pageCount, requestRerender]
    );

    const syncRenderQueue = useCallback(
      (desired: Map<number, RenderTaskPriority>) => {
        const scheduler = renderSchedulerRef.current;
        if (scheduler.cancelled) return;

        scheduler.desiredPriorities = desired;

        let changed = false;
        for (const [pageIndex] of Array.from(scheduler.queue.entries())) {
          if (desired.has(pageIndex)) continue;
          scheduler.queue.delete(pageIndex);
          resetPendingPage(pageIndex);
          changed = true;
        }

        for (const [pageIndex, priority] of desired) {
          queueRenderPage(pageIndex, priority);
        }

        if (changed) requestRerender();
        pumpRenderQueue(scheduler);
      },
      [pumpRenderQueue, queueRenderPage, requestRerender, resetPendingPage]
    );

    const ensureRenderPage = useCallback(
      (pageIndex: number, priority: RenderTaskPriority) => {
        queueRenderPage(pageIndex, priority);
        pumpRenderQueue();
      },
      [pumpRenderQueue, queueRenderPage]
    );

    const processNearPages = useCallback(() => {
      if (pageCount <= 0) return;

      const near = nearPagesRef.current;
      if (near.size === 0) return;

      const wanted = new Set<number>();
      const priority = new Set<number>();
      const desired = new Map<number, RenderTaskPriority>();

      if (!firstPageSettledRef.current) {
        desired.set(scrollAnchorRef.current, 0);
        syncRenderQueue(desired);
        return;
      }

      desired.set(scrollAnchorRef.current, 0);

      for (const idx of visiblePagesRef.current) {
        for (let d = -2; d <= 2; d++) {
          const p = idx + d;
          if (p >= 0 && p < pageCount) priority.add(p);
        }
      }

      for (const idx of near) {
        for (let d = -2; d <= 2; d++) {
          const p = idx + d;
          if (p >= 0 && p < pageCount) wanted.add(p);
        }
      }

      for (const idx of priority) {
        const current = desired.get(idx);
        if (current == null || current > 1) desired.set(idx, 1);
      }

      for (const idx of wanted) {
        const current = desired.get(idx);
        if (current == null || current > 2) desired.set(idx, 2);
      }

      syncRenderQueue(desired);

      let changed = false;
      const map = cacheRef.current;
      const evictKeys = evictPdfPageCacheByDistance({
        cacheKeys: Array.from(map.entries())
          .filter(([, cache]) => !!cache.url)
          .map(([pageIndex]) => pageIndex),
        pinned: new Set([
          ...Array.from(nearPagesRef.current),
          ...Array.from(visiblePagesRef.current),
        ]),
        anchors: [scrollAnchorRef.current, ...Array.from(visiblePagesRef.current)],
        max: MAX_CACHED_PAGES,
      });

      for (const i of evictKeys) {
        const cache = map.get(i);
        if (!cache?.url) continue;
        cache.url = null;
        cache.loading = false;
        cache.error = null;
        map.set(i, cache);
        changed = true;
      }
      if (changed) requestRerender();
    }, [ensureRenderPage, pageCount, requestRerender, resetPendingPage, syncRenderQueue]);

    const nearProcessScheduledRef = useRef(false);
    const scheduleProcessNear = useCallback(() => {
      if (nearProcessScheduledRef.current) return;
      nearProcessScheduledRef.current = true;
      requestAnimationFrame(() => {
        nearProcessScheduledRef.current = false;
        processNearPages();
      });
    }, [processNearPages]);
    scheduleProcessNearRef.current = scheduleProcessNear;

    const estimatedHeight = Math.max(Math.round(renderWidth * 1.4), 320);
    const estimatedStep = Math.max(1, estimatedHeight + PAGE_GAP_PX);

    const scrollToPage = useCallback(
      (pageIndex: number, behavior: ScrollBehavior) => {
        const container = containerRef.current;
        if (!container || pageCount <= 0) return;

        const idx = clampInt(pageIndex, 0, pageCount - 1);
        if (scrollAnchorRef.current !== idx) {
          scrollAnchorRef.current = idx;
          setScrollAnchor(idx);
        }
        const near = nearPagesRef.current;
        if (!near.has(idx)) {
          near.add(idx);
          requestRerender();
          scheduleProcessNear();
        }
        const el =
          pageElsRef.current.get(idx) ??
          (container.querySelector(
            `[data-page-index="${idx}"]`
          ) as HTMLDivElement | null);

        if (el) {
          el.scrollIntoView({ behavior, block: "start" });
          return;
        }

        container.scrollTo({ top: idx * estimatedStep, behavior });

        requestAnimationFrame(() => {
          const nextEl =
            pageElsRef.current.get(idx) ??
            (container.querySelector(
              `[data-page-index="${idx}"]`
            ) as HTMLDivElement | null);
          nextEl?.scrollIntoView({ behavior, block: "start" });
        });
      },
      [estimatedStep, pageCount, requestRerender, scheduleProcessNear]
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
      renderSchedulerRef.current.cancelled = true;
      renderSchedulerRef.current = createRenderScheduler(token);

      setLoading(true);
      setError(null);
      setPageCount(0);
      cacheRef.current.clear();
      nearPagesRef.current.clear();
      visiblePagesRef.current.clear();
      firstPageSettledRef.current = false;
      lastReportedRef.current = null;
      scrollAnchorRef.current = 0;
      setScrollAnchor(0);

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
          if (pc <= 0) {
            const emptyError = new Error("未读取到 PDF 页数");
            setError(emptyError.message);
            onErrorRef.current?.(emptyError);
            return;
          }
          setPageCount(pc);

          const bookmarks = Array.isArray(info.bookmarks) ? info.bookmarks : [];
          const toc = fromPdfBookmarks(bookmarks);
          onChaptersLoaded?.(toc);
          logInfo(SOURCE, "PDF 加载成功", { pageCount: pc });
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
        renderSchedulerRef.current.cancelled = true;
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

          if (changed) {
            requestRerender();
            scheduleProcessNear();
          }
        },
        {
          root: container,
          rootMargin: `${LOAD_ROOT_MARGIN_PX}px 0px ${LOAD_ROOT_MARGIN_PX}px 0px`,
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
    }, [error, loading, pageCount, requestRerender, scheduleProcessNear]);

    // 滚动进度追踪（节流 100ms）
    useEffect(() => {
      const container = containerRef.current;
      if (!container || loading || error || pageCount <= 0) return;

      const flushProgress = () => {
        const visible = visiblePagesRef.current;
        const estimatedIdx = clampInt(
          Math.floor(container.scrollTop / estimatedStep),
          0,
          pageCount - 1
        );
        const idx =
          visible.size > 0
            ? Math.min(...Array.from(visible))
            : estimatedIdx;

        const pageIndex = clampInt(idx, 0, pageCount - 1);
        if (scrollAnchorRef.current !== pageIndex) {
          scrollAnchorRef.current = pageIndex;
          setScrollAnchor(pageIndex);
        }
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

      const onScroll = () => {
        const nextAnchor = clampInt(
          Math.floor(container.scrollTop / estimatedStep),
          0,
          pageCount - 1
        );
        if (scrollAnchorRef.current !== nextAnchor) {
          scrollAnchorRef.current = nextAnchor;
          setScrollAnchor(nextAnchor);
        }
        requestFlush();
      };
      container.addEventListener("scroll", onScroll, { passive: true });

      return () => {
        container.removeEventListener("scroll", onScroll);
        if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
        progressPendingRef.current = false;
        flushProgress();
      };
    }, [error, estimatedStep, loading, pageCount]);

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

    const baseWindow = calcRenderWindow({
      nearPages: nearPagesRef.current,
      pageCount,
      buffer: WINDOW_BUFFER_PAGES,
      estimatedHeight,
      gap: PAGE_GAP_PX,
    });

    let windowResult = baseWindow;
    if (pageCount > 0) {
      const anchor = clampInt(scrollAnchor, 0, pageCount - 1);
      if (
        nearPagesRef.current.size === 0 ||
        anchor < baseWindow.start ||
        anchor > baseWindow.end
      ) {
        const merged = new Set<number>(nearPagesRef.current);
        merged.add(anchor);
        windowResult = calcRenderWindow({
          nearPages: merged,
          pageCount,
          buffer: WINDOW_BUFFER_PAGES,
          estimatedHeight,
          gap: PAGE_GAP_PX,
        });
      }
    }

    const { start, end, topPadding, bottomPadding } = windowResult;

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
          {pageCount > 0 && (
            <>
              {topPadding > 0 && (
                <div style={{ height: topPadding }} aria-hidden="true" />
              )}
              {end >= start &&
                Array.from({ length: end - start + 1 }, (_, offset) => {
                  const i = start + offset;
                  const cache = cacheRef.current.get(i);
                  return (
                    <PdfPageItem
                      key={i}
                      pageIndex={i}
                      url={cache?.url ?? null}
                      height={cache?.height ?? null}
                      loading={cache?.loading ?? false}
                      error={cache?.error ?? null}
                      estimatedHeight={estimatedHeight}
                      registerEl={registerEl}
                      onImageLoaded={onImageLoaded}
                      onImageError={onImageError}
                    />
                  );
                })}
              {bottomPadding > 0 && (
                <div style={{ height: bottomPadding }} aria-hidden="true" />
              )}
            </>
          )}
        </div>

        <div className="h-[40vh]" aria-hidden="true" />
      </div>
    );
  }
);

