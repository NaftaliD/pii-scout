export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryOptions {
  retries: number;
  baseMs: number;
  signal?: AbortSignal;
  /** Return false to fail immediately without retrying (e.g. a 4xx error). */
  shouldRetry?: (err: unknown) => boolean;
}

/** Runs fn; on failure waits baseMs * 2^attempt (with jitter) and retries, then rethrows. */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (attempt >= opts.retries || opts.shouldRetry?.(err) === false) throw err;
      const delay = opts.baseMs * 2 ** attempt * (0.5 + Math.random() / 2);
      await sleep(delay, opts.signal);
    }
  }
}

/** Like Promise.all(items.map(fn)) but with at most `limit` calls in flight. Results keep input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      signal?.throwIfAborted();
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
