import { create } from "zustand";
import type { BookDocTocItem } from "@/lib/book-doc";

interface ReaderState {
  /** 当前阅读的书籍 ID */
  currentBookId: string | null;
  /** 阅读位置标识（EPUB: CFI, TXT: charOffset 字符串） */
  position: string | null;
  /** 阅读进度百分比 0-100 */
  percent: number;
  /** 章节目录（统一格式） */
  chapters: BookDocTocItem[];
}

interface ReaderActions {
  openBook: (bookId: string, position: string | null, percent: number) => void;
  updateProgress: (position: string | null, percent: number) => void;
  setChapters: (chapters: BookDocTocItem[]) => void;
  closeBook: () => void;
}

export const useReaderStore = create<ReaderState & ReaderActions>()((set) => ({
  currentBookId: null,
  position: null,
  percent: 0,
  chapters: [],

  openBook: (bookId, position, percent) =>
    set({ currentBookId: bookId, position, percent, chapters: [] }),

  updateProgress: (position, percent) =>
    set((s) => (s.currentBookId ? { position, percent } : s)),

  setChapters: (chapters) => set({ chapters }),

  closeBook: () =>
    set({ currentBookId: null, position: null, percent: 0, chapters: [] }),
}));
