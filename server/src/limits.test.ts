import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter, RateLimiter } from "./limits";

describe("RateLimiter", () => {
  it("allows `max` hits per window, then reports when to retry", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect(rl.hit("a").allowed).toBe(true);
    expect(rl.hit("a").allowed).toBe(true);
    t = 400;
    expect(rl.hit("a")).toEqual({ allowed: false, retryAfterMs: 600 });
  });

  it("tracks keys independently and opens a fresh window after expiry", () => {
    let t = 0;
    const rl = new RateLimiter(1, 1000, () => t);
    expect(rl.hit("a").allowed).toBe(true);
    expect(rl.hit("b").allowed).toBe(true);
    expect(rl.hit("a").allowed).toBe(false);
    t = 1000;
    expect(rl.hit("a").allowed).toBe(true);
  });

  it("sweeps expired keys so memory does not grow forever", () => {
    let t = 0;
    const rl = new RateLimiter(1, 1000, () => t);
    for (let i = 0; i < 100; i++) rl.hit(`ip-${i}`);
    expect(rl.size).toBe(100);
    t = 5000;
    rl.hit("someone-new");
    expect(rl.size).toBe(1);
  });
});

describe("ConcurrencyLimiter", () => {
  it("enforces the per-key and total caps", () => {
    const cl = new ConcurrencyLimiter(2, 3);
    const a1 = cl.acquire("a");
    const a2 = cl.acquire("a");
    expect(a1 && a2).toBeTruthy();
    expect(cl.acquire("a")).toBeNull(); // per-key cap
    expect(cl.acquire("b")).toBeTruthy(); // total now 3
    expect(cl.acquire("c")).toBeNull(); // total cap
  });

  it("frees a slot on release, and a double release does not free two", () => {
    const cl = new ConcurrencyLimiter(1, 10);
    const release = cl.acquire("a")!;
    expect(cl.acquire("a")).toBeNull();
    release();
    release();
    expect(cl.active).toBe(0);
    expect(cl.acquire("a")).toBeTruthy();
    expect(cl.acquire("a")).toBeNull();
  });
});
