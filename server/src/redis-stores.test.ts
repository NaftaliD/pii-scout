import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { afterAll, describe, expect, it } from "vitest";
import { sleep } from "./async";
import { HaltError } from "./guards";
import { RedisBudget, RedisRateLimiter, RedisStreamSlots, type RedisLike } from "./redis-stores";

// Same tests, two backends: a real Redis server when TEST_REDIS_URL is set (CI), else an in-process mock.
const url = process.env.TEST_REDIS_URL;
const client = (url ? new Redis(url) : new RedisMock()) as unknown as Redis;
afterAll(() => client.quit());

// Unique prefix per test, so tests never see each other's keys on a shared real server.
const prefix = () => `test:${randomUUID()}:`;

const down: RedisLike = {
  eval: () => Promise.reject(new Error("connection refused")),
  get: () => Promise.reject(new Error("connection refused")),
} as unknown as RedisLike;

describe("RedisRateLimiter", () => {
  it("allows `max` hits per window, then blocks with a retry hint", async () => {
    const rl = new RedisRateLimiter(client, 2, 60_000, prefix());
    expect((await rl.hit("a")).allowed).toBe(true);
    expect((await rl.hit("a")).allowed).toBe(true);
    const blocked = await rl.hit("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect((await rl.hit("b")).allowed).toBe(true); // other keys are independent
  });

  it("lets Redis expire the window by itself", async () => {
    const rl = new RedisRateLimiter(client, 1, 150, prefix());
    expect((await rl.hit("a")).allowed).toBe(true);
    expect((await rl.hit("a")).allowed).toBe(false);
    await sleep(300);
    expect((await rl.hit("a")).allowed).toBe(true);
  });

  it("fails OPEN when Redis is down", async () => {
    expect((await new RedisRateLimiter(down, 1, 1000).hit("a")).allowed).toBe(true);
  });
});

describe("RedisBudget", () => {
  it("refuses a charge that would pass the limit", async () => {
    const b = new RedisBudget(client, 3, prefix());
    await b.charge(1);
    await b.charge(2);
    await expect(b.charge(1)).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await b.status()).toEqual({ spent: 3, limit: 3 });
  });

  it("is atomic: concurrent charges can never overspend", async () => {
    const b = new RedisBudget(client, 5, prefix());
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => b.charge(1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await b.status()).spent).toBe(5);
  });

  it("starts a fresh budget each month", async () => {
    let now = new Date("2026-11-30T12:00:00Z");
    const b = new RedisBudget(client, 1, prefix(), () => now);
    await b.charge(1);
    await expect(b.charge(1)).rejects.toBeInstanceOf(HaltError);
    now = new Date("2026-12-01T00:00:01Z");
    await expect(b.charge(1)).resolves.toBeUndefined();
  });

  it("fails CLOSED when Redis is down", async () => {
    const b = new RedisBudget(down, 100);
    await expect(b.charge(1)).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await b.status()).toEqual({ spent: null, limit: 100 });
  });
});

describe("RedisStreamSlots", () => {
  it("enforces the per-key and total caps and frees slots on release", async () => {
    const s = new RedisStreamSlots(client, 2, 3, 60, prefix());
    const a1 = await s.acquire("a");
    const a2 = await s.acquire("a");
    expect(a1 && a2).toBeTruthy();
    expect(await s.acquire("a")).toBeNull(); // per-key cap
    expect(await s.acquire("b")).toBeTruthy(); // total now 3
    expect(await s.acquire("c")).toBeNull(); // total cap
    await a1!();
    expect(await s.acquire("c")).toBeTruthy();
  });

  it("does not free two slots on a double release", async () => {
    const s = new RedisStreamSlots(client, 1, 10, 60, prefix());
    const release = (await s.acquire("a"))!;
    await release();
    await release();
    const again = await s.acquire("a");
    expect(again).toBeTruthy();
    expect(await s.acquire("a")).toBeNull();
  });

  it("fails OPEN when Redis is down", async () => {
    const release = await new RedisStreamSlots(down, 1, 1).acquire("a");
    expect(release).toBeTypeOf("function");
  });
});
