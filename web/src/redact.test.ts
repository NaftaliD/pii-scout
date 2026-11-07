import { describe, expect, it } from 'vitest'
import { redact } from './redact'
import type { Finding } from './types'

const f = (type: Finding['type'], text: string, start: number, extra: Partial<Finding> = {}): Finding => ({
  type,
  text,
  start,
  end: start + text.length,
  confidence: 'high',
  ...extra,
})

describe('redact', () => {
  const text = 'mail a@b.com or call 555-123-4567.'

  it('replaces each finding with its placeholder and keeps the rest', () => {
    const out = redact(text, [f('email', 'a@b.com', 5), f('phone', '555-123-4567', 21)])
    expect(out).toBe('mail [EMAIL] or call [PHONE].')
  })

  it('returns the text unchanged when there are no findings', () => {
    expect(redact(text, [])).toBe(text)
  })

  it('keeps findings the reviewer cleared, but redacts unreviewed ambiguous ones', () => {
    const cleared = f('phone', '555-123-4567', 21, {
      confidence: 'ambiguous',
      review: { label: 'not_sensitive', reason: 'order number' },
    })
    expect(redact(text, [f('email', 'a@b.com', 5), cleared])).toBe('mail [EMAIL] or call 555-123-4567.')
    const unreviewed = { ...cleared, review: undefined }
    expect(redact(text, [unreviewed])).toBe('mail a@b.com or call [PHONE].')
  })

  it('uses the right placeholder for every type', () => {
    const t = 'aaaa bbbb cccc dddd eeee'
    const out = redact(t, [
      f('email', 'aaaa', 0),
      f('card', 'bbbb', 5),
      f('api_key', 'cccc', 10),
      f('national_id', 'dddd', 15),
      f('phone', 'eeee', 20),
    ])
    expect(out).toBe('[EMAIL] [CARD] [API_KEY] [ID] [PHONE]')
  })
})
