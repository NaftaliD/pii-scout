import type { Finding, FindingType } from "./scanner";

export interface Expected {
  type: FindingType;
  text: string;
}

export interface Sample {
  id: string;
  text: string;
  /** Exactly the sensitive items a perfect scanner would report. */
  expected: Expected[];
}

export interface Metrics {
  /** True positives: flagged and really sensitive. */
  tp: number;
  /** False positives: flagged but harmless. */
  fp: number;
  /** False negatives: sensitive but missed. */
  fn: number;
  /** tp / (tp + fp): when we raise an alarm, how often is it right? null if nothing was flagged. */
  precision: number | null;
  /** tp / (tp + fn): how much of the real sensitive data do we catch? null if nothing was expected. */
  recall: number | null;
}

export interface Report {
  overall: Metrics;
  byType: Partial<Record<FindingType, Metrics>>;
  /** Precision by the rule's own confidence tier (recall is not defined per tier: a miss has no tier). */
  byConfidence: Record<Finding["confidence"], Pick<Metrics, "tp" | "fp" | "precision">>;
  misses: { sample: string; type: FindingType; text: string }[];
  falsePositives: { sample: string; type: FindingType; text: string; confidence: Finding["confidence"] }[];
}

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

function metrics(tp: number, fp: number, fn: number): Metrics {
  return { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
}

export function evaluate(samples: Sample[], scan: (text: string) => Finding[]): Report {
  const counts = new Map<FindingType, { tp: number; fp: number; fn: number }>();
  const tiers = { high: { tp: 0, fp: 0 }, ambiguous: { tp: 0, fp: 0 } };
  const misses: Report["misses"] = [];
  const falsePositives: Report["falsePositives"] = [];
  const bucket = (t: FindingType) => {
    let c = counts.get(t);
    if (!c) counts.set(t, (c = { tp: 0, fp: 0, fn: 0 }));
    return c;
  };

  for (const sample of samples) {
    // Each expected item can be matched by at most one finding.
    const unmatched = [...sample.expected];
    for (const f of scan(sample.text)) {
      const i = unmatched.findIndex((e) => e.type === f.type && e.text === f.text);
      if (i >= 0) {
        unmatched.splice(i, 1);
        bucket(f.type).tp++;
        tiers[f.confidence].tp++;
      } else {
        bucket(f.type).fp++;
        tiers[f.confidence].fp++;
        falsePositives.push({ sample: sample.id, type: f.type, text: f.text, confidence: f.confidence });
      }
    }
    for (const e of unmatched) {
      bucket(e.type).fn++;
      misses.push({ sample: sample.id, type: e.type, text: e.text });
    }
  }

  const byType: Report["byType"] = {};
  let tp = 0, fp = 0, fn = 0;
  for (const [type, c] of counts) {
    byType[type] = metrics(c.tp, c.fp, c.fn);
    tp += c.tp;
    fp += c.fp;
    fn += c.fn;
  }
  const tier = (t: { tp: number; fp: number }) => ({ ...t, precision: ratio(t.tp, t.tp + t.fp) });
  return {
    overall: metrics(tp, fp, fn),
    byType,
    byConfidence: { high: tier(tiers.high), ambiguous: tier(tiers.ambiguous) },
    misses,
    falsePositives,
  };
}
