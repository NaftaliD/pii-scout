// Runs inside a worker thread. Import paths carry .ts so Node can load this file directly.
import { parentPort, workerData } from "node:worker_threads";
import { burnCpu } from "./cpu.ts";
import { scanText } from "./scanner.ts";

const { text, burnMs } = workerData as { text: string; burnMs: number };
burnCpu(burnMs);
// postMessage structured-clones the array: the main thread gets a copy, not shared memory.
parentPort!.postMessage(scanText(text));
