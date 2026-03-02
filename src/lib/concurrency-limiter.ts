export type ConcurrencyLimiter = <T>(task: () => Promise<T> | T) => Promise<T>;

/**
 * 并发限制器：限制同时运行的异步任务数量。
 * - FIFO 排队
 * - 任务完成/失败后自动拉起队列
 * - 正确透传 resolve/reject
 */
export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  if (!Number.isFinite(max) || max < 1) {
    throw new Error("max 必须是 >= 1 的有限数字");
  }

  const concurrency = Math.floor(max);
  let running = 0;
  let draining = false;
  const queue: Array<() => void> = [];

  const tryStartNext = () => {
    if (draining) return;
    draining = true;

    try {
      while (running < concurrency && queue.length > 0) {
        const start = queue.shift();
        start?.();
      }
    } finally {
      draining = false;
    }
  };

  const limit: ConcurrencyLimiter = (task) =>
    new Promise((resolve, reject) => {
      const start = () => {
        running++;

        let result: Promise<unknown> | unknown;
        try {
          result = task();
        } catch (err) {
          running--;
          tryStartNext();
          reject(err);
          return;
        }

        Promise.resolve(result)
          .then((v) => resolve(v as never), reject)
          .finally(() => {
            running--;
            tryStartNext();
          });
      };

      if (running < concurrency) start();
      else queue.push(start);
    });

  return limit;
}
