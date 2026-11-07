import { useEffect, useMemo, useRef, useState } from 'react'
import { redact, shouldRedact } from './redact'
import { parseSse } from './sse'
import { toSegments } from './segments'
import { TYPE_LABELS, type Finding, type FindingType } from './types'

const SAMPLE = `Hi team, please contact Jane Doe at jane.doe@example.com or 555-123-4567.
Card on file: 4111 1111 1111 1111 (test number).
Employee ID 123-45-6789, legacy ref 987654321.
Deploy key: AKIAIOSFODNN7EXAMPLE`

function describe(f: Finding): string {
  const label = TYPE_LABELS[f.type]
  if (f.review) return `${label}: ${f.review.label === 'sensitive' ? 'sensitive' : 'not sensitive'} - ${f.review.reason}`
  if (f.reviewError) return `${label} (${f.reviewError})`
  return f.confidence === 'ambiguous' ? `${label} (needs review)` : label
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'results'; text: string; findings: Finding[]; running: boolean; cancelled: boolean }

interface ReviewEvent {
  index: number
  review?: Finding['review']
  reviewError?: string
  reviewHalt?: Finding['reviewHalt']
}

export default function App() {
  const [input, setInput] = useState(SAMPLE)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [hidden, setHidden] = useState<Set<FindingType>>(new Set())
  const [showRedacted, setShowRedacted] = useState(false)
  const [copied, setCopied] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  // Abort any in-flight request on unmount.
  useEffect(() => () => controllerRef.current?.abort(), [])

  async function scan() {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    // Ignore anything from a scan that has since been replaced or cancelled.
    const current = () => controllerRef.current === controller
    const scanned = input
    setStatus({ kind: 'loading' })
    setShowRedacted(false)
    try {
      const res = await fetch('/api/scan/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: scanned }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      for await (const { event, data } of parseSse(res.body)) {
        if (!current()) return
        if (event === 'scan') {
          const { findings } = data as { findings: Finding[] }
          setStatus({
            kind: 'results',
            text: scanned,
            findings,
            running: findings.some((f) => f.confidence === 'ambiguous'),
            cancelled: false,
          })
        } else if (event === 'review') {
          const r = data as ReviewEvent
          setStatus((prev) =>
            prev.kind !== 'results'
              ? prev
              : {
                  ...prev,
                  findings: prev.findings.map((f, i) =>
                    i === r.index
                      ? { ...f, review: r.review, reviewError: r.reviewError, reviewHalt: r.reviewHalt }
                      : f,
                  ),
                },
          )
        } else if (event === 'done') {
          setStatus((prev) => (prev.kind === 'results' ? { ...prev, running: false } : prev))
        } else if (event === 'error') {
          throw new Error('Scan failed on the server')
        }
      }
    } catch (err) {
      if (!current() || controller.signal.aborted) return
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong' })
    }
  }

  function cancel() {
    controllerRef.current?.abort()
    setStatus((prev) => (prev.kind === 'results' ? { ...prev, running: false, cancelled: true } : { kind: 'idle' }))
  }

  const counts = useMemo(() => {
    const c = new Map<FindingType, number>()
    if (status.kind === 'results') {
      for (const f of status.findings) c.set(f.type, (c.get(f.type) ?? 0) + 1)
    }
    return c
  }, [status])

  const visible = useMemo(
    () => (status.kind === 'results' ? status.findings.filter((f) => !hidden.has(f.type)) : []),
    [status, hidden],
  )

  // Visible findings act as the selection: unchecking a type keeps it in the output.
  const redactedCount = visible.filter(shouldRedact).length
  const redactedText = useMemo(
    () => (status.kind === 'results' ? redact(status.text, visible) : ''),
    [status, visible],
  )

  async function copyRedacted() {
    try {
      await navigator.clipboard.writeText(redactedText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be blocked (e.g. insecure context); the text stays selectable in the box.
    }
  }

  function toggle(type: FindingType) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const running = status.kind === 'loading' || (status.kind === 'results' && status.running)
  const loading = running
  const pending =
    status.kind === 'results'
      ? status.findings.filter((f) => f.confidence === 'ambiguous' && !f.review && !f.reviewError).length
      : 0
  const halted = status.kind === 'results' ? status.findings.find((f) => f.reviewHalt) : undefined

  return (
    <main className="page">
      <header>
        <h1>Sensitive Data Scanner</h1>
        <p className="notice">Demo only: use synthetic data. Do not paste real personal or secret data.</p>
      </header>

      <label htmlFor="input">Text to scan</label>
      <textarea
        id="input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={8}
        maxLength={100_000}
      />
      <div className="actions">
        <button onClick={scan} disabled={loading || input.trim() === ''}>
          {loading ? 'Scanning…' : 'Scan'}
        </button>
        {loading && (
          <button className="secondary" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>

      {status.kind === 'error' && (
        <p role="alert" className="error">
          {status.message}
        </p>
      )}

      {status.kind === 'results' && (
        <section aria-live="polite">
          <h2>
            {status.findings.length === 0
              ? 'No sensitive data found'
              : `${status.findings.length} finding${status.findings.length === 1 ? '' : 's'}`}
          </h2>
          {status.running && <p className="status">Reviewing ambiguous matches… {pending} left</p>}
          {status.cancelled && <p className="status">Cancelled. Showing partial results.</p>}
          {halted && (
            <p role="alert" className="error">
              Review stopped: {halted.reviewError}. Rule-based results are still shown.
            </p>
          )}
          <div className="filters">
            {[...counts].map(([type, n]) => (
              <label key={type} className={`chip type-${type}`}>
                <input type="checkbox" checked={!hidden.has(type)} onChange={() => toggle(type)} />
                {TYPE_LABELS[type]} ({n})
              </label>
            ))}
          </div>
          <pre className="result">
            {toSegments(status.text, visible).map((s, i) =>
              s.finding ? (
                <mark
                  key={i}
                  className={`type-${s.finding.type} ${s.finding.confidence} ${s.finding.review?.label ?? ''}`}
                  title={describe(s.finding)}
                >
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </pre>
          <div className="actions">
            <button
              onClick={() => setShowRedacted((s) => !s)}
              disabled={running || (redactedCount === 0 && !showRedacted)}
              title={running ? 'Wait for the review to finish' : undefined}
            >
              {showRedacted ? 'Hide redacted text' : `Redact ${redactedCount} item${redactedCount === 1 ? '' : 's'}`}
            </button>
          </div>
          {showRedacted && (
            <>
              <h3>Redacted text</h3>
              <pre className="result">{redactedText}</pre>
              <div className="actions">
                <button className="secondary" onClick={copyRedacted}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </>
          )}
          <p className="legend">Dashed outline = ambiguous, not reviewed. Solid outline = LLM says sensitive. Faded = LLM says not sensitive. Hover for the reason.</p>
        </section>
      )}
    </main>
  )
}
