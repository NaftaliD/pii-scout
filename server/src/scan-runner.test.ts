import { describe, expect, it } from "vitest";
import { sleep } from "./async";
import { runScan, scanInline } from "./scan-runner";

const text = "mail a@b.com ref 987654321 id 123-45-6789";

/** Runs `work` while a 10ms timer ticks, and returns the longest gap between ticks. */
async function maxTickGap(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let max = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
  }, 10);
  await sleep(30); // let the timer settle
  last = performance.now();
  await work();
  await sleep(30);
  clearInterval(timer);
  return max;
}

describe("runScan", () => {
  it("gives the same findings inline and in a worker", async () => {
    const inline = await runScan(text, { workerMinChars: Infinity });
    const worker = await runScan(text, { workerMinChars: 0 });
    expect(worker).toEqual(inline);
    expect(inline).toEqual(scanInline(text));
  });

  it("BLOCKS the event loop when the scan runs inline", async () => {
    const gap = await maxTickGap(() => runScan(text, { cpuBurnMs: 300, workerMinChars: Infinity }));
    expect(gap).toBeGreaterThan(250);
  });

  it("keeps the event loop FREE when the scan runs in a worker", async () => {
    const gap = await maxTickGap(() => runScan(text, { cpuBurnMs: 300, workerMinChars: 0 }));
    expect(gap).toBeLessThan(150);
  });

  it("terminates the worker when aborted, even mid-CPU-burn", async () => {
    const ac = new AbortController();
    const t0 = performance.now();
    const p = runScan(text, { cpuBurnMs: 5000, workerMinChars: 0, signal: ac.signal });
    setTimeout(() => ac.abort(new Error("cancelled")), 100);
    await expect(p).rejects.toThrow("cancelled");
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
