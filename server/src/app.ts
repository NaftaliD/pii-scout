import path from "node:path";
import express from "express";

export function createApp(): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  if (process.env.NODE_ENV === "production") {
    // server/dist/app.js -> ../../web/dist
    const webDist = path.resolve(__dirname, "../../web/dist");
    app.use(express.static(webDist));
  }

  return app;
}
