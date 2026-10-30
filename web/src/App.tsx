import { useEffect, useMemo, useRef, useState } from 'react'
import { toSegments } from './segments'
import { TYPE_LABELS, type Finding, type FindingType } from './types'

const SAMPLE = `Hi team, please contact Jane Doe at jane.doe@example.com or 555-123-4567.
Card on file: 4111 1111 1111 1111 (test number).
Employee ID 123-45-6789, legacy ref 987654321.
Deploy key: AKIAIOSFODNN7EXAMPLE`

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; text: string; findings: Finding[] }

export default function App() {
  const [input, setInput] = useState(SAMPLE)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [hidden, setHidden] = useState<Set<FindingType>>(new Set())
  const controllerRef = useRef<AbortController | null>(null)

  // Abort any in-flight request on unmount.
  useEffect(() => () => controllerRef.current?.abort(), [])

  async function scan() {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus({ kind: 'loading' })
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: input }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const data = (await res.json()) as { findings: Finding[] }
      setStatus({ kind: 'done', text: input, findings: data.findings })
    } catch (err) {
      if (controller.signal.aborted) return
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong' })
    }
  }

  function cancel() {
    controllerRef.current?.abort()
    setStatus({ kind: 'idle' })
  }

  const counts = useMemo(() => {
    const c = new Map<FindingType, number>()
    if (status.kind === 'done') {
      for (const f of status.findings) c.set(f.type, (c.get(f.type) ?? 0) + 1)
    }
    return c
  }, [status])

  const visible = useMemo(
    () => (status.kind === 'done' ? status.findings.filter((f) => !hidden.has(f.type)) : []),
    [status, hidden],
  )

  function toggle(type: FindingType) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const loading = status.kind === 'loading'

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

      {status.kind === 'done' && (
        <section aria-live="polite">
          <h2>
            {status.findings.length === 0
              ? 'No sensitive data found'
              : `${status.findings.length} finding${status.findings.length === 1 ? '' : 's'}`}
          </h2>
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
                  className={`type-${s.finding.type} ${s.finding.confidence}`}
                  title={`${TYPE_LABELS[s.finding.type]}${s.finding.confidence === 'ambiguous' ? ' (needs review)' : ''}`}
                >
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </pre>
          <p className="legend">Dashed outline = ambiguous match, to be reviewed by the LLM step.</p>
        </section>
      )}
    </main>
  )
}
