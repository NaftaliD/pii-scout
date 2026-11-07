import { monitorEventLoopDelay } from "node:perf_hooks";
import { createApp } from "./app";
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

const budget = new SpendBudget(num("LLM_BUDGET_UNITS", 20));
const breaker = new CircuitBreaker(num("BREAKER_THRESHOLD", 5), num("BREAKER_COOLDOWN_MS", 30_000));
const classifier = guardClassifier(provider, { budget, breaker, costPerCall: num("LLM_COST_PER_CALL", 1) });

// Event-loop delay histogram: how late timers fire. Large values mean something blocked the main thread.
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

createApp({
  classifier,
  scan: {
    cpuBurnMs: num("FAKE_SCAN_CPU_MS", 0),
    workerMinChars: num("WORKER_MIN_CHARS", DEFAULT_WORKER_MIN_CHARS),
  },
  runtimeStatus: () => {
    const status = { eventLoopMaxDelayMs: Math.round(loop.max / 1e6), eventLoopP99DelayMs: Math.round(loop.percentile(99) / 1e6) };
    loop.reset(); // report the window since the last /health call
    return status;
  },
  llmStatus: () => ({ mode, budget: { spent: budget.spent, limit: budget.limit }, breaker: breaker.state }),
}).listen(port, "0.0.0.0", () => {
  console.log(`scanner listening on 0.0.0.0:${port} (llm mode: ${mode})`);
});
