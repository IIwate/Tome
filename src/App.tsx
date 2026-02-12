import { useCallback, useEffect, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { LibraryPage } from "@/components/library/LibraryPage";
import { ReaderView, type ReaderViewHandle } from "@/components/reader/ReaderView";
import { ChapterNav } from "@/components/reader/ChapterNav";
import { useSettingsStore } from "@/stores/settings";
import { useLibraryStore, type Book } from "@/stores/library";
import { ArrowLeft, List } from "lucide-react";
import type { FoliateLocation, FoliateTocItem } from "@/lib/foliate";

type AppView = "library" | "reader";

function App() {
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const updateBook = useLibraryStore((s) => s.updateBook);

  const [currentView, setCurrentView] = useState<AppView>("library");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [toc, setToc] = useState<FoliateTocItem[]>([]);
  const [chapterNavOpen, setChapterNavOpen] = useState(false);

  const readerRef = useRef<ReaderViewHandle>(null);

  useEffect(() => {
    hydrateSettings();
    hydrateLibrary();
  }, [hydrateSettings, hydrateLibrary]);

  const handleOpenBook = useCallback((book: Book) => {
    if (book.format !== "epub") {
      // TXT 阅读器在后续阶段实现
      console.log("TXT 阅读器尚未实现:", book.title);
      return;
    }
    setSelectedBook(book);
    setCurrentView("reader");
    updateBook(book.id, { lastOpenedAt: Date.now() });
  }, [updateBook]);

  const handleBack = useCallback(() => {
    setCurrentView("library");
    setSelectedBook(null);
    setToc([]);
    setChapterNavOpen(false);
  }, []);

  const handleRelocate = useCallback(
    (location: FoliateLocation) => {
      if (!selectedBook) return;
      updateBook(selectedBook.id, {
        progress: {
          position: location.cfi ?? null,
          percent: Math.round((location.fraction ?? 0) * 100),
        },
      });
    },
    [selectedBook, updateBook]
  );

  const handleTocLoaded = useCallback((items: FoliateTocItem[]) => {
    setToc(items);
  }, []);

  const handleChapterNavigate = useCallback(
    async (href: string) => {
      setChapterNavOpen(false);
      await readerRef.current?.goTo(href);
    },
    []
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
            {toc.length > 0 && (
              <button
                onClick={() => setChapterNavOpen(true)}
                className="rounded-lg p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
              >
                <List className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* EPUB 阅读区域 */}
          <div className="flex-1 overflow-hidden">
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
          </div>

          {/* 章节导航 */}
          <ChapterNav
            toc={toc}
            open={chapterNavOpen}
            onClose={() => setChapterNavOpen(false)}
            onNavigate={handleChapterNavigate}
          />
        </div>
      ) : null}
    </MainLayout>
  );
}

export default App;
