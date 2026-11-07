/** Busy-waits for `ms`. Stand-in for genuinely expensive CPU work; it never yields to the event loop. */
export function burnCpu(ms: number): void {
  if (ms <= 0) return;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // spin
  }
}
