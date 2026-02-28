import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { loadPersistedSettings, persistSettings } from "@/lib/tauri-store";
import { logger } from "@/lib/logger";

export type Theme = "light" | "dark" | "sepia";
export type BookDeleteMode = "library-only" | "library-and-file";

interface SettingsState {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  margin: number;
  bookDeleteSkipConfirm: boolean;
  bookDeleteMode: BookDeleteMode;
  debugMode: boolean;
  _hydrated: boolean;
}

interface SettingsActions {
  setTheme: (theme: Theme) => void;
  setFontFamily: (fontFamily: string) => void;
  setFontSize: (fontSize: number) => void;
  setLineHeight: (lineHeight: number) => void;
  setMargin: (margin: number) => void;
  setBookDeleteSkipConfirm: (skip: boolean) => void;
  setBookDeleteMode: (mode: BookDeleteMode) => void;
  setDebugMode: (debugMode: boolean) => void;
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
  debugMode: false,
};

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
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
    setBookDeleteSkipConfirm: (skip) => set({ bookDeleteSkipConfirm: skip }),
    setBookDeleteMode: (mode) => set({ bookDeleteMode: mode }),
    setDebugMode: (debugMode) => set({ debugMode }),

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

// 调试模式变更时启用/关闭内存日志采集
useSettingsStore.subscribe(
  (s) => s.debugMode,
  (debugMode) => {
    logger.setEnabled(debugMode);
  }
);

// 设置变更时自动持久化（shallow 比较避免无变更触发）
let saveTimer: ReturnType<typeof setTimeout> | null = null;

useSettingsStore.subscribe(
  (s) => ({
    theme: s.theme,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    margin: s.margin,
    bookDeleteSkipConfirm: s.bookDeleteSkipConfirm,
    bookDeleteMode: s.bookDeleteMode,
    debugMode: s.debugMode,
  }),
  (settings) => {
    if (!useSettingsStore.getState()._hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistSettings(settings);
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
