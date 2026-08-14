/**
 * Cache priming gate.
 *
 * → docs/SPEC-token-economy.md §3
 *
 * VẤN ĐỀ: bung N task cùng cacheKey song song khi cache chưa có → cả N cùng
 * miss, cả N cùng trả cache_write (1.25–2×). Đúng lúc song song đáng lẽ tiết
 * kiệm thì lại đắt nhất.
 *
 * GIẢI: task đầu tiên của mỗi cacheKey chạy một mình. Các task còn lại CHỜ,
 * và chỉ chờ tới khi primer NHẬN ĐƯỢC TOKEN ĐẦU TIÊN — không chờ nó chạy xong.
 * Prefix đã được ghi vào cache ở thời điểm đó.
 */

const NOOP = (): void => {};

export interface GateStats {
  warmKeys: number;
  primings: number;
  waits: number;
  timeouts: number;
}

export class CachePrimingGate {
  private readonly warm = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<void>>();
  private stats: GateStats = { warmKeys: 0, primings: 0, waits: 0, timeouts: 0 };

  constructor(
    private readonly ttlMs: number,
    private readonly timeoutMs: number,
  ) {}

  /**
   * Trả về hàm release. Worker PHẢI gọi nó ngay khi nhận message đầu tiên
   * từ API, và lần nữa trong `finally` (gọi nhiều lần là an toàn).
   */
  async acquire(cacheKey: string): Promise<() => void> {
    const now = Date.now();

    const expires = this.warm.get(cacheKey);
    if (expires !== undefined && expires > now) {
      // Cache đang ấm — mỗi lần dùng lại gia hạn TTL phía server, nên gia hạn cả ở đây.
      this.warm.set(cacheKey, now + this.ttlMs);
      return NOOP;
    }

    const pending = this.inflight.get(cacheKey);
    if (pending) {
      this.stats.waits++;
      let timedOut = true;
      await Promise.race([
        pending.then(() => {
          timedOut = false;
        }),
        sleep(this.timeoutMs),
      ]);
      // Thà trả tiền cache_write còn hơn treo task vô hạn.
      if (timedOut) this.stats.timeouts++;
      return NOOP;
    }

    this.stats.primings++;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.inflight.set(cacheKey, promise);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.warm.set(cacheKey, Date.now() + this.ttlMs);
      this.stats.warmKeys = this.warm.size;
      this.inflight.delete(cacheKey);
      resolve();
    };
  }

  isWarm(cacheKey: string): boolean {
    const e = this.warm.get(cacheKey);
    return e !== undefined && e > Date.now();
  }

  snapshot(): GateStats {
    return { ...this.stats, warmKeys: this.warm.size };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
