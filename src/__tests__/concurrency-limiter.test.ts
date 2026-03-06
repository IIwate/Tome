import { describe, it, expect } from "vitest";
import { createConcurrencyLimiter } from "@/lib/concurrency-limiter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("createConcurrencyLimiter", () => {
  it("并发限制：max=2 时任意时刻最多 2 个在运行", async () => {
    const limit = createConcurrencyLimiter(2);

    let running = 0;
    let maxRunning = 0;

    const ds = Array.from({ length: 5 }, () => deferred<void>());

    const ps = ds.map((d) =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await d.promise;
        running--;
      })
    );

    await flushMicrotasks();
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(running).toBe(2);

    ds[0]!.resolve();
    await flushMicrotasks();
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(running).toBe(2);

    ds[1]!.resolve();
    ds[2]!.resolve();
    ds[3]!.resolve();
    ds[4]!.resolve();
    await Promise.all(ps);

    expect(running).toBe(0);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("顺序执行：max=1 时按提交顺序执行", async () => {
    const limit = createConcurrencyLimiter(1);

    const started: number[] = [];
    const ds = Array.from({ length: 4 }, () => deferred<void>());

    const ps = ds.map((d, i) =>
      limit(async () => {
        started.push(i);
        await d.promise;
      })
    );

    await flushMicrotasks();
    expect(started).toEqual([0]);

    ds[0]!.resolve();
    await flushMicrotasks();
    expect(started).toEqual([0, 1]);

    ds[1]!.resolve();
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2]);

    ds[2]!.resolve();
    ds[3]!.resolve();
    await Promise.all(ps);

    expect(started).toEqual([0, 1, 2, 3]);
  });

  it("结果传递：resolve/reject 正确透传且不阻塞队列", async () => {
    const limit = createConcurrencyLimiter(1);

    const ok = await limit(async () => 42);
    expect(ok).toBe(42);

    const err = new Error("boom");
    await expect(
      limit(async () => {
        throw err;
      })
    ).rejects.toBe(err);

    const after = await limit(async () => "after");
    expect(after).toBe("after");
  });

  it("同步 throw + 长队列：不会递归爆栈且队列可继续推进", async () => {
    const limit = createConcurrencyLimiter(1);

    const gate = deferred<void>();
    const gateTask = limit(async () => {
      await gate.promise;
    });

    const err = new Error("sync boom");
    // 超过 V8 调用栈深度上限（~10k-15k），确保没有 draining 保护时会爆栈
    const throwCount = 20_000;

    // 只静默吞掉 rejection，不收集到数组里做 allSettled
    let rejectedCount = 0;
    for (let i = 0; i < throwCount; i++) {
      limit(() => {
        throw err;
      }).catch(() => {
        rejectedCount++;
      });
    }

    const afterPromise = limit(() => "after");

    gate.resolve();

    // 只等核心断言：gate 完成 + after 任务能正常拿到结果
    await gateTask;
    const afterValue = await afterPromise;
    expect(afterValue).toBe("after");

    // 等微任务队列排空，让所有 .catch 回调执行完
    await flushMicrotasks(20);
    expect(rejectedCount).toBe(throwCount);
  });

  it("队列清空：全部完成后不遗留占用", async () => {
    const limit = createConcurrencyLimiter(2);

    let running = 0;
    const started: number[] = [];

    const d1 = deferred<void>();
    const d2 = deferred<void>();

    const p1 = limit(async () => {
      started.push(1);
      running++;
      await d1.promise;
      running--;
    });
    const p2 = limit(async () => {
      started.push(2);
      running++;
      await d2.promise;
      running--;
    });

    await flushMicrotasks();
    expect(started).toEqual([1, 2]);
    expect(running).toBe(2);

    d1.resolve();
    d2.resolve();
    await Promise.all([p1, p2]);
    expect(running).toBe(0);

    const d3 = deferred<void>();
    const d4 = deferred<void>();

    const p3 = limit(async () => {
      started.push(3);
      running++;
      await d3.promise;
      running--;
    });
    const p4 = limit(async () => {
      started.push(4);
      running++;
      await d4.promise;
      running--;
    });

    await flushMicrotasks();
    expect(started.slice(-2)).toEqual([3, 4]);
    expect(running).toBe(2);

    d3.resolve();
    d4.resolve();
    await Promise.all([p3, p4]);
    expect(running).toBe(0);
  });
});
