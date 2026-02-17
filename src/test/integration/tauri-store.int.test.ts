import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get() {
      throw new Error("tauri store unavailable");
    }
    async set() {
      throw new Error("tauri store unavailable");
    }
    async save() {
      throw new Error("tauri store unavailable");
    }
  },
}));

describe("tauri-store fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("loadPersistedSettings 在 tauri 不可用时回退到 localStorage", async () => {
    localStorage.setItem(
      "tome.store.library.json",
      JSON.stringify({
        books: [{ id: "b1", title: "本地缓存书籍" }],
      })
    );

    const { loadPersistedSettings } = await import("@/lib/tauri-store");
    const result = await loadPersistedSettings(
      { books: [] as Array<{ id: string; title: string }> },
      "library.json"
    );

    expect(result.books).toHaveLength(1);
    expect(result.books[0]?.id).toBe("b1");
  });

  it("persistSettings 在 tauri 不可用时写入 localStorage", async () => {
    const { persistSettings } = await import("@/lib/tauri-store");
    await persistSettings({ theme: "dark" }, "settings.json");

    const raw = localStorage.getItem("tome.store.settings.json");
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.theme).toBe("dark");
  });
});
