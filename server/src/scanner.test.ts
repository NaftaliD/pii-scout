import { describe, expect, it } from "vitest";
import { isPhoneShaped, luhn, scanText } from "./scanner";

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

describe("phone rule (wide net + validator)", () => {
  const phones = (text: string) => scanText(text).filter((f) => f.type === "phone").map((f) => f.text);

  it("keeps the whole number, including an opening parenthesis", () => {
    expect(phones("Call (555) 123-4567 today")).toEqual(["(555) 123-4567"]);
    expect(phones("Dial +1 (555) 123-4567 now")).toEqual(["+1 (555) 123-4567"]);
    expect(phones("London +44 20 7946 0958")).toEqual(["+44 20 7946 0958"]);
  });

  it("does not report IP addresses, card-shaped numbers, dates or bare digit runs", () => {
    expect(phones("Server 192.168.100.200 is down")).toEqual([]);
    expect(phones("Tracking 4111 1111 1111 1112 delivered")).toEqual([]);
    expect(phones("Meeting on 2026-11-07 at 10:30")).toEqual([]);
    expect(phones("created at 1700000000")).toEqual([]);
  });

  it("still finds a number followed by punctuation, a dash aside or another number", () => {
    expect(phones("Call me on 555-123-4567. 2 pm works.")).toEqual(["555-123-4567"]);
    expect(phones("Ring 555-123-4567 - 3 rings")).toEqual(["555-123-4567"]);
    expect(phones("Call 555-123-4567, 555-987-6543")).toEqual(["555-123-4567", "555-987-6543"]);
  });
});

describe("isPhoneShaped", () => {
  it("applies each rejection rule", () => {
    expect(isPhoneShaped("555-123-4567")).toBe(true);
    expect(isPhoneShaped("5551234567")).toBe(false); // no separator
    expect(isPhoneShaped("555-1234")).toBe(false); // too few digits
    expect(isPhoneShaped("+1 555 123 4567 8901 2345")).toBe(false); // too many digits
    expect(isPhoneShaped("192.168.100.200")).toBe(false); // IPv4 shape
    expect(isPhoneShaped("2026-11-07")).toBe(false); // date shape
    expect(isPhoneShaped("4111 1111 1111 1111")).toBe(false); // Luhn-valid card length
  });
});
