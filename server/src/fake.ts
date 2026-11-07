import { sleep } from "./async";
import type { Classifier, Review } from "./review";

export interface FakeOptions {
  minMs?: number;
  maxMs?: number;
  /** 0..1 probability that a call throws a transient error. */
  failureRate?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

const SENSITIVE_REASONS = [
  "Format matches a government-style identifier.",
  "Context suggests a personal contact number.",
  "Looks like a value tied to one individual.",
];
const BENIGN_REASONS = [
  "Looks like an order or reference number.",
  "Context suggests a timestamp or counter.",
  "No personal context around the value.",
];

/** A stand-in for a real LLM: random latency, random answers, random transient failures. Costs nothing. */
export function createFakeClassifier(opts: FakeOptions = {}): Classifier {
  const { minMs = 300, maxMs = 2500, failureRate = 0.2, random = Math.random } = opts;
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  return async (_req, signal): Promise<Review> => {
    await sleep(minMs + random() * (maxMs - minMs), signal);
    if (random() < failureRate) throw new Error("fake provider: transient failure");
    return random() < 0.5
      ? { label: "sensitive", reason: pick(SENSITIVE_REASONS) }
      : { label: "not_sensitive", reason: pick(BENIGN_REASONS) };
  };
}
