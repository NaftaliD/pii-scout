import { describe, expect, it } from 'vitest'
import { parseSse } from './sse'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out = []
  for await (const e of parseSse(stream)) out.push(e)
  return out
}

describe('parseSse', () => {
  it('parses events and ignores heartbeat comments', async () => {
    const events = await collect(streamOf(': ping\n\nevent: scan\ndata: {"a":1}\n\nevent: done\ndata: {}\n\n'))
    expect(events).toEqual([
      { event: 'scan', data: { a: 1 } },
      { event: 'done', data: {} },
    ])
  })

  it('reassembles events split across chunks', async () => {
    const events = await collect(streamOf('event: re', 'view\ndata: {"i"', ':2}\n', '\n'))
    expect(events).toEqual([{ event: 'review', data: { i: 2 } }])
  })
})
