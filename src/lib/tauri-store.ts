import { LazyStore } from "@tauri-apps/plugin-store";
import { logError } from "@/lib/logger";

const SOURCE = "lib/tauri-store";

const stores = new Map<string, LazyStore>();

function getStore(filename: string): LazyStore {
  let store = stores.get(filename);
  if (!store) {
    store = new LazyStore(filename);
    stores.set(filename, store);
  }
  return store;
}

export async function loadPersistedSettings<T extends Record<string, unknown>>(
  defaults: T,
  filename = "settings.json"
): Promise<T> {
  try {
    const store = getStore(filename);
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = await store.get<unknown>(key);
      if (value !== undefined && value !== null) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
  } catch {
    return defaults;
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
    logError(SOURCE, "设置持久化失败", e);
  }
}
