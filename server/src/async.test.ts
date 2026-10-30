import { describe, expect, it } from "vitest";
import { mapLimit, retry, sleep } from "./async";

describe("mapLimit", () => {
  it("never exceeds the limit and keeps order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it("stops starting new work once aborted", async () => {
    const ac = new AbortController();
    let started = 0;
    const p = mapLimit(
      [1, 2, 3, 4],
      1,
      async () => {
        started++;
        ac.abort(new Error("cancelled"));
      },
      ac.signal,
    );
    await expect(p).rejects.toThrow("cancelled");
    expect(started).toBe(1);
  });
});

describe("retry", () => {
  it("retries then succeeds", async () => {
    let calls = 0;
    const v = await retry(
      async () => {
        if (++calls < 3) throw new Error("flaky");
        return "ok";
      },
      { retries: 3, baseMs: 1 },
    );
    expect(v).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the retry budget", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error("down");
        },
        { retries: 2, baseMs: 1 },
      ),
    ).rejects.toThrow("down");
    expect(calls).toBe(3);
  });

  it("does not retry when shouldRetry says no", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error("bad request");
        },
        { retries: 5, baseMs: 1, shouldRetry: () => false },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
