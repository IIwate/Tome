import { describe, expect, it } from "vitest";
import {
  evictPdfPageCacheByDistance,
  MAX_CACHED_PAGES,
} from "@/components/reader/PdfReaderView";

describe("evictPdfPageCacheByDistance", () => {
  it("不超过上限时不驱逐", () => {
    const evicted = evictPdfPageCacheByDistance({
      cacheKeys: [1, 2, 3],
      pinned: [2],
      anchors: [2],
      max: MAX_CACHED_PAGES,
    });

    expect(evicted.size).toBe(0);
  });

  it("超过上限时驱逐到上限且保留 pinned", () => {
    const cacheKeys = Array.from({ length: 250 }, (_, index) => index);
    const pinned = new Set([120, 121, 122]);

    const evicted = evictPdfPageCacheByDistance({
      cacheKeys,
      pinned,
      anchors: [120],
      max: MAX_CACHED_PAGES,
    });

    expect(evicted.size).toBe(50);
    expect(Array.from(evicted).some((key) => pinned.has(key))).toBe(false);
  });

  it("优先驱逐距离锚点最远的页", () => {
    const evicted = evictPdfPageCacheByDistance({
      cacheKeys: Array.from({ length: 10 }, (_, index) => index),
      pinned: [],
      anchors: [5],
      max: 4,
    });

    expect(evicted.has(5)).toBe(false);
    expect(evicted.has(4)).toBe(false);
    expect(evicted.has(6)).toBe(false);
    expect(evicted.has(0)).toBe(true);
    expect(evicted.has(9)).toBe(true);
  });
});
