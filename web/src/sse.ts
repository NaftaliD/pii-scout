export interface SseEvent {
  event: string
  data: unknown
}

/**
 * Parses a Server-Sent Events byte stream into events.
 * `buffer` carries a partial event across chunk boundaries, because the network may split
 * the stream anywhere, including in the middle of a line or a multi-byte character.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = /^event: (.*)$/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (event && data) yield { event, data: JSON.parse(data) }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
