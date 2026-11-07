/**
 * The seams between the app and wherever its shared state lives (process memory or Redis).
 * Return types allow a plain value or a Promise, so the in-memory classes stay synchronous
 * while the Redis ones are async. `await` works on both.
 */
export type MaybePromise<T> = T | Promise<T>;

export interface RateVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimit {
  hit(key: string): MaybePromise<RateVerdict>;
}

export interface StreamSlots {
  /** Returns a release function, or null if a limit is reached. */
  acquire(key: string): MaybePromise<(() => MaybePromise<void>) | null>;
}

export interface Budget {
  /** Charges `units`, or throws HaltError if that would pass the limit. */
  charge(units: number): MaybePromise<void>;
  /** `spent` is null when it cannot be read (e.g. Redis unreachable). */
  status(): MaybePromise<{ spent: number | null; limit: number }>;
}
