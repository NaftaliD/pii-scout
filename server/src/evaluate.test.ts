import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, type Sample } from "./evaluate";
import { scanText, type Finding } from "./scanner";

const finding = (type: Finding["type"], text: string, confidence: Finding["confidence"] = "high"): Finding => ({
  type,
  text,
  confidence,
  start: 0,
  end: text.length,
});

describe("evaluate (metric math)", () => {
  const samples: Sample[] = [
    { id: "a", text: "x", expected: [{ type: "email", text: "e1" }, { type: "email", text: "e2" }] },
    { id: "b", text: "y", expected: [] },
  ];

  it("counts true positives, false positives and false negatives", () => {
    // finds e1 (right), misses e2, and wrongly flags "junk" in sample b
    const report = evaluate(samples, (t) =>
      t === "x" ? [finding("email", "e1")] : [finding("email", "junk", "ambiguous")],
    );
    expect(report.overall).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
    expect(report.misses).toEqual([{ sample: "a", type: "email", text: "e2" }]);
    expect(report.byConfidence.ambiguous).toMatchObject({ tp: 0, fp: 1, precision: 0 });
    expect(report.byConfidence.high).toMatchObject({ tp: 1, fp: 0, precision: 1 });
  });

  it("does not let one expected item be matched twice", () => {
    const report = evaluate([samples[0]], () => [finding("email", "e1"), finding("email", "e1")]);
    expect(report.overall).toMatchObject({ tp: 1, fp: 1, fn: 1 });
  });

  it("reports null instead of dividing by zero", () => {
    const report = evaluate([{ id: "c", text: "z", expected: [] }], () => []);
    expect(report.overall.precision).toBeNull();
    expect(report.overall.recall).toBeNull();
  });
});

describe("labeled sample set", () => {
  const samples: Sample[] = JSON.parse(readFileSync(path.join(__dirname, "../eval/samples.json"), "utf8"));

  it("has labels that actually appear in their text (guards against typos in the answer key)", () => {
    for (const s of samples) for (const e of s.expected) expect(s.text, s.id).toContain(e.text);
  });

  // Floors sit just under today's numbers. Raise them as the rules improve; a drop fails CI.
  it("keeps detection quality above the floor", () => {
    const r = evaluate(samples, scanText);
    expect(r.overall.precision!).toBeGreaterThanOrEqual(0.88);
    expect(r.overall.recall!).toBeGreaterThanOrEqual(0.85);
    expect(r.byType.phone?.precision ?? 0).toBeGreaterThanOrEqual(0.8);
    expect(r.byType.phone?.recall ?? 0).toBeGreaterThanOrEqual(0.75);
    expect(r.byConfidence.high.precision).toBe(1); // a "high" finding must never be wrong
    expect(r.byType.card?.recall).toBe(1);
    expect(r.byType.api_key?.recall).toBe(1);
  });
});
