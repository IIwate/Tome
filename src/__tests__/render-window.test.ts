import { describe, it, expect } from "vitest";
import { calcRenderWindow } from "@/lib/render-window";

describe("calcRenderWindow", () => {
  it("中间位置：nearPages=[50,51], buffer=8 -> start=42, end=59", () => {
    const r = calcRenderWindow({
      nearPages: [50, 51],
      pageCount: 100,
      buffer: 8,
      estimatedHeight: 1000,
      gap: 24,
    });
    expect(r.start).toBe(42);
    expect(r.end).toBe(59);
  });

  it("靠近开头：nearPages=[2] -> start=0", () => {
    const r = calcRenderWindow({
      nearPages: [2],
      pageCount: 100,
      buffer: 8,
      estimatedHeight: 1000,
      gap: 24,
    });
    expect(r.start).toBe(0);
  });

  it("靠近末尾：nearPages=[998], pageCount=1000 -> end=999", () => {
    const r = calcRenderWindow({
      nearPages: [998],
      pageCount: 1000,
      buffer: 8,
      estimatedHeight: 1000,
      gap: 24,
    });
    expect(r.end).toBe(999);
  });

  it("padding 计算：topPadding = start*(estimatedHeight+gap)", () => {
    const estimatedHeight = 1200;
    const gap = 24;
    const r = calcRenderWindow({
      nearPages: [50, 51],
      pageCount: 100,
      buffer: 8,
      estimatedHeight,
      gap,
    });
    expect(r.topPadding).toBe(r.start * (estimatedHeight + gap));
  });

  it("空文档：pageCount=0 -> end < start（空窗口）", () => {
    const r = calcRenderWindow({
      nearPages: [0],
      pageCount: 0,
      buffer: 8,
      estimatedHeight: 1000,
      gap: 24,
    });
    expect(r.start).toBe(0);
    expect(r.end).toBe(-1);
    expect(r.topPadding).toBe(0);
    expect(r.bottomPadding).toBe(0);
  });

  it("nearPages 为 null -> 默认窗口从 0 开始", () => {
    const r = calcRenderWindow({
      nearPages: null,
      pageCount: 100,
      buffer: 8,
      estimatedHeight: 1000,
      gap: 24,
    });
    expect(r.start).toBe(0);
    expect(r.end).toBe(16); // min(99, 8*2)
  });

  it("nearPages 含无效值（NaN、负数、超范围）被过滤", () => {
    const r = calcRenderWindow({
      nearPages: [NaN, -5, 200, 50],
      pageCount: 100,
      buffer: 8,
      estimatedHeight: 1000,
      gap: 24,
    });
    // 有效值仅 50，200 超出 pageCount=100 被忽略
    expect(r.start).toBe(42); // 50-8
    expect(r.end).toBe(58); // 50+8
  });

  it("单页文档：pageCount=1", () => {
    const r = calcRenderWindow({
      nearPages: [0],
      pageCount: 1,
      buffer: 8,
      estimatedHeight: 1000,
      gap: 24,
    });
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
    expect(r.topPadding).toBe(0);
    expect(r.bottomPadding).toBe(0);
  });

  it("buffer=0：窗口仅覆盖 nearPages 本身", () => {
    const r = calcRenderWindow({
      nearPages: [50],
      pageCount: 100,
      buffer: 0,
      estimatedHeight: 1000,
      gap: 24,
    });
    expect(r.start).toBe(50);
    expect(r.end).toBe(50);
  });

  it("bottomPadding 正确计算", () => {
    const estimatedHeight = 1000;
    const gap = 24;
    const r = calcRenderWindow({
      nearPages: [50],
      pageCount: 100,
      buffer: 8,
      estimatedHeight,
      gap,
    });
    expect(r.bottomPadding).toBe((100 - r.end - 1) * (estimatedHeight + gap));
  });
});

