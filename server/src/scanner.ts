export type FindingType = "email" | "phone" | "card" | "api_key" | "national_id";

export interface Finding {
  type: FindingType;
  start: number;
  end: number;
  text: string;
  /** "high" = rule is confident; "ambiguous" = candidate for LLM review. */
  confidence: "high" | "ambiguous";
}

interface Rule {
  type: FindingType;
  pattern: RegExp;
  confidence: Finding["confidence"];
  /** Optional extra check on the matched text; return false to drop the match. */
  validate?: (text: string) => boolean;
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Patterns avoid nested quantifiers to stay safe from catastrophic backtracking.
const RULES: Rule[] = [
  {
    type: "email",
    pattern: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}/g,
    confidence: "high",
  },
  {
    type: "card",
    pattern: /\b\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}\b/g,
    confidence: "high",
    validate: (t) => {
      const digits = t.replace(/[ -]/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits);
    },
  },
  {
    type: "api_key",
    pattern: /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,})\b/g,
    confidence: "high",
  },
  {
    type: "national_id",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: "high",
  },
  {
    // Bare 9-digit numbers could be an ID or just a number.
    type: "national_id",
    pattern: /\b\d{9}\b/g,
    confidence: "ambiguous",
  },
  {
    type: "phone",
    pattern: /(?<![\w-])\+?\d{1,3}?[ .-]?\(?\d{2,4}\)?[ .-]\d{3,4}[ .-]\d{3,4}(?![\w-])/g,
    confidence: "ambiguous",
  },
];

const CONFIDENCE_RANK = { high: 1, ambiguous: 0 } as const;

export function scanText(text: string): Finding[] {
  const found: Finding[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      if (rule.validate && !rule.validate(m[0])) continue;
      found.push({
        type: rule.type,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        confidence: rule.confidence,
      });
    }
  }
  // Resolve overlaps: earlier start wins, then higher confidence, then longer.
  found.sort(
    (a, b) =>
      a.start - b.start ||
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      b.end - a.end,
  );
  const result: Finding[] = [];
  let lastEnd = -1;
  for (const f of found) {
    if (f.start >= lastEnd) {
      result.push(f);
      lastEnd = f.end;
    }
  }
  return result;
}
