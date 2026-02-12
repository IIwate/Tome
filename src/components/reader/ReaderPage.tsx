import { useCallback, useRef, useState } from "react";
import { ReaderView, type ReaderViewHandle } from "./ReaderView";
import { TxtReaderView, type TxtReaderViewHandle } from "./TxtReaderView";
import { ControlOverlay } from "./ControlOverlay";
import { ChapterNav } from "./ChapterNav";
import { SettingsPanel } from "./SettingsPanel";
import { useLibraryStore, type Book } from "@/stores/library";
import { useReaderStore } from "@/stores/reader";
import type { FoliateLocation, FoliateTocItem } from "@/lib/foliate";
import type { TxtChapter } from "@/lib/txt-parser";

interface ReaderPageProps {
  book: Book;
  onBack: () => void;
}

export function ReaderPage({ book, onBack }: ReaderPageProps) {
  const updateBook = useLibraryStore((s) => s.updateBook);
  const updateProgress = useReaderStore((s) => s.updateProgress);
  const setChapters = useReaderStore((s) => s.setChapters);
  const chapters = useReaderStore((s) => s.chapters);
  const percent = useReaderStore((s) => s.percent);

  const [chapterNavOpen, setChapterNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const readerRef = useRef<ReaderViewHandle>(null);
  const txtReaderRef = useRef<TxtReaderViewHandle>(null);

  const handleRelocate = useCallback(
    (location: FoliateLocation) => {
      const pos = location.cfi ?? null;
      const pct = Math.round((location.fraction ?? 0) * 100);
      updateBook(book.id, {
        progress: { position: pos, percent: pct },
      });
      updateProgress(pos, pct);
    },
    [book.id, updateBook, updateProgress]
  );

  const handleTxtRelocate = useCallback(
    (charOffset: number, pct: number) => {
      const pos = charOffset.toString();
      updateBook(book.id, {
        progress: { position: pos, percent: pct },
      });
      updateProgress(pos, pct);
    },
    [book.id, updateBook, updateProgress]
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
      if (book.format === "txt") {
        const offset = parseInt(href, 10);
        if (!isNaN(offset)) txtReaderRef.current?.scrollToOffset(offset);
      } else {
        await readerRef.current?.goTo(href);
      }
    },
    [book.format]
  );

  return (
    <div className="relative h-full">
      {/* 阅读区域（全屏） */}
      {book.format === "epub" ? (
        <ReaderView
          ref={readerRef}
          filePath={book.path}
          lastPosition={book.progress.position}
          onRelocate={handleRelocate}
          onTocLoaded={handleTocLoaded}
          onError={(err) => console.error("阅读器错误:", err.message)}
        />
      ) : (
        <TxtReaderView
          ref={txtReaderRef}
          filePath={book.path}
          lastPosition={book.progress.position}
          onRelocate={handleTxtRelocate}
          onChaptersLoaded={handleTxtChaptersLoaded}
          onError={(err) => console.error("阅读器错误:", err.message)}
        />
      )}

      {/* 浮动控制层 */}
      <ControlOverlay
        title={book.title}
        percent={percent}
        hasChapters={chapters.length > 0}
        onBack={onBack}
        onOpenChapters={() => setChapterNavOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

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
  );
}
