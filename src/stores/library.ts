import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { loadPersistedSettings, persistSettings } from "@/lib/tauri-store";
import { extractEpubMeta } from "@/lib/epub-meta";
import { generateTxtCover } from "@/lib/cover-gen";

export interface Book {
  id: string;
  path: string;
  format: "epub" | "txt";
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
}

interface LibraryActions {
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  updateBook: (id: string, updates: Partial<Book>) => void;
  importFiles: () => Promise<void>;
  scanFolder: () => Promise<void>;
  hydrate: () => Promise<void>;
}

function filenameFromPath(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  return name.replace(/\.(txt|epub)$/i, "");
}

/** 导入单个文件到书架（去重、元数据提取） */
async function importSingleFile(
  filePath: string,
  existingBooks: Book[],
  fileSize?: number
): Promise<Book | null> {
  // 去重
  if (existingBooks.some((b) => b.path === filePath)) return null;

  const ext = filePath.toLowerCase().split(".").pop();
  const format: "epub" | "txt" = ext === "epub" ? "epub" : "txt";

  const size =
    fileSize ?? (await invoke<number>("stat_file", { path: filePath }));

  let title = filenameFromPath(filePath);
  let author = "";
  let coverDataUrl = "";

  if (format === "epub") {
    const bytes = await invoke<ArrayBuffer>("read_file_bytes", {
      path: filePath,
    });
    const meta = extractEpubMeta(new Uint8Array(bytes));
    title = meta.title;
    author = meta.author;
    coverDataUrl = meta.coverDataUrl;
  } else {
    coverDataUrl = generateTxtCover(title);
  }

  return {
    id: crypto.randomUUID(),
    path: filePath,
    format,
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

    addBook: (book) => set((s) => ({ books: [...s.books, book] })),

    removeBook: (id) =>
      set((s) => ({ books: s.books.filter((b) => b.id !== id) })),

    updateBook: (id, updates) =>
      set((s) => ({
        books: s.books.map((b) => (b.id === id ? { ...b, ...updates } : b)),
      })),

    importFiles: async () => {
      const selected = await open({
        multiple: true,
        filters: [{ name: "书籍", extensions: ["txt", "epub"] }],
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];

      for (const filePath of paths) {
        try {
          const book = await importSingleFile(filePath, get().books);
          if (book) set((s) => ({ books: [...s.books, book] }));
        } catch (e) {
          console.error(`导入失败: ${filePath}`, e);
        }
      }
    },

    scanFolder: async () => {
      const folder = await open({ directory: true });
      if (!folder) return;

      const scanned = await invoke<ScannedBook[]>("scan_books", {
        root: folder,
        extensions: ["txt", "epub"],
      });

      if (scanned.length === 0) return;

      for (const item of scanned) {
        try {
          const book = await importSingleFile(
            item.path,
            get().books,
            item.size
          );
          if (book) set((s) => ({ books: [...s.books, book] }));
        } catch (e) {
          console.error(`导入失败: ${item.path}`, e);
        }
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

// 书籍列表变更时自动持久化
let libSaveTimer: ReturnType<typeof setTimeout> | null = null;

useLibraryStore.subscribe(
  (s) => s.books,
  (books) => {
    if (!useLibraryStore.getState()._hydrated) return;
    if (libSaveTimer) clearTimeout(libSaveTimer);
    libSaveTimer = setTimeout(() => {
      persistSettings({ books }, "library.json");
    }, 500);
  }
);
