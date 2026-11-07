import { monitorEventLoopDelay } from "node:perf_hooks";
import { Redis } from "ioredis";
import { createApp } from "./app";
import { ConcurrencyLimiter, RateLimiter } from "./limits";
import { RedisBudget, RedisRateLimiter, RedisStreamSlots, warnOnce } from "./redis-stores";
import { DEFAULT_WORKER_MIN_CHARS } from "./scan-runner";
import { createFakeClassifier } from "./fake";
import { CircuitBreaker, SpendBudget, guardClassifier } from "./guards";
import { createAnthropicClassifier } from "./llm";

const port = Number(process.env.PORT) || 3000;
const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== undefined && process.env[name] !== "" ? n : fallback;
};

// LLM_MODE=fake (default) uses the free dummy classifier; LLM_MODE=anthropic needs LLM_API_KEY.
const mode = process.env.LLM_MODE || "fake";
const apiKey = process.env.LLM_API_KEY;
let provider;
if (mode === "anthropic") {
  if (!apiKey) throw new Error("LLM_MODE=anthropic requires LLM_API_KEY");
  provider = createAnthropicClassifier(apiKey);
} else {
  provider = createFakeClassifier({
    minMs: num("FAKE_MIN_MS", 300),
    maxMs: num("FAKE_MAX_MS", 2500),
    failureRate: num("FAKE_FAILURE_RATE", 0.2),
  });
}

// Shared state (rate limits, stream slots, spend) lives in Redis when REDIS_URL is set, else in this process.
// Fail fast instead of queueing commands while Redis is down: the stores decide whether to fail open or closed.
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      commandTimeout: 1000,
    })
  : undefined;
// Without a listener, an "error" event (e.g. Redis unreachable) would crash the process.
// ioredis retries every few hundred ms, so throttle the log line.
redis?.on("error", (err) => warnOnce(`redis: ${err.message}`));

const rateMax = num("RATE_LIMIT_PER_MIN", 20);
const streamsPerIp = num("MAX_STREAMS_PER_IP", 2);
const streamsTotal = num("MAX_STREAMS_TOTAL", 20);
const budgetLimit = num("LLM_BUDGET_UNITS", 20);

const rateLimiter = redis ? new RedisRateLimiter(redis, rateMax, 60_000) : new RateLimiter(rateMax, 60_000);
const streamLimiter = redis
  ? new RedisStreamSlots(redis, streamsPerIp, streamsTotal)
  : new ConcurrencyLimiter(streamsPerIp, streamsTotal);
const budget = redis ? new RedisBudget(redis, budgetLimit) : new SpendBudget(budgetLimit);

const breaker = new CircuitBreaker(num("BREAKER_THRESHOLD", 5), num("BREAKER_COOLDOWN_MS", 30_000));
const classifier = guardClassifier(provider, { budget, breaker, costPerCall: num("LLM_COST_PER_CALL", 1) });

// Event-loop delay histogram: how late timers fire. Large values mean something blocked the main thread.
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

createApp({
  classifier,
  rateLimiter,
  streamLimiter,
  // Render puts one proxy in front of the container; locally there is none.
  trustProxyHops: num("TRUST_PROXY_HOPS", process.env.NODE_ENV === "production" ? 1 : 0),
  scan: {
    cpuBurnMs: num("FAKE_SCAN_CPU_MS", 0),
    workerMinChars: num("WORKER_MIN_CHARS", DEFAULT_WORKER_MIN_CHARS),
  },
  runtimeStatus: () => {
    const status = {
      // Render sets RENDER_GIT_COMMIT, so /health shows which commit is actually live.
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7),
      store: redis ? `redis (${redis.status})` : "memory",
      eventLoopMaxDelayMs: Math.round(loop.max / 1e6),
      eventLoopP99DelayMs: Math.round(loop.percentile(99) / 1e6),
    };
    loop.reset(); // report the window since the last /health call
    return status;
  },
  llmStatus: async () => ({ mode, budget: await budget.status(), breaker: breaker.state }),
}).listen(port, "0.0.0.0", () => {
  console.log(`scanner listening on 0.0.0.0:${port} (llm mode: ${mode}, state store: ${redis ? "redis" : "memory"})`);
});
