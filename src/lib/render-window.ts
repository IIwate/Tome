export interface RenderWindowResult {
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toFiniteNonNegativeInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * 计算虚拟化渲染窗口（纯函数）。
 *
 * - start/end：包含端点，且 clamp 到 0..pageCount-1
 * - padding：按统一的 estimatedHeight+gap 估算
 */
export function calcRenderWindow(params: {
  nearPages: Iterable<number> | null | undefined;
  pageCount: number;
  buffer: number;
  estimatedHeight: number;
  gap: number;
}): RenderWindowResult {
  const pageCount = toFiniteNonNegativeInt(params.pageCount);
  if (pageCount <= 0) {
    return { start: 0, end: -1, topPadding: 0, bottomPadding: 0 };
  }

  const buffer = toFiniteNonNegativeInt(params.buffer);
  const estimatedHeight = Number.isFinite(params.estimatedHeight)
    ? params.estimatedHeight
    : 0;
  const gap = Number.isFinite(params.gap) ? params.gap : 0;
  const step = Math.max(0, estimatedHeight + gap);

  let minNear = Number.POSITIVE_INFINITY;
  let maxNear = Number.NEGATIVE_INFINITY;

  if (params.nearPages) {
    for (const raw of params.nearPages) {
      const idx = Number(raw);
      if (!Number.isFinite(idx)) continue;
      const i = Math.floor(idx);
      if (i < 0 || i >= pageCount) continue;
      minNear = Math.min(minNear, i);
      maxNear = Math.max(maxNear, i);
    }
  }

  let start = 0;
  let end = Math.min(pageCount - 1, buffer * 2);

  if (Number.isFinite(minNear) && Number.isFinite(maxNear)) {
    start = clampInt(minNear - buffer, 0, pageCount - 1);
    end = clampInt(maxNear + buffer, 0, pageCount - 1);
  }

  const topPadding = start * step;
  const bottomPadding = Math.max(0, (pageCount - end - 1) * step);

  return { start, end, topPadding, bottomPadding };
}

