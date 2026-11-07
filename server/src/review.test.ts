import { describe, expect, it } from "vitest";
import { buildContext, reviewFindings, shapeMask, type Classifier } from "./review";
import { scanText } from "./scanner";

const text = "mail a@b.com, ref 987654321 end";

describe("privacy masking", () => {
  it("shape-masks the candidate and placeholders other findings", () => {
    const findings = scanText(text);
    const target = findings.find((f) => f.confidence === "ambiguous")!;
    const ctx = buildContext(text, target, findings);
    expect(ctx).toContain("<<999999999>>");
    expect(ctx).toContain("[EMAIL]");
    expect(ctx).not.toContain("987654321");
    expect(ctx).not.toContain("a@b.com");
    expect(shapeMask("Ab-12")).toBe("Aa-99");
  });
});

describe("reviewFindings", () => {
  it("reviews only ambiguous findings and never sends raw values", async () => {
    const seen: string[] = [];
    const classify: Classifier = async (req) => {
      seen.push(req.context);
      return { label: "sensitive", reason: "looks like an id" };
    };
    const out = await reviewFindings(text, scanText(text), classify);
    expect(seen).toHaveLength(1);
    expect(out.find((f) => f.type === "email")!.review).toBeUndefined();
    expect(out.find((f) => f.confidence === "ambiguous")!.review?.label).toBe("sensitive");
  });

  it("keeps the scan result when the classifier keeps failing", async () => {
    let calls = 0;
    const classify: Classifier = async () => {
      calls++;
      throw new Error("provider down");
    };
    const out = await reviewFindings(text, scanText(text), classify, { retryBaseMs: 1 });
    expect(calls).toBe(3);
    expect(out.find((f) => f.confidence === "ambiguous")!.reviewError).toBe("Review unavailable");
  });
});

describe("reviewFindings with guards", () => {
  it("marks findings as halted without retrying, and reports each result as it settles", async () => {
    const { HaltError } = await import("./guards");
    let calls = 0;
    const classify: Classifier = async () => {
      calls++;
      throw new HaltError("budget_exhausted", "LLM spend limit reached");
    };
    const seen: number[] = [];
    const out = await reviewFindings(text, scanText(text), classify, {
      retryBaseMs: 1,
      onReviewed: (i) => seen.push(i),
    });
    expect(calls).toBe(1);
    const f = out.find((x) => x.confidence === "ambiguous")!;
    expect(f.reviewHalt).toBe("budget_exhausted");
    expect(seen).toHaveLength(1);
  });
});
