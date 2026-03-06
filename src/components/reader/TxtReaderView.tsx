import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { parseTxtFile, type TxtContent } from "@/lib/txt-parser";
import { fromTxtChapters, type BookDocTocItem } from "@/lib/book-doc";
import { useSettingsStore } from "@/stores/settings";
import { logError, logInfo } from "@/lib/logger";

interface TxtReaderViewProps {
  filePath: string;
  lastPosition?: string | null;
  onRelocate?: (position: string | null, percent: number) => void;
  onChaptersLoaded?: (chapters: BookDocTocItem[]) => void;
  onError?: (error: Error) => void;
}

export interface TxtReaderViewHandle {
  scrollToOffset: (offset: number) => void;
}

interface TextSegment {
  offset: number;
  title: string;
  text: string;
}

const SOURCE = "reader/TxtReaderView";

function buildSegments(content: TxtContent): TextSegment[] {
  const { text, chapters } = content;
  if (chapters.length === 0) {
    return [{ offset: 0, title: "", text }];
  }

  const segments: TextSegment[] = [];
  const firstChapter = chapters[0]!;

  // 首章节前的文本（序言等）
  if (firstChapter.startOffset > 0) {
    segments.push({
      offset: 0,
      title: "",
      text: text.slice(0, firstChapter.startOffset).trimEnd(),
    });
  }

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]!;
    const start = ch.startOffset;
    const end = chapters[i + 1]?.startOffset ?? text.length;
    const raw = text.slice(start, end);

    let body = raw;
    // 章节标题在文本中存在时，跳过标题行避免重复
    if (raw.startsWith(ch.title)) {
      const titleEnd = raw.indexOf("\n", ch.title.length);
      // 标题后有换行才截取，否则保留全文（标题与正文同行的情况）
      if (titleEnd >= 0) {
        body = raw.slice(titleEnd + 1);
      }
    }

    segments.push({
      offset: start,
      title: ch.title,
      text: body.trimStart(),
    });
  }

  return segments;
}

export const TxtReaderView = forwardRef<TxtReaderViewHandle, TxtReaderViewProps>(
  function TxtReaderView(
    { filePath, lastPosition, onRelocate, onChaptersLoaded, onError },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState<TxtContent | null>(null);
    const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const progressPendingRef = useRef(false);

    const fontFamily = useSettingsStore((s) => s.fontFamily);
    const fontSize = useSettingsStore((s) => s.fontSize);
    const lineHeight = useSettingsStore((s) => s.lineHeight);
    const margin = useSettingsStore((s) => s.margin);

    useImperativeHandle(
      ref,
      () => ({
        scrollToOffset: (offset: number) => {
          const container = containerRef.current;
          if (!container) return;
          const marker = container.querySelector(`[data-offset="${offset}"]`);
          if (marker) {
            marker.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        },
      }),
      []
    );

    // 加载 TXT 文件
    useEffect(() => {
      let cancelled = false;

      (async () => {
        try {
          setLoading(true);
          const result = await parseTxtFile(filePath);
          if (cancelled) return;
          setContent(result);
          onChaptersLoaded?.(fromTxtChapters(result.chapters));
          logInfo(SOURCE, "TXT 加载成功", {
            encoding: result.encoding,
            chapterCount: result.chapters.length,
          });
        } catch (err) {
          if (!cancelled) {
            logError(SOURCE, "TXT 加载失败", err);
            onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // 恢复上次阅读位置
    useEffect(() => {
      if (!content || !lastPosition) return;
      const offset = parseInt(lastPosition, 10);
      if (isNaN(offset)) return;

      requestAnimationFrame(() => {
        const container = containerRef.current;
        const contentEl = contentRef.current;
        if (!container || !contentEl) return;
        const fraction = content.text.length > 0 ? offset / content.text.length : 0;
        const contentBottom = contentEl.offsetTop + contentEl.offsetHeight;
        const effectiveMax = Math.max(contentBottom - container.clientHeight, 0);
        container.scrollTop = fraction * effectiveMax;
      });
    }, [content, lastPosition]);

    // 滚动进度追踪（节流 100ms，滚动中实时更新进度条）
    const onRelocateRef = useRef(onRelocate);
    onRelocateRef.current = onRelocate;

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !content) return;

      const flushProgress = () => {
        const contentEl = contentRef.current;
        if (!contentEl) return;
        const { scrollTop, clientHeight } = container;
        const contentBottom = contentEl.offsetTop + contentEl.offsetHeight;
        const effectiveMax = Math.max(contentBottom - clientHeight, 0);
        const scrollPos = Math.min(scrollTop, effectiveMax);
        const percent = effectiveMax > 0 ? Math.round((scrollPos / effectiveMax) * 100) : 0;
        const fraction = effectiveMax > 0 ? scrollPos / effectiveMax : 0;
        const charOffset = Math.round(fraction * content.text.length);
        onRelocateRef.current?.(charOffset.toString(), percent);
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

      const handleScroll = () => requestFlush();

      container.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        container.removeEventListener("scroll", handleScroll);
        // 卸载时立即保存最后一次进度，避免节流窗口内丢失
        if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
        progressPendingRef.current = false;
        flushProgress();
      };
    }, [content]);

    const segments = useMemo(
      () => (content ? buildSegments(content) : []),
      [content]
    );

    const textStyle = useMemo(
      () => ({
        fontFamily: `${fontFamily}, system-ui, sans-serif`,
        fontSize: `${fontSize}px`,
        lineHeight,
        paddingLeft: `${margin}px`,
        paddingRight: `${margin}px`,
      }),
      [fontFamily, fontSize, lineHeight, margin]
    );

    return (
      <div ref={containerRef} className="reader-scroll relative h-full overflow-y-auto bg-background">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-sm text-muted-foreground">加载中…</div>
          </div>
        )}
        {!loading && content && (
          <>
            <div ref={contentRef} className="mx-auto max-w-3xl py-8" style={textStyle}>
              {segments.map((seg, i) => (
                <div key={i} data-offset={seg.offset}>
                  {seg.title && (
                    <h2 className="mb-4 mt-8 text-lg font-bold text-foreground first:mt-0">
                      {seg.title}
                    </h2>
                  )}
                  <div className="whitespace-pre-wrap break-words text-foreground">
                    {seg.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="h-[40vh]" aria-hidden="true" />
          </>
        )}
      </div>
    );
  }
);
