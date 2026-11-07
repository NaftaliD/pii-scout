import { toSegments } from './segments'
import type { Finding, FindingType } from './types'

export const PLACEHOLDERS: Record<FindingType, string> = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  card: '[CARD]',
  api_key: '[API_KEY]',
  national_id: '[ID]',
}

/**
 * Redact unless the reviewer explicitly cleared it. An unreviewed ambiguous match is still redacted:
 * for a redaction tool, over-redacting is the safe way to be wrong.
 */
export function shouldRedact(f: Finding): boolean {
  return f.review?.label !== 'not_sensitive'
}

/** Replaces each finding with its placeholder. Findings must be sorted and non-overlapping. */
export function redact(text: string, findings: Finding[]): string {
  return toSegments(text, findings.filter(shouldRedact))
    .map((s) => (s.finding ? PLACEHOLDERS[s.finding.type] : s.text))
    .join('')
}
