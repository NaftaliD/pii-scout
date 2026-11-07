import path from "node:path";
import { Worker } from "node:worker_threads";
import { burnCpu } from "./cpu";
import { scanText, type Finding } from "./scanner";

export interface ScanOptions {
  /** Artificial CPU cost per scan, to make the event-loop effect visible. 0 in production. */
  cpuBurnMs?: number;
  /** Inputs at least this long are scanned in a worker thread. Spawning costs more than scanning short text. */
  workerMinChars?: number;
  signal?: AbortSignal;
}

export const DEFAULT_WORKER_MIN_CHARS = 20_000;

// Same file name, whichever extension we are running as (.ts under tsx/vitest, .js after tsc).
const WORKER_FILE = path.join(__dirname, "scan-worker" + path.extname(__filename));

/** Scans on the calling thread. While this runs, the event loop is blocked. */
export function scanInline(text: string, cpuBurnMs = 0): Finding[] {
  burnCpu(cpuBurnMs);
  return scanText(text);
}

/** Scans in a worker thread. The main thread stays free; aborting terminates the worker. */
export function scanInWorker(text: string, cpuBurnMs = 0, signal?: AbortSignal): Promise<Finding[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const worker = new Worker(WORKER_FILE, { workerData: { text, burnMs: cpuBurnMs } });
    const onAbort = () => void worker.terminate();
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (findings: Finding[]) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(findings);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      signal?.removeEventListener("abort", onAbort);
      // terminate() also surfaces as a non-zero exit; report the abort reason, not a crash.
      if (code !== 0) reject(signal?.aborted ? signal.reason : new Error(`scan worker exited with code ${code}`));
    });
  });
}

export async function runScan(text: string, opts: ScanOptions = {}): Promise<Finding[]> {
  const { cpuBurnMs = 0, workerMinChars = DEFAULT_WORKER_MIN_CHARS, signal } = opts;
  return text.length >= workerMinChars ? scanInWorker(text, cpuBurnMs, signal) : scanInline(text, cpuBurnMs);
}
