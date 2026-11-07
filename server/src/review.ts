import { mapLimit, retry } from "./async";
import { HaltError } from "./guards";
import type { Finding } from "./scanner";

export interface Review {
  label: "sensitive" | "not_sensitive";
  reason: string;
}

export interface ReviewRequest {
  type: Finding["type"];
  /** Surrounding text with the candidate shape-masked and other findings replaced by placeholders. */
  context: string;
}

export type Classifier = (req: ReviewRequest, signal?: AbortSignal) => Promise<Review>;

export type ReviewedFinding = Finding & {
  review?: Review;
  reviewError?: string;
  /** Set when a safety guard (budget / circuit breaker) skipped the review. */
  reviewHalt?: HaltError["code"];
};

export interface ReviewOptions {
  signal?: AbortSignal;
  retryBaseMs?: number;
  /** Called as soon as one finding's review settles, with its index in the findings array. */
  onReviewed?: (index: number, finding: ReviewedFinding) => void;
}

const CONTEXT_CHARS = 40;
const MAX_IN_FLIGHT = 4;

/** Digits become 9, letters become a/A; separators are kept. The real value never leaves the server. */
export function shapeMask(value: string): string {
  return value.replace(/\d/g, "9").replace(/[a-z]/g, "a").replace(/[A-Z]/g, "A");
}

export function buildContext(text: string, target: Finding, all: Finding[]): string {
  const from = Math.max(0, target.start - CONTEXT_CHARS);
  const to = Math.min(text.length, target.end + CONTEXT_CHARS);
  let out = "";
  let pos = from;
  for (const f of all) {
    if (f.end <= from || f.start >= to) continue;
    const s = Math.max(f.start, from);
    const e = Math.min(f.end, to);
    out += text.slice(pos, s);
    out += f === target ? `<<${shapeMask(text.slice(s, e))}>>` : `[${f.type.toUpperCase()}]`;
    pos = e;
  }
  return out + text.slice(pos, to);
}

/** Sends ambiguous findings to the classifier. A failed review never fails the scan. */
export async function reviewFindings(
  text: string,
  findings: Finding[],
  classify: Classifier,
  opts: ReviewOptions = {},
): Promise<ReviewedFinding[]> {
  const out: ReviewedFinding[] = findings.map((f) => ({ ...f }));
  const todo = out.map((f, index) => ({ f, index })).filter(({ f }) => f.confidence === "ambiguous");
  await mapLimit(
    todo,
    MAX_IN_FLIGHT,
    async ({ f, index }) => {
      const req: ReviewRequest = { type: f.type, context: buildContext(text, f, findings) };
      try {
        f.review = await retry(() => classify(req, opts.signal), {
          retries: 2,
          baseMs: opts.retryBaseMs ?? 500,
          signal: opts.signal,
          // A guard refusing the call is a decision, not a glitch: retrying would defeat it.
          shouldRetry: (err) => !(err instanceof HaltError),
        });
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (err instanceof HaltError) {
          f.reviewHalt = err.code;
          f.reviewError = err.message;
        } else {
          f.reviewError = "Review unavailable";
        }
      }
      opts.onReviewed?.(index, f);
    },
    opts.signal,
  );
  return out;
}
