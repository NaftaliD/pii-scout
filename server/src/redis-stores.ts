import type { Redis } from "ioredis";
import { HaltError } from "./guards";
import type { Budget, RateLimit, RateVerdict, StreamSlots } from "./stores";

/** Only the commands we use, so tests can pass a mock or a stub. */
export type RedisLike = Pick<Redis, "eval" | "get">;

const lastWarn = new Map<string, number>();
/** Logs each distinct message at most once every 30 s, so an outage does not flood the logs. Never logs request data. */
export function warnOnce(message: string): void {
  const now = Date.now();
  if (now - (lastWarn.get(message) ?? 0) > 30_000) {
    lastWarn.set(message, now);
    console.warn(message);
  }
}

// Each script runs as one atomic unit inside Redis: no other command can interleave.

// INCR and PEXPIRE must not be separated. If we died in between, the key would never expire.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

// "Check, then add" must be one step, or two instances could both pass the check and overspend.
const CHARGE = `
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
if spent + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return -1 end
local total = redis.call('INCRBY', KEYS[1], ARGV[1])
if total == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
return total
`;

const ACQUIRE = `
local mine = tonumber(redis.call('GET', KEYS[1]) or '0')
local total = tonumber(redis.call('GET', KEYS[2]) or '0')
if mine >= tonumber(ARGV[1]) or total >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1
`;

const RELEASE = `
for i = 1, 2 do
  local v = tonumber(redis.call('GET', KEYS[i]) or '0')
  if v > 1 then redis.call('DECR', KEYS[i]) else redis.call('DEL', KEYS[i]) end
end
return 1
`;

/**
 * Fixed-window counter per key, shared by every server instance.
 * Redis deletes expired windows itself, so there is no sweep like the in-memory version needs.
 * Fails OPEN: if Redis is unreachable, requests are allowed (availability over strictness).
 */
export class RedisRateLimiter implements RateLimit {
  constructor(
    private readonly redis: RedisLike,
    private readonly max: number,
    private readonly windowMs: number,
    private readonly prefix = "rate:",
  ) {}

  async hit(key: string): Promise<RateVerdict> {
    try {
      const [count, ttlMs] = (await this.redis.eval(HIT, 1, this.prefix + key, this.windowMs)) as [number, number];
      if (count > this.max) return { allowed: false, retryAfterMs: Math.max(ttlMs, 0) };
      return { allowed: true, retryAfterMs: 0 };
    } catch {
      warnOnce("rate limiter: Redis unavailable, allowing requests");
      return { allowed: true, retryAfterMs: 0 };
    }
  }
}

/**
 * Monthly spend counter shared by every instance (key `spend:YYYY-MM`, so it resets by itself).
 * Fails CLOSED: if spend cannot be verified, the call is refused, because protecting money is the point.
 * Costs are whole units (INCRBY is integer-only), so fractional costs are rounded up.
 */
export class RedisBudget implements Budget {
  constructor(
    private readonly redis: RedisLike,
    readonly limit: number,
    private readonly prefix = "spend:",
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key(): string {
    return this.prefix + this.now().toISOString().slice(0, 7);
  }

  async charge(units: number): Promise<void> {
    let result: number;
    try {
      const fortyDays = 40 * 24 * 3600;
      result = (await this.redis.eval(CHARGE, 1, this.key(), Math.ceil(units), this.limit, fortyDays)) as number;
    } catch {
      warnOnce("budget: Redis unavailable, refusing LLM calls");
      throw new HaltError("budget_exhausted", "LLM spend limit could not be verified");
    }
    if (result < 0) throw new HaltError("budget_exhausted", "LLM spend limit reached");
  }

  async status(): Promise<{ spent: number | null; limit: number }> {
    try {
      return { spent: Number((await this.redis.get(this.key())) ?? 0), limit: this.limit };
    } catch {
      return { spent: null, limit: this.limit };
    }
  }
}

/**
 * Caps simultaneous streams per key and overall, across every instance.
 * Counters carry a TTL, so slots leaked by a crashed instance heal themselves.
 * Fails OPEN, like the rate limiter.
 */
export class RedisStreamSlots implements StreamSlots {
  constructor(
    private readonly redis: RedisLike,
    private readonly maxPerKey: number,
    private readonly maxTotal: number,
    private readonly ttlSeconds = 300,
    private readonly prefix = "streams:",
  ) {}

  async acquire(key: string): Promise<(() => Promise<void>) | null> {
    const keys = [this.prefix + "ip:" + key, this.prefix + "total"];
    try {
      const ok = await this.redis.eval(ACQUIRE, 2, ...keys, this.maxPerKey, this.maxTotal, this.ttlSeconds);
      if (ok !== 1) return null;
    } catch {
      warnOnce("stream slots: Redis unavailable, allowing streams");
      return async () => {};
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await this.redis.eval(RELEASE, 2, ...keys);
      } catch {
        // The TTL will reclaim the slot.
      }
    };
  }
}
