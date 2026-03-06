import { useCallback, useEffect, useRef, useState } from "react";
import {
  getReaderAdapterComponent,
  type ReaderAdapterHandle,
} from "./ReaderAdapter";
import { ControlOverlay } from "./ControlOverlay";
import { ChapterNav } from "./ChapterNav";
import { SettingsPanel } from "./SettingsPanel";
import { useLibraryStore, type Book } from "@/stores/library";
import { useReaderStore } from "@/stores/reader";
import {
  createDocumentSession,
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
  const session = createDocumentSession({
    id: book.id,
    format: book.format,
    filePath: book.path,
    progress: {
      position: book.progress.position,
      percent: book.progress.percent,
    },
    doc: currentBookDoc,
  });
  const ReaderAdapter = getReaderAdapterComponent(session.format);

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

  const readerRef = useRef<ReaderAdapterHandle>(null);

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
      await readerRef.current?.navigateTo(href);
    },
    []
  );

  return (
    <div className="relative h-full overflow-hidden">
      {/* 阅读区域（全屏） */}
      <ReaderAdapter
        ref={readerRef}
        filePath={session.filePath}
        lastPosition={session.progress.position}
        onRelocate={handleRelocate}
        onTocLoaded={handleTocLoaded}
        onError={(err) => logError(SOURCE, "阅读器错误", err)}
      />

      {/* 浮动控制层 */}
      <ControlOverlay
        title={session.doc.metadata.title}
        percent={percent}
        hasChapters={session.doc.toc.length > 0}
        onBack={handleBack}
        onOpenChapters={() => setChapterNavOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* 章节导航 */}
      <ChapterNav
        toc={session.doc.toc}
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
