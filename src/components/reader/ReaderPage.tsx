import { useCallback, useEffect, useRef, useState } from "react";
import { EpubScrollView, type EpubScrollViewHandle } from "./EpubScrollView";
import { TxtReaderView, type TxtReaderViewHandle } from "./TxtReaderView";
import { PdfReaderView, type PdfReaderViewHandle } from "./PdfReaderView";
import { ControlOverlay } from "./ControlOverlay";
import { ChapterNav } from "./ChapterNav";
import { SettingsPanel } from "./SettingsPanel";
import { useLibraryStore, type Book } from "@/stores/library";
import { useReaderStore } from "@/stores/reader";
import {
  createBookDocShell,
  type BookDocTocItem,
  type BookDoc,
  type BookReadingProgress,
} from "@/lib/book-doc";
import { logError } from "@/lib/logger";

interface ReaderPageProps {
  book: Book;
  onBack: () => void;
}

const SOURCE = "reader/ReaderPage";

export function ReaderPage({ book, onBack }: ReaderPageProps) {
  const updateBook = useLibraryStore((s) => s.updateBook);
  const updateProgress = useReaderStore((s) => s.updateProgress);
  const setChapters = useReaderStore((s) => s.setChapters);
  const chapters = useReaderStore((s) => s.chapters);
  const percent = useReaderStore((s) => s.percent);
  const currentBookDoc: BookDoc = createBookDocShell({
    format: book.format,
    title: book.title,
    author: book.author,
    toc: chapters,
  });

  const lastBookProgressRef = useRef({
    position: book.progress.position,
    percent: book.progress.percent,
  });
  const bookProgressDirtyRef = useRef(false);

  const flushBookProgress = useCallback(() => {
    if (!bookProgressDirtyRef.current) return;
    const p = lastBookProgressRef.current;
    updateBook(book.id, {
      progress: { position: p.position, percent: p.percent },
    });
    bookProgressDirtyRef.current = false;
  }, [book.id, updateBook]);

  useEffect(() => {
    return () => {
      flushBookProgress();
    };
  }, [flushBookProgress]);

  const handleBack = useCallback(() => {
    flushBookProgress();
    onBack();
  }, [flushBookProgress, onBack]);

  const [chapterNavOpen, setChapterNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const readerRef = useRef<EpubScrollViewHandle>(null);
  const txtReaderRef = useRef<TxtReaderViewHandle>(null);
  const pdfReaderRef = useRef<PdfReaderViewHandle>(null);

  const handleRelocate = useCallback(
    (position: string | null, percent: number) => {
      const next: BookReadingProgress = { position, percent };
      const pos = next.position;
      const pct = next.percent;
      lastBookProgressRef.current = { position: pos, percent: pct };
      if (
        !bookProgressDirtyRef.current &&
        (pos !== book.progress.position || pct !== book.progress.percent)
      ) {
        bookProgressDirtyRef.current = true;
      }
      updateProgress(pos, pct);
    },
    [book.progress.percent, book.progress.position, updateProgress]
  );

  const handleTocLoaded = useCallback(
    (items: BookDocTocItem[]) => {
      setChapters(items);
    },
    [setChapters]
  );

  const handleChapterNavigate = useCallback(
    async (href: string) => {
      setChapterNavOpen(false);
      if (book.format === "txt") {
        const offset = parseInt(href, 10);
        if (!isNaN(offset)) txtReaderRef.current?.scrollToOffset(offset);
      } else if (book.format === "pdf") {
        const pageIndex = parseInt(href, 10);
        if (!isNaN(pageIndex)) pdfReaderRef.current?.goToPage(pageIndex);
      } else {
        await readerRef.current?.goTo(href);
      }
    },
    [book.format]
  );

  return (
    <div className="relative h-full overflow-hidden">
      {/* 阅读区域（全屏） */}
      {book.format === "epub" ? (
        <EpubScrollView
          ref={readerRef}
          filePath={book.path}
          lastPosition={book.progress.position}
          onRelocate={handleRelocate}
          onTocLoaded={handleTocLoaded}
          onError={(err) => logError(SOURCE, "阅读器错误", err)}
        />
      ) : book.format === "pdf" ? (
        <PdfReaderView
          ref={pdfReaderRef}
          filePath={book.path}
          lastPosition={book.progress.position}
          onRelocate={handleRelocate}
          onChaptersLoaded={handleTocLoaded}
          onError={(err) => logError(SOURCE, "阅读器错误", err)}
        />
      ) : (
        <TxtReaderView
          ref={txtReaderRef}
          filePath={book.path}
          lastPosition={book.progress.position}
          onRelocate={handleRelocate}
          onChaptersLoaded={handleTocLoaded}
          onError={(err) => logError(SOURCE, "阅读器错误", err)}
        />
      )}

      {/* 浮动控制层 */}
      <ControlOverlay
        title={book.title}
        percent={percent}
        hasChapters={currentBookDoc.toc.length > 0}
        onBack={handleBack}
        onOpenChapters={() => setChapterNavOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* 章节导航 */}
      <ChapterNav
        toc={currentBookDoc.toc}
        open={chapterNavOpen}
        onClose={() => setChapterNavOpen(false)}
        onNavigate={handleChapterNavigate}
      />

      {/* 排版设置 */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
