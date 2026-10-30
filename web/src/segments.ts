import type { Finding } from './types'

export type Segment = { text: string; finding?: Finding }

/** Splits text into plain and highlighted pieces. Findings must be sorted and non-overlapping. */
export function toSegments(text: string, findings: Finding[]): Segment[] {
  const out: Segment[] = []
  let pos = 0
  for (const f of findings) {
    if (f.start < pos) continue
    if (f.start > pos) out.push({ text: text.slice(pos, f.start) })
    out.push({ text: text.slice(f.start, f.end), finding: f })
    pos = f.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}
