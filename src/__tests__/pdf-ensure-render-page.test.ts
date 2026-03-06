import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const {
  applyRenderPageResult,
  resolveRenderPageUrl,
} = await import("@/components/reader/PdfReaderView");

describe("PDF render result helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("file 结果会直接写入后端提供的逻辑 URL", () => {
    const cache = {
      url: null,
      height: null,
      loading: true,
      error: "old",
    };

    const next = applyRenderPageResult(cache, {
      kind: "file",
      page_index: 0,
      width: 832,
      resource_url: "http://tome-cache.localhost/abc/0_832.jpg",
    });

    expect(next.url).toBe("http://tome-cache.localhost/abc/0_832.jpg");
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  it("data 结果保持原 data_url", () => {
    expect(
      resolveRenderPageUrl({
        kind: "data",
        page_index: 0,
        width: 832,
        data_url: "data:image/jpeg;base64,abc",
      })
    ).toBe("data:image/jpeg;base64,abc");
  });
});
