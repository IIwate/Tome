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
  _importing: boolean;
}

interface LibraryActions {
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  updateBook: (id: string, updates: Partial<Book>) => void;
  importFiles: () => Promise<void>;
  scanFolder: () => Promise<void>;
  hydrate: () => Promise<void>;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function filenameFromPath(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  return name.replace(/\.(txt|epub)$/i, "");
}

/** 导入单个文件到书架（元数据提取，不含去重） */
async function importSingleFile(
  filePath: string,
  fileSize?: number
): Promise<Book> {
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
    _importing: false,

    addBook: (book) => set((s) => ({ books: [...s.books, book] })),

    removeBook: (id) =>
      set((s) => ({ books: s.books.filter((b) => b.id !== id) })),

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
          filters: [{ name: "书籍", extensions: ["txt", "epub"] }],
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
            console.error(`导入失败: ${filePath}`, e);
          }
        }

        if (imported.length > 0) {
          set((s) => ({ books: [...s.books, ...imported] }));
        }
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
            extensions: ["txt", "epub"],
          });
        } catch (e) {
          console.error("扫描目录失败:", e);
          return;
        }

        if (scanned.length === 0) return;

        const existingPaths = new Set(get().books.map((b) => normalizePath(b.path)));
        const imported: Book[] = [];

        for (const item of scanned) {
          if (existingPaths.has(normalizePath(item.path))) continue;
          try {
            const book = await importSingleFile(item.path, item.size);
            imported.push(book);
            existingPaths.add(normalizePath(item.path));
          } catch (e) {
            console.error(`导入失败: ${item.path}`, e);
          }
        }

        if (imported.length > 0) {
          set((s) => ({ books: [...s.books, ...imported] }));
        }
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
