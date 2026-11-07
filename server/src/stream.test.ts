import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { sleep } from "./async";
import type { Classifier } from "./review";

let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
});

function start(classifier: Classifier): string {
  server = createApp({ classifier }).listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const body = JSON.stringify({ text: "mail a@b.com ref 987654321 and 123456789" });
const headers = { "content-type": "application/json" };

/** Yields [event, data] pairs as they arrive. */
async function* events(res: Response) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (ev && data) yield [ev, JSON.parse(data)] as const;
    }
  }
}

describe("POST /api/scan/stream", () => {
  it("sends scan first, then a review per ambiguous finding, then done", async () => {
    const base = start(async () => ({ label: "sensitive", reason: "r" }));
    const res = await fetch(`${base}/api/scan/stream`, { method: "POST", headers, body });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const names: string[] = [];
    for await (const [name] of events(res)) names.push(name);
    expect(names).toEqual(["scan", "review", "review", "done"]);
  });

  it("delivers the scan event before slow reviews finish", async () => {
    const base = start(async (_r, signal) => {
      await sleep(200, signal);
      return { label: "sensitive", reason: "r" };
    });
    const t0 = Date.now();
    const ac = new AbortController();
    const res = await fetch(`${base}/api/scan/stream`, { method: "POST", headers, body, signal: ac.signal });
    const first = await events(res).next();
    expect(first.value?.[0]).toBe("scan");
    expect(Date.now() - t0).toBeLessThan(150);
    ac.abort();
  });

  it("aborts in-flight classifier calls when the client disconnects", async () => {
    let sawAbort = false;
    const base = start(async (_r, signal) => {
      signal?.addEventListener("abort", () => (sawAbort = true));
      await sleep(10_000, signal);
      return { label: "sensitive", reason: "r" };
    });
    const ac = new AbortController();
    const res = await fetch(`${base}/api/scan/stream`, { method: "POST", headers, body, signal: ac.signal });
    const first = await events(res).next();
    expect(first.value?.[0]).toBe("scan");
    ac.abort();
    for (let i = 0; i < 50 && !sawAbort; i++) await sleep(20);
    expect(sawAbort).toBe(true);
  });

  it("rejects invalid input with plain JSON before streaming starts", async () => {
    const base = start(async () => ({ label: "sensitive", reason: "r" }));
    const res = await fetch(`${base}/api/scan/stream`, { method: "POST", headers, body: "{}" });
    expect(res.status).toBe(400);
  });
});
