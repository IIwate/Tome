import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MainLayout } from "@/components/layout/MainLayout";
import { LibraryPage } from "@/components/library/LibraryPage";
import { ReaderPage } from "@/components/reader/ReaderPage";
import { useSettingsStore } from "@/stores/settings";
import { useLibraryStore, type Book } from "@/stores/library";
import { useReaderStore } from "@/stores/reader";

type AppView = "library" | "reader";

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const pageTransition = { duration: 0.2, ease: "easeInOut" };

function App() {
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const updateBook = useLibraryStore((s) => s.updateBook);
  const openBookInReader = useReaderStore((s) => s.openBook);
  const closeBookInReader = useReaderStore((s) => s.closeBook);

  const [currentView, setCurrentView] = useState<AppView>("library");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  useEffect(() => {
    hydrateSettings();
    hydrateLibrary();
  }, [hydrateSettings, hydrateLibrary]);

  const handleOpenBook = useCallback(
    (book: Book) => {
      setSelectedBookId(book.id);
      setCurrentView("reader");
      updateBook(book.id, { lastOpenedAt: Date.now() });
      openBookInReader(book.id, book.progress.position, book.progress.percent);
    },
    [updateBook, openBookInReader]
  );

  const handleBack = useCallback(() => {
    setCurrentView("library");
    setSelectedBookId(null);
    closeBookInReader();
  }, [closeBookInReader]);

  return (
    <MainLayout>
      <AnimatePresence mode="wait">
        {currentView === "library" ? (
          <motion.div
            key="library"
            className="h-full"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
          >
            <LibraryPage onOpenBook={handleOpenBook} />
          </motion.div>
        ) : selectedBookId ? (
          <motion.div
            key="reader"
            className="h-full"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
          >
            <ReaderPage bookId={selectedBookId} onBack={handleBack} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MainLayout>
  );
}

export default App;
