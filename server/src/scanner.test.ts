import { describe, expect, it } from "vitest";
import { luhn, scanText } from "./scanner";

describe("scanText", () => {
  it("finds an email", () => {
    const f = scanText("contact jane.doe@example.com today");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: "email", text: "jane.doe@example.com", confidence: "high" });
  });

  it("accepts a Luhn-valid card and rejects an invalid one", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(scanText("card 4111 1111 1111 1111")[0]).toMatchObject({ type: "card" });
    expect(scanText("card 4111 1111 1111 1112").map((f) => f.type)).not.toContain("card");
  });

  it("finds API keys and SSN-shaped ids", () => {
    const types = scanText("AKIAIOSFODNN7EXAMPLE and 123-45-6789").map((f) => f.type);
    expect(types).toEqual(["api_key", "national_id"]);
  });

  it("marks bare 9-digit numbers and phones as ambiguous", () => {
    expect(scanText("id 123456789")[0]).toMatchObject({ type: "national_id", confidence: "ambiguous" });
    expect(scanText("call 555-123-4567")[0]).toMatchObject({ type: "phone", confidence: "ambiguous" });
  });

  it("does not report overlapping findings", () => {
    const f = scanText("4111-1111-1111-1111");
    expect(f).toHaveLength(1);
  });

  it("stays fast on adversarial input", () => {
    const start = Date.now();
    scanText("1".repeat(50_000) + " " + "a".repeat(50_000));
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
