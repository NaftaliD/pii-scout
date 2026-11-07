import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "./app";
import { sleep } from "./async";
import { ConcurrencyLimiter, RateLimiter } from "./limits";
import type { StreamSlots } from "./stores";

let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
});

function start(opts: AppOptions): string {
  server = createApp(opts).listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const scan = (base: string, path = "/api/scan", extra: Record<string, string> = {}, signal?: AbortSignal) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify({ text: "a@b.com ref 987654321" }),
    signal,
  });

describe("rate limiting", () => {
  it("answers 429 with Retry-After once the limit is used up, but never limits /health", async () => {
    const base = start({ rateLimiter: new RateLimiter(2, 60_000) });
    expect((await scan(base)).status).toBe(200);
    expect((await scan(base)).status).toBe(200);
    const blocked = await scan(base);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("ignores X-Forwarded-For unless the proxy is trusted (everyone shares one IP)", async () => {
    const base = start({ rateLimiter: new RateLimiter(1, 60_000), trustProxyHops: 0 });
    expect((await scan(base, "/api/scan", { "x-forwarded-for": "1.1.1.1" })).status).toBe(200);
    expect((await scan(base, "/api/scan", { "x-forwarded-for": "2.2.2.2" })).status).toBe(429);
  });

  it("limits each real client separately when the proxy hop is trusted", async () => {
    const base = start({ rateLimiter: new RateLimiter(1, 60_000), trustProxyHops: 1 });
    expect((await scan(base, "/api/scan", { "x-forwarded-for": "1.1.1.1" })).status).toBe(200);
    expect((await scan(base, "/api/scan", { "x-forwarded-for": "2.2.2.2" })).status).toBe(200);
    expect((await scan(base, "/api/scan", { "x-forwarded-for": "1.1.1.1" })).status).toBe(429);
  });
});

const slowClassifier = async (_r: unknown, signal?: AbortSignal) => {
  await sleep(10_000, signal);
  return { label: "sensitive" as const, reason: "r" };
};

describe("stream cap", () => {
  const slow = slowClassifier;

  it("refuses a stream over the cap and frees the slot when the client disconnects", async () => {
    const streams = new ConcurrencyLimiter(1, 10);
    const base = start({ classifier: slow, streamLimiter: streams });

    const ac = new AbortController();
    const first = await scan(base, "/api/scan/stream", {}, ac.signal);
    expect(first.status).toBe(200);
    expect(streams.active).toBe(1);

    expect((await scan(base, "/api/scan/stream")).status).toBe(429);

    ac.abort();
    for (let i = 0; i < 50 && streams.active > 0; i++) await sleep(20);
    expect(streams.active).toBe(0);
    const again = new AbortController();
    expect((await scan(base, "/api/scan/stream", {}, again.signal)).status).toBe(200);
    again.abort();
  });

  it("frees the slot when the client disconnects while an async limiter is still deciding", async () => {
    // Like a Redis round trip: the slot is granted only after a delay.
    let held = 0;
    const slow: StreamSlots = {
      async acquire() {
        await sleep(150);
        held++;
        return async () => {
          held--;
        };
      },
    };
    const base = start({ classifier: slowClassifier, streamLimiter: slow });
    const ac = new AbortController();
    const pending = scan(base, "/api/scan/stream", {}, ac.signal).catch(() => undefined);
    await sleep(30);
    ac.abort(); // client leaves before the slot is even granted
    await pending;
    await sleep(400);
    expect(held).toBe(0);
  });
});
