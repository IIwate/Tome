import { useCallback, useEffect, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { LibraryPage } from "@/components/library/LibraryPage";
import { ReaderView, type ReaderViewHandle } from "@/components/reader/ReaderView";
import { TxtReaderView, type TxtReaderViewHandle } from "@/components/reader/TxtReaderView";
import { ChapterNav } from "@/components/reader/ChapterNav";
import { ReadingProgressBar } from "@/components/reader/ReadingProgressBar";
import { SettingsPanel } from "@/components/reader/SettingsPanel";
import { useSettingsStore } from "@/stores/settings";
import { useLibraryStore, type Book } from "@/stores/library";
import { useReaderStore } from "@/stores/reader";
import { ArrowLeft, List, Settings } from "lucide-react";
import type { FoliateLocation, FoliateTocItem } from "@/lib/foliate";
import type { TxtChapter } from "@/lib/txt-parser";

type AppView = "library" | "reader";

function App() {
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const updateBook = useLibraryStore((s) => s.updateBook);

  const openBookInReader = useReaderStore((s) => s.openBook);
  const updateProgress = useReaderStore((s) => s.updateProgress);
  const setChapters = useReaderStore((s) => s.setChapters);
  const closeBookInReader = useReaderStore((s) => s.closeBook);
  const chapters = useReaderStore((s) => s.chapters);
  const percent = useReaderStore((s) => s.percent);

  const [currentView, setCurrentView] = useState<AppView>("library");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [chapterNavOpen, setChapterNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const readerRef = useRef<ReaderViewHandle>(null);
  const txtReaderRef = useRef<TxtReaderViewHandle>(null);

  useEffect(() => {
    hydrateSettings();
    hydrateLibrary();
  }, [hydrateSettings, hydrateLibrary]);

  const handleOpenBook = useCallback((book: Book) => {
    setSelectedBook(book);
    setCurrentView("reader");
    updateBook(book.id, { lastOpenedAt: Date.now() });
    openBookInReader(book.id, book.progress.position, book.progress.percent);
  }, [updateBook, openBookInReader]);

  const handleBack = useCallback(() => {
    setCurrentView("library");
    setSelectedBook(null);
    setChapterNavOpen(false);
    setSettingsOpen(false);
    closeBookInReader();
  }, [closeBookInReader]);

  const handleRelocate = useCallback(
    (location: FoliateLocation) => {
      if (!selectedBook) return;
      const pos = location.cfi ?? null;
      const pct = Math.round((location.fraction ?? 0) * 100);
      updateBook(selectedBook.id, {
        progress: { position: pos, percent: pct },
      });
      updateProgress(pos, pct);
    },
    [selectedBook, updateBook, updateProgress]
  );

  const handleTxtRelocate = useCallback(
    (charOffset: number, pct: number) => {
      if (!selectedBook) return;
      const pos = charOffset.toString();
      updateBook(selectedBook.id, {
        progress: { position: pos, percent: pct },
      });
      updateProgress(pos, pct);
    },
    [selectedBook, updateBook, updateProgress]
  );

  const handleTocLoaded = useCallback(
    (items: FoliateTocItem[]) => {
      setChapters(items);
    },
    [setChapters]
  );

  const handleTxtChaptersLoaded = useCallback(
    (txtChapters: TxtChapter[]) => {
      setChapters(
        txtChapters.map((ch) => ({
          label: ch.title,
          href: ch.startOffset.toString(),
        }))
      );
    },
    [setChapters]
  );

  const handleChapterNavigate = useCallback(
    async (href: string) => {
      setChapterNavOpen(false);
      if (selectedBook?.format === "txt") {
        const offset = parseInt(href, 10);
        if (!isNaN(offset)) txtReaderRef.current?.scrollToOffset(offset);
      } else {
        await readerRef.current?.goTo(href);
      }
    },
    [selectedBook?.format]
  );

  return (
    <MainLayout>
      {currentView === "library" ? (
        <LibraryPage onOpenBook={handleOpenBook} />
      ) : selectedBook ? (
        <div className="flex h-full flex-col">
          {/* 阅读器工具栏 */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2">
            <button
              onClick={handleBack}
              className="rounded-lg p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h2 className="flex-1 truncate text-sm font-medium text-foreground">
              {selectedBook.title}
            </h2>
            {chapters.length > 0 && (
              <button
                onClick={() => setChapterNavOpen(true)}
                className="rounded-lg p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
              >
                <List className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="排版设置"
              className="rounded-lg p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          {/* 阅读区域 */}
          <div className="flex-1 overflow-hidden">
            {selectedBook.format === "epub" ? (
              <ReaderView
                ref={readerRef}
                filePath={selectedBook.path}
                lastPosition={selectedBook.progress.position}
                onRelocate={handleRelocate}
                onTocLoaded={handleTocLoaded}
                onError={(err) =>
                  console.error("阅读器错误:", err.message)
                }
              />
            ) : (
              <TxtReaderView
                ref={txtReaderRef}
                filePath={selectedBook.path}
                lastPosition={selectedBook.progress.position}
                onRelocate={handleTxtRelocate}
                onChaptersLoaded={handleTxtChaptersLoaded}
                onError={(err) =>
                  console.error("阅读器错误:", err.message)
                }
              />
            )}
          </div>

          {/* 底部进度条 */}
          <ReadingProgressBar percent={percent} />

          {/* 章节导航 */}
          <ChapterNav
            toc={chapters}
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
      ) : null}
    </MainLayout>
  );
}

export default App;
