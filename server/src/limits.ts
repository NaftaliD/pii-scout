/**
 * Fixed-window rate limiter: each key may make `max` hits per `windowMs`.
 * State is in this process's memory only: it resets on restart and is not shared between instances.
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit. If not allowed, `retryAfterMs` says when the key's window resets. */
  hit(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = this.now();
    this.sweep(now);
    let w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    if (w.count >= this.max) return { allowed: false, retryAfterMs: w.resetAt - now };
    w.count++;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Number of keys currently tracked (exposed for tests). */
  get size(): number {
    return this.windows.size;
  }

  // Drop expired windows, at most once per window, so the Map cannot grow without bound.
  // Done lazily inside hit() instead of with a timer: no timer to leak or to keep the process alive.
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, w] of this.windows) if (now >= w.resetAt) this.windows.delete(key);
  }
}

/** Caps how many things (e.g. open streams) may run at once, per key and in total. */
export class ConcurrencyLimiter {
  private perKey = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly maxPerKey: number,
    private readonly maxTotal: number,
  ) {}

  /** Returns a release function, or null if a limit is reached. Calling release twice is harmless. */
  acquire(key: string): (() => void) | null {
    const mine = this.perKey.get(key) ?? 0;
    if (mine >= this.maxPerKey || this.total >= this.maxTotal) return null;
    this.perKey.set(key, mine + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const left = (this.perKey.get(key) ?? 1) - 1;
      if (left <= 0) this.perKey.delete(key);
      else this.perKey.set(key, left);
    };
  }

  get active(): number {
    return this.total;
  }
}
