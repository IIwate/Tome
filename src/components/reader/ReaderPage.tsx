import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getReaderAdapterComponent,
  type ReaderAdapterHandle,
} from "./ReaderAdapter";
import { ControlOverlay } from "./ControlOverlay";
import { ChapterNav } from "./ChapterNav";
import { SettingsPanel } from "./SettingsPanel";
import { ReaderErrorBoundary, ReaderErrorPanel } from "./ReaderErrorBoundary";
import { useLibraryStore } from "@/stores/library";
import { useReaderStore } from "@/stores/reader";
import {
  createDocumentSession,
  createBookDocShell,
  type BookDocTocItem,
  type BookReadingProgress,
} from "@/lib/book-doc";
import {
  hasBookConfigOverride,
  mergeBookConfigOverride,
  resolveBookConfig,
} from "@/lib/book-config";
import { useViewSettings } from "@/stores/settings";
import type { ViewSettings } from "@/lib/book-config";
import { logError } from "@/lib/logger";

interface ReaderPageProps {
  bookId: string;
  onBack: () => void;
}

const SOURCE = "reader/ReaderPage";

export function ReaderPage({ bookId, onBack }: ReaderPageProps) {
  const book = useLibraryStore(
    (state) => state.books.find((item) => item.id === bookId) ?? null
  );
  const updateBook = useLibraryStore((s) => s.updateBook);
  const updateProgress = useReaderStore((s) => s.updateProgress);
  const setChapters = useReaderStore((s) => s.setChapters);
  const chapters = useReaderStore((s) => s.chapters);
  const percent = useReaderStore((s) => s.percent);
  const viewSettings = useViewSettings();

  const effectiveBookConfig = useMemo(
    () => resolveBookConfig(viewSettings, book?.bookConfig),
    [book?.bookConfig, viewSettings]
  );

  const session = useMemo(() => {
    if (!book) return null;

    const doc = createBookDocShell({
      format: book.format,
      title: book.title,
      author: book.author,
      toc: chapters,
    });

    return createDocumentSession({
      id: book.id,
      format: book.format,
      filePath: book.path,
      progress: {
        position: book.progress.position,
        percent: book.progress.percent,
      },
      doc: {
        ...doc,
        toc: chapters,
      },
    });
  }, [book, chapters]);

  const lastBookProgressRef = useRef({
    position: book?.progress.position ?? null,
    percent: book?.progress.percent ?? 0,
  });
  const bookProgressDirtyRef = useRef(false);
  const [chapterNavOpen, setChapterNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);
  const readerRef = useRef<ReaderAdapterHandle>(null);

  useEffect(() => {
    lastBookProgressRef.current = {
      position: book?.progress.position ?? null,
      percent: book?.progress.percent ?? 0,
    };
    bookProgressDirtyRef.current = false;
    setReaderError(null);
  }, [book?.id]);

  const flushBookProgress = useCallback(() => {
    if (!book || !bookProgressDirtyRef.current) return;
    const progress = lastBookProgressRef.current;
    updateBook(book.id, {
      progress: { position: progress.position, percent: progress.percent },
    });
    bookProgressDirtyRef.current = false;
  }, [book, updateBook]);

  useEffect(() => {
    return () => {
      flushBookProgress();
    };
  }, [flushBookProgress]);

  const handleBack = useCallback(() => {
    flushBookProgress();
    onBack();
  }, [flushBookProgress, onBack]);

  const handleRelocate = useCallback(
    (position: string | null, nextPercent: number) => {
      if (!book) return;

      const next: BookReadingProgress = { position, percent: nextPercent };
      lastBookProgressRef.current = next;
      if (
        !bookProgressDirtyRef.current &&
        (next.position !== book.progress.position || next.percent !== book.progress.percent)
      ) {
        bookProgressDirtyRef.current = true;
      }
      updateProgress(next.position, next.percent);
    },
    [book, updateProgress]
  );

  const handleTocLoaded = useCallback(
    (items: BookDocTocItem[]) => {
      setChapters(items);
    },
    [setChapters]
  );

  const handleChangeViewSettings = useCallback(
    (patch: Partial<ViewSettings>) => {
      if (!book) return;
      updateBook(book.id, {
        bookConfig: mergeBookConfigOverride(book.bookConfig, patch),
      });
    },
    [book, updateBook]
  );

  const handleResetViewSettings = useCallback(() => {
    if (!book) return;
    updateBook(book.id, { bookConfig: undefined });
  }, [book, updateBook]);

  const handleChapterNavigate = useCallback(
    async (href: string) => {
      setChapterNavOpen(false);
      await readerRef.current?.navigateTo(href);
    },
    []
  );

  const handleReaderError = useCallback((err: Error) => {
    setReaderError(err.message);
    logError(SOURCE, "阅读器错误", err);
  }, []);

  if (!book || !session) {
    return (
      <ReaderErrorPanel
        title="书籍不存在"
        message="这本书可能已被移除，请返回书架重新选择。"
        onBack={onBack}
      />
    );
  }

  const ReaderAdapter = getReaderAdapterComponent(book.format);
  const hasOverrides = hasBookConfigOverride(book.bookConfig);

  return (
    <div className="relative h-full overflow-hidden">
      {readerError ? (
        <ReaderErrorPanel message={readerError} onBack={handleBack} />
      ) : (
        <ReaderErrorBoundary
          onBack={handleBack}
          resetKeys={[book.id, book.path, book.format]}
        >
          <>
            <ReaderAdapter
              ref={readerRef}
              filePath={session.filePath}
              lastPosition={session.progress.position}
              config={effectiveBookConfig}
              onRelocate={handleRelocate}
              onTocLoaded={handleTocLoaded}
              onError={handleReaderError}
            />

            <ControlOverlay
              title={session.doc.metadata.title}
              percent={percent}
              hasChapters={session.doc.toc.length > 0}
              onBack={handleBack}
              onOpenChapters={() => setChapterNavOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
            />

            <ChapterNav
              toc={session.doc.toc}
              open={chapterNavOpen}
              onClose={() => setChapterNavOpen(false)}
              onNavigate={handleChapterNavigate}
            />

            <SettingsPanel
              open={settingsOpen}
              config={effectiveBookConfig}
              hasOverrides={hasOverrides}
              onChangeViewSettings={handleChangeViewSettings}
              onResetViewSettings={handleResetViewSettings}
              onClose={() => setSettingsOpen(false)}
            />
          </>
        </ReaderErrorBoundary>
      )}
    </div>
  );
}
