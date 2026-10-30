import { describe, expect, it } from 'vitest'
import { toSegments } from './segments'
import type { Finding } from './types'

const f = (start: number, end: number, text: string): Finding => ({
  type: 'email',
  start,
  end,
  text,
  confidence: 'high',
})

describe('toSegments', () => {
  it('returns one plain segment when there are no findings', () => {
    expect(toSegments('hello', [])).toEqual([{ text: 'hello' }])
  })

  it('splits around findings', () => {
    const finding = f(3, 6, 'a@b')
    expect(toSegments('hi a@b!', [finding])).toEqual([
      { text: 'hi ' },
      { text: 'a@b', finding },
      { text: '!' },
    ])
  })
})
