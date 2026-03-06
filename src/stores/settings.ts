import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import type { BookConfig, Theme, ViewSettings } from "@/lib/book-config";
import { loadPersistedSettings, persistSettings } from "@/lib/tauri-store";
export type BookDeleteMode = "library-only" | "library-and-file";

interface SettingsState {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  margin: number;
  bookDeleteSkipConfirm: boolean;
  bookDeleteMode: BookDeleteMode;
  pdfCacheBaseDir: string;
  cacheMaxBytes: number;
  _hydrated: boolean;
}

interface SettingsActions {
  setTheme: (theme: Theme) => void;
  setFontFamily: (fontFamily: string) => void;
  setFontSize: (fontSize: number) => void;
  setLineHeight: (lineHeight: number) => void;
  setMargin: (margin: number) => void;
  setViewSettings: (patch: Partial<ViewSettings>) => void;
  setBookDeleteSkipConfirm: (skip: boolean) => void;
  setBookDeleteMode: (mode: BookDeleteMode) => void;
  setPdfCacheBaseDir: (pdfCacheBaseDir: string) => void;
  setCacheMaxBytes: (cacheMaxBytes: number) => void;
  hydrate: () => Promise<void>;
}

const DEFAULTS: Omit<SettingsState, "_hydrated"> = {
  theme: "light",
  fontFamily: "system-ui",
  fontSize: 18,
  lineHeight: 1.8,
  margin: 60,
  bookDeleteSkipConfirm: false,
  bookDeleteMode: "library-only",
  pdfCacheBaseDir: "",
  cacheMaxBytes: 256 * 1024 * 1024,
};

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function getPersistedSettingsSnapshot() {
  const state = useSettingsStore.getState();
  return {
    theme: state.theme,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    lineHeight: state.lineHeight,
    margin: state.margin,
    bookDeleteSkipConfirm: state.bookDeleteSkipConfirm,
    bookDeleteMode: state.bookDeleteMode,
    pdfCacheBaseDir: state.pdfCacheBaseDir,
    cacheMaxBytes: state.cacheMaxBytes,
  };
}

export function getViewSettingsSnapshot(
  state: Pick<SettingsState, "theme" | "fontFamily" | "fontSize" | "lineHeight" | "margin"> =
    useSettingsStore.getState()
): ViewSettings {
  return {
    theme: state.theme,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    lineHeight: state.lineHeight,
    margin: state.margin,
  };
}

export function getBookConfigSnapshot(): BookConfig {
  return {
    viewSettings: getViewSettingsSnapshot(),
  };
}

export function useViewSettings(): ViewSettings {
  return useSettingsStore((s) => ({
    theme: s.theme,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    margin: s.margin,
  }));
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  subscribeWithSelector((set) => ({
    ...DEFAULTS,
    _hydrated: false,

    setTheme: (theme) => set({ theme }),
    setFontFamily: (fontFamily) => set({ fontFamily }),
    setFontSize: (fontSize) => set({ fontSize }),
    setLineHeight: (lineHeight) => set({ lineHeight }),
    setMargin: (margin) => set({ margin }),
    setViewSettings: (patch) =>
      set((state) => ({
        theme: patch.theme ?? state.theme,
        fontFamily: patch.fontFamily ?? state.fontFamily,
        fontSize: patch.fontSize ?? state.fontSize,
        lineHeight: patch.lineHeight ?? state.lineHeight,
        margin: patch.margin ?? state.margin,
      })),
    setBookDeleteSkipConfirm: (skip) => set({ bookDeleteSkipConfirm: skip }),
    setBookDeleteMode: (mode) => set({ bookDeleteMode: mode }),
    setPdfCacheBaseDir: (pdfCacheBaseDir) => set({ pdfCacheBaseDir }),
    setCacheMaxBytes: (cacheMaxBytes) => set({ cacheMaxBytes }),

    hydrate: async () => {
      const persisted = await loadPersistedSettings(DEFAULTS);
      set({ ...persisted, _hydrated: true });
    },
  }))
);

// 主题变更时同步到 DOM + localStorage 缓存
useSettingsStore.subscribe(
  (s) => s.theme,
  (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem("reader-theme", theme);
    } catch {
      // localStorage 不可用时忽略
    }
  }
);

// 设置变更时自动持久化（shallow 比较避免无变更触发）
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function flushSettingsPersist() {
  if (!useSettingsStore.getState()._hydrated) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistSettings(getPersistedSettingsSnapshot());
}

useSettingsStore.subscribe(
  (s) => ({
    theme: s.theme,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    margin: s.margin,
    bookDeleteSkipConfirm: s.bookDeleteSkipConfirm,
    bookDeleteMode: s.bookDeleteMode,
    pdfCacheBaseDir: s.pdfCacheBaseDir,
    cacheMaxBytes: s.cacheMaxBytes,
  }),
  () => {
    if (!useSettingsStore.getState()._hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void persistSettings(getPersistedSettingsSnapshot());
    }, 500);
  },
  { equalityFn: shallow }
);

// 启动时快速恢复主题（同步读取 localStorage 缓存，避免闪烁）
const cachedTheme = (() => {
  try {
    return localStorage.getItem("reader-theme") as Theme | null;
  } catch {
    return null;
  }
})();
applyTheme(cachedTheme || DEFAULTS.theme);
