import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { BookDocFormat } from "@/lib/book-doc";
import type { BookConfigOverride } from "@/lib/book-config";
import { loadImportedDocumentMeta } from "@/lib/document-loader";
import { loadPersistedSettings, persistSettings } from "@/lib/tauri-store";
import {
  normalizePath,
  filenameFromPath,
} from "@/lib/parse-utils";
import { logError, logInfo } from "@/lib/logger";

const SOURCE = "stores/library";

export interface Book {
  id: string;
  path: string;
  format: BookDocFormat;
  bookConfig?: BookConfigOverride;
  title: string;
  author: string;
  coverDataUrl: string;
  fileSize: number;
  addedAt: number;
  lastOpenedAt: number | null;
  progress: {
    position: string | null;
    percent: number;
  };
}

interface ScannedBook {
  path: string;
  filename: string;
  extension: string;
  size: number;
}

interface LibraryState {
  books: Book[];
  _hydrated: boolean;
  _importing: boolean;
}

interface LibraryActions {
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  removeBooks: (ids: string[]) => void;
  updateBook: (id: string, updates: Partial<Book>) => void;
  importFiles: () => Promise<void>;
  scanFolder: () => Promise<void>;
  hydrate: () => Promise<void>;
}

/** 导入单个文件到书架（元数据提取，不含去重） */
async function importSingleFile(
  filePath: string,
  fileSize?: number
): Promise<Book> {
  const size =
    fileSize ?? (await invoke<number>("stat_file", { path: filePath }));
  const imported = await loadImportedDocumentMeta(filePath);
  const title = imported.metadata.title || filenameFromPath(filePath);
  const author = imported.metadata.author ?? "";
  const coverDataUrl = imported.coverDataUrl;

  return {
    id: crypto.randomUUID(),
    path: filePath,
    format: imported.format,
    title,
    author,
    coverDataUrl,
    fileSize: size,
    addedAt: Date.now(),
    lastOpenedAt: null,
    progress: { position: null, percent: 0 },
  };
}

export const useLibraryStore = create<LibraryState & LibraryActions>()(
  subscribeWithSelector((set, get) => ({
    books: [],
    _hydrated: false,
    _importing: false,

    addBook: (book) => set((s) => ({ books: [...s.books, book] })),

    removeBook: (id) =>
      set((s) => ({ books: s.books.filter((b) => b.id !== id) })),

    removeBooks: (ids) =>
      set((s) => {
        if (ids.length === 0) return {};
        const idSet = new Set(ids);
        return { books: s.books.filter((b) => !idSet.has(b.id)) };
      }),

    updateBook: (id, updates) =>
      set((s) => ({
        books: s.books.map((b) => (b.id === id ? { ...b, ...updates } : b)),
      })),

    importFiles: async () => {
      if (get()._importing) return;
      set({ _importing: true });

      try {
        const selected = await open({
          multiple: true,
          filters: [{ name: "书籍", extensions: ["txt", "epub", "pdf"] }],
        });
        if (!selected) return;

        const paths = Array.isArray(selected) ? selected : [selected];
        const existingPaths = new Set(get().books.map((b) => normalizePath(b.path)));
        const imported: Book[] = [];

        for (const filePath of paths) {
          if (existingPaths.has(normalizePath(filePath))) continue;
          try {
            const book = await importSingleFile(filePath);
            imported.push(book);
            existingPaths.add(normalizePath(filePath));
          } catch (e) {
            logError(SOURCE, `导入失败: ${filePath}`, e);
          }
        }

        if (imported.length > 0) {
          set((s) => ({ books: [...s.books, ...imported] }));
        }
        logInfo(SOURCE, "导入完成", { imported: imported.length });
      } finally {
        set({ _importing: false });
      }
    },

    scanFolder: async () => {
      if (get()._importing) return;
      set({ _importing: true });

      try {
        const folder = await open({ directory: true });
        if (!folder) return;

        let scanned: ScannedBook[];
        try {
          scanned = await invoke<ScannedBook[]>("scan_books", {
            root: folder,
            extensions: ["txt", "epub", "pdf"],
          });
        } catch (e) {
          logError(SOURCE, "扫描目录失败", e);
          return;
        }

        if (scanned.length === 0) {
          logInfo(SOURCE, "扫描完成", { scanned: 0, imported: 0 });
          return;
        }

        const existingPaths = new Set(get().books.map((b) => normalizePath(b.path)));
        const imported: Book[] = [];

        for (const item of scanned) {
          if (existingPaths.has(normalizePath(item.path))) continue;
          try {
            const book = await importSingleFile(item.path, item.size);
            imported.push(book);
            existingPaths.add(normalizePath(item.path));
          } catch (e) {
            logError(SOURCE, `扫描导入失败: ${item.path}`, e);
          }
        }

        if (imported.length > 0) {
          set((s) => ({ books: [...s.books, ...imported] }));
        }
        logInfo(SOURCE, "扫描完成", { scanned: scanned.length, imported: imported.length });
      } finally {
        set({ _importing: false });
      }
    },

    hydrate: async () => {
      const persisted = await loadPersistedSettings(
        { books: [] as Book[] },
        "library.json"
      );
      set({ books: persisted.books, _hydrated: true });
    },
  }))
);

// 书籍列表变更时自动持久化（2s debounce 减轻 I/O 压力）
let libSaveTimer: ReturnType<typeof setTimeout> | null = null;

useLibraryStore.subscribe(
  (s) => s.books,
  (books) => {
    if (!useLibraryStore.getState()._hydrated) return;
    if (libSaveTimer) clearTimeout(libSaveTimer);
    libSaveTimer = setTimeout(() => {
      persistSettings({ books }, "library.json");
    }, 2000);
  }
);
