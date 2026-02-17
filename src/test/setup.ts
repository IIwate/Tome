import { afterEach, vi } from "vitest";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16);
}

if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

