import type { Response } from "express";

export interface SseStream {
  send(event: string, data: unknown): void;
  end(): void;
}

const HEARTBEAT_MS = 15_000;

/** Turns a response into a Server-Sent Events stream. Safe to call after the client has gone away. */
export function openSse(res: Response, heartbeatMs = HEARTBEAT_MS): SseStream {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // ask nginx-style proxies not to buffer the stream
  });
  res.flushHeaders();
  res.socket?.setNoDelay(true); // don't let Nagle's algorithm hold small writes back

  const alive = () => !res.writableEnded && !res.destroyed;
  // A comment line (starts with ':') is ignored by SSE parsers but keeps idle connections open.
  const heartbeat = setInterval(() => alive() && res.write(": ping\n\n"), heartbeatMs);
  res.on("close", () => clearInterval(heartbeat));

  return {
    send(event, data) {
      if (alive()) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (alive()) res.end();
    },
  };
}
