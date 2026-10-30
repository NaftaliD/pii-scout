import path from "node:path";
import express from "express";
import { z } from "zod";
import { reviewFindings, type Classifier } from "./review";
import { scanText } from "./scanner";

export const MAX_TEXT_LENGTH = 100_000;

const scanRequest = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export interface AppOptions {
  /** When absent, ambiguous findings are returned unreviewed. */
  classifier?: Classifier;
}

export function createApp(opts: AppOptions = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/api/scan", async (req, res) => {
    const parsed = scanRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      return;
    }
    const { text } = parsed.data;
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
