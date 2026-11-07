import { createApp } from "./app";
import { createFakeClassifier } from "./fake";
import { CircuitBreaker, SpendBudget, guardClassifier } from "./guards";
import { createAnthropicClassifier } from "./llm";

const port = Number(process.env.PORT) || 3000;
const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== undefined && process.env[name] !== "" ? n : fallback;
};

// LLM_MODE=fake (default) uses the free dummy classifier; LLM_MODE=anthropic needs LLM_API_KEY.
const mode = process.env.LLM_MODE ?? "fake";
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

createApp({
  classifier,
  llmStatus: () => ({ mode, budget: { spent: budget.spent, limit: budget.limit }, breaker: breaker.state }),
}).listen(port, "0.0.0.0", () => {
  console.log(`scanner listening on 0.0.0.0:${port} (llm mode: ${mode})`);
});
