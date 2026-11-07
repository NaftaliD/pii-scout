import path from "node:path";
import express from "express";
import { z } from "zod";
import { reviewFindings, type Classifier } from "./review";
import { scanText } from "./scanner";
import { openSse } from "./sse";

export const MAX_TEXT_LENGTH = 100_000;

const scanRequest = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export interface AppOptions {
  /** When absent, ambiguous findings are returned unreviewed. */
  classifier?: Classifier;
  /** Extra info for /health (e.g. budget and breaker state). */
  llmStatus?: () => unknown;
}

export function createApp(opts: AppOptions = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", llm: opts.llmStatus?.() });
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
    const findings = scanText(text);
    if (!opts.classifier) {
      res.json({ findings });
      return;
    }
    // Cancel in-flight LLM calls if the client disconnects.
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      res.json({ findings: await reviewFindings(text, findings, opts.classifier, { signal: ac.signal }) });
    } catch {
      if (!res.headersSent) res.status(499).end();
    }
  });

  // Streaming version: rule findings first, then one `review` event per ambiguous finding as it settles.
  app.post("/api/scan/stream", async (req, res) => {
    const text = parseBody(req, res);
    if (text === null) return;

    // `res` (not `req`) emits "close" when the client disconnects mid-stream.
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    const sse = openSse(res);

    try {
      const findings = scanText(text);
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
