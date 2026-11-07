import { describe, expect, it } from "vitest";
import { CircuitBreaker, HaltError, SpendBudget, guardClassifier } from "./guards";
import type { Classifier } from "./review";

const req = { type: "phone", context: "x" } as const;
const ok: Classifier = async () => ({ label: "sensitive", reason: "r" });
const boom: Classifier = async () => {
  throw new Error("down");
};

describe("SpendBudget", () => {
  it("refuses a charge that would exceed the limit", () => {
    const b = new SpendBudget(2);
    b.charge(1);
    b.charge(1);
    expect(() => b.charge(1)).toThrow(HaltError);
    expect(b.spent).toBe(2);
  });
});

describe("CircuitBreaker", () => {
  it("opens after the threshold, half-opens after cooldown, and closes on a good probe", async () => {
    let t = 0;
    const br = new CircuitBreaker(2, 1000, () => t);
    const fail = () => Promise.reject(new Error("x"));
    await expect(br.run(fail)).rejects.toThrow("x");
    await expect(br.run(fail)).rejects.toThrow("x");
    expect(br.state).toBe("open");
    await expect(br.run(async () => 1)).rejects.toBeInstanceOf(HaltError);
    t = 1000;
    expect(br.state).toBe("half-open");
    await expect(br.run(async () => 1)).resolves.toBe(1);
    expect(br.state).toBe("closed");
  });

  it("re-opens when the probe fails", async () => {
    let t = 0;
    const br = new CircuitBreaker(1, 1000, () => t);
    await expect(br.run(() => Promise.reject(new Error("x")))).rejects.toThrow();
    t = 1000;
    await expect(br.run(() => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(br.state).toBe("open");
  });
});

describe("guardClassifier", () => {
  it("stops calling the provider once the budget is spent, without tripping the breaker", async () => {
    let calls = 0;
    const counted: Classifier = async (...a) => (calls++, ok(...a));
    const breaker = new CircuitBreaker(2, 1000);
    const g = guardClassifier(counted, { budget: new SpendBudget(2), breaker, costPerCall: 1 });
    await g(req);
    await g(req);
    await expect(g(req)).rejects.toMatchObject({ code: "budget_exhausted" });
    await expect(g(req)).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(calls).toBe(2);
    expect(breaker.state).toBe("closed");
  });

  it("does not charge while the breaker is open", async () => {
    const budget = new SpendBudget(100);
    const g = guardClassifier(boom, { budget, breaker: new CircuitBreaker(2, 60_000), costPerCall: 1 });
    await expect(g(req)).rejects.toThrow("down");
    await expect(g(req)).rejects.toThrow("down");
    await expect(g(req)).rejects.toMatchObject({ code: "circuit_open" });
    expect(budget.spent).toBe(2);
  });
});
