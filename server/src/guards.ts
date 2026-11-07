import type { Classifier } from "./review";
import type { Budget } from "./stores";

/** Thrown when a safety guard refuses a call. Never retried: retrying would defeat the guard. */
export class HaltError extends Error {
  constructor(
    readonly code: "budget_exhausted" | "circuit_open",
    message: string,
  ) {
    super(message);
    this.name = "HaltError";
  }
}

/** A spend cap in abstract cost units. In-memory, so it resets on restart (no database by design). */
export class SpendBudget {
  private spentUnits = 0;

  constructor(readonly limit: number) {}

  status(): { spent: number; limit: number } {
    return { spent: this.spentUnits, limit: this.limit };
  }

  charge(units: number): void {
    if (this.spentUnits + units > this.limit) {
      throw new HaltError("budget_exhausted", "LLM spend limit reached");
    }
    this.spentUnits += units;
  }

  get spent(): number {
    return this.spentUnits;
  }
}

type BreakerState = "closed" | "open" | "half-open";

/**
 * Stops calling a failing dependency. closed -> (threshold consecutive failures) -> open
 * -> (after cooldownMs) -> half-open: exactly one probe call is allowed; success closes, failure re-opens.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probing = false;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): BreakerState {
    if (this.failures < this.threshold) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open" || (state === "half-open" && this.probing)) {
      throw new HaltError("circuit_open", "LLM provider temporarily disabled after repeated failures");
    }
    if (state === "half-open") this.probing = true;
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      // A guard refusing the call (e.g. budget) says nothing about provider health.
      if (!(err instanceof HaltError)) {
        this.failures++;
        if (this.failures >= this.threshold) this.openedAt = this.now();
      }
      throw err;
    } finally {
      this.probing = false;
    }
  }
}

export interface Guards {
  budget: Budget;
  breaker: CircuitBreaker;
  costPerCall: number;
}

/** Wraps a classifier so every attempt (including retries) is charged and breaker-checked. */
export function guardClassifier(classify: Classifier, g: Guards): Classifier {
  return (req, signal) =>
    g.breaker.run(async () => {
      await g.budget.charge(g.costPerCall);
      return classify(req, signal);
    });
}
