import { LazyStore } from "@tauri-apps/plugin-store";

const stores = new Map<string, LazyStore>();
const STORAGE_PREFIX = "tome.store.";

function getStore(filename: string): LazyStore {
  let store = stores.get(filename);
  if (!store) {
    store = new LazyStore(filename);
    stores.set(filename, store);
  }
  return store;
}

function getStorageKey(filename: string): string {
  return `${STORAGE_PREFIX}${filename}`;
}

function readFallbackStore(filename: string): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(getStorageKey(filename));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeFallbackStore(filename: string, data: Record<string, unknown>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(getStorageKey(filename), JSON.stringify(data));
}

export async function loadPersistedSettings<T extends Record<string, unknown>>(
  defaults: T,
  filename = "settings.json"
): Promise<T> {
  const result = { ...defaults };
  try {
    const store = getStore(filename);
    for (const key of Object.keys(defaults)) {
      const value = await store.get<unknown>(key);
      if (value !== undefined && value !== null) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
  } catch {
    const fallback = readFallbackStore(filename);
    for (const key of Object.keys(defaults)) {
      const value = fallback[key];
      if (value !== undefined && value !== null) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
  }
}

export async function persistSettings(
  settings: Record<string, unknown>,
  filename = "settings.json"
): Promise<void> {
  try {
    const store = getStore(filename);
    for (const [key, value] of Object.entries(settings)) {
      await store.set(key, value);
    }
    await store.save();
  } catch (e) {
    const existing = readFallbackStore(filename);
    writeFallbackStore(filename, { ...existing, ...settings });
    console.error("Failed to persist settings in tauri store, fallback to localStorage:", e);
  }
}
