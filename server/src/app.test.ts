import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let base: string;

beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const post = (body: unknown, raw = false) =>
  fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("GET /health", () => {
  it("returns 200", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});

describe("POST /api/scan", () => {
  it("returns findings", async () => {
    const res = await post({ text: "mail me at a@b.com" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings[0]).toMatchObject({ type: "email", text: "a@b.com" });
  });

  it("rejects invalid input", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ text: "" })).status).toBe(400);
    expect((await post({ text: 5 })).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    expect((await post("{nope", true)).status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    expect((await post({ text: "a".repeat(300_000) })).status).toBe(413);
  });
});
