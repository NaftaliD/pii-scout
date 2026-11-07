import path from "node:path";
import express from "express";
import { z } from "zod";
import { reviewFindings, type Classifier } from "./review";
import { runScan, type ScanOptions } from "./scan-runner";
import { openSse } from "./sse";
import type { MaybePromise, RateLimit, StreamSlots } from "./stores";

export const MAX_TEXT_LENGTH = 100_000;

const scanRequest = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export interface AppOptions {
  /** When absent, ambiguous findings are returned unreviewed. */
  classifier?: Classifier;
  /** Extra info for /health (e.g. budget and breaker state). */
  llmStatus?: () => MaybePromise<unknown>;
  /** Extra runtime info for /health (e.g. event-loop lag). */
  runtimeStatus?: () => MaybePromise<unknown>;
  scan?: Omit<ScanOptions, "signal">;
  /** Per-IP request limit for /api. */
  rateLimiter?: RateLimit;
  /** Caps simultaneous open streams, per IP and overall. */
  streamLimiter?: StreamSlots;
  /**
   * How many reverse-proxy hops to trust when reading the client IP from X-Forwarded-For.
   * 0 = none (use the socket address). Behind Render this must be 3 (see render.yaml), or every visitor shares one IP.
   */
  trustProxyHops?: number;
}

export function createApp(opts: AppOptions = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", opts.trustProxyHops ?? 0);

  // Before the body parser: a refused request should cost almost nothing.
  app.use("/api", async (req, res, next) => {
    const verdict = await opts.rateLimiter?.hit(req.ip ?? "unknown");
    if (verdict && !verdict.allowed) {
      res.set("Retry-After", String(Math.ceil(verdict.retryAfterMs / 1000)));
      res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
      return;
    }
    next();
  });

  // TEMPORARY diagnostic (remove after use): how this server sees the caller behind Render's proxies.
  app.get("/api/whoami", (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      xff: req.headers["x-forwarded-for"],
      cf: req.headers["cf-connecting-ip"],
    });
  });

  app.use(express.json({ limit: "200kb" }));

  app.get("/health", async (_req, res) => {
    res.status(200).json({ status: "ok", llm: await opts.llmStatus?.(), runtime: await opts.runtimeStatus?.() });
  });

  function parseBody(req: express.Request, res: express.Response): string | null {
    const parsed = scanRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      return null;
    }
    return parsed.data.text;
  }

  // Simple request/response version: waits for every review, then answers once.
  app.post("/api/scan", async (req, res) => {
    const text = parseBody(req, res);
    if (text === null) return;
    // Cancel the scan and any in-flight LLM calls if the client disconnects.
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      const findings = await runScan(text, { ...opts.scan, signal: ac.signal });
      if (!opts.classifier) {
        res.json({ findings });
        return;
      }
      res.json({ findings: await reviewFindings(text, findings, opts.classifier, { signal: ac.signal }) });
    } catch {
      if (!res.headersSent) res.status(499).end();
    }
  });

  // Streaming version: rule findings first, then one `review` event per ambiguous finding as it settles.
  app.post("/api/scan/stream", async (req, res) => {
    const text = parseBody(req, res);
    if (text === null) return;

    // `res` (not `req`) emits "close" when the client disconnects mid-stream. It also fires on normal end
    // and on errors, so it is the one place the stream slot is freed.
    // Registered BEFORE awaiting the limiter: with an async store the client can disconnect while we wait.
    const ac = new AbortController();
    let release: (() => MaybePromise<void>) | null = null;
    let closed = false;
    res.on("close", () => {
      closed = true;
      ac.abort();
      void release?.();
    });

    if (opts.streamLimiter) {
      release = await opts.streamLimiter.acquire(req.ip ?? "unknown");
      if (!release) {
        res.status(429).json({ error: "Too many scans in progress. Please wait for one to finish." });
        return;
      }
      if (closed) {
        // Gone while we were waiting: the close handler ran before we held a slot, so free it here.
        await release();
        return;
      }
    }
    const sse = openSse(res);

    try {
      const findings = await runScan(text, { ...opts.scan, signal: ac.signal });
      sse.send("scan", { findings });
      if (opts.classifier) {
        await reviewFindings(text, findings, opts.classifier, {
          signal: ac.signal,
          onReviewed: (index, f) =>
            sse.send("review", {
              index,
              review: f.review,
              reviewError: f.reviewError,
              reviewHalt: f.reviewHalt,
            }),
        });
      }
      sse.send("done", {});
    } catch {
      if (!ac.signal.aborted) sse.send("error", { message: "Scan failed" });
    } finally {
      sse.end();
    }
  });

  if (process.env.NODE_ENV === "production") {
    // server/dist/app.js -> ../../web/dist
    const webDist = path.resolve(__dirname, "../../web/dist");
    app.use(express.static(webDist));
  }

  // JSON parse errors and oversized bodies: respond with JSON, never echo input.
  app.use(
    (err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
      res.status(status).json({ error: status === 413 ? "Request too large" : "Bad request" });
    },
  );

  return app;
}
