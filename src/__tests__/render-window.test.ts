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
});

