/**
 * Cache priming gate.
 *
 * → docs/SPEC-token-economy.md §3
 *
 * THE PROBLEM: firing N tasks that share a cacheKey in parallel while the cache
 * is cold makes all N miss, and all N pay cache_write (1.25–2×). The very moment
 * parallelism ought to save money is the moment it costs the most.
 *
 * THE FIX: the first task on each cacheKey runs alone. The rest WAIT — and only
 * until the primer RECEIVES ITS FIRST TOKEN, not until it finishes. The prefix
 * has been written to the cache by that point.
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
   * Returns a release function. The worker MUST call it the moment the first
   * message arrives from the API, and again in its `finally` — calling it more
   * than once is safe.
   */
  async acquire(cacheKey: string): Promise<() => void> {
    const now = Date.now();

    const expires = this.warm.get(cacheKey);
    if (expires !== undefined && expires > now) {
      // Warm — every reuse extends the TTL on the server side, so extend it here too.
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
      // Better to pay for a cache_write than to hang a task forever.
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
