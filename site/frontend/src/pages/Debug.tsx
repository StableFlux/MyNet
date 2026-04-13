import { useState, useEffect, useRef } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import api from '../lib/api'

// Capture errors before the component mounts
const capturedErrors: string[] = []
const _origError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  _origError(...args)
  capturedErrors.push(`[${new Date().toISOString()}] ${args.map(String).join(' ')}`)
  if (capturedErrors.length > 50) capturedErrors.shift()
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{
        fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 2,
        margin: '0 0 10px 0', borderBottom: '1px solid #1e293b', paddingBottom: 6,
      }}>{title}</h2>
      {children}
    </div>
  )
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    const fallback = () => {
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback)
    } else {
      fallback()
    }
    setDone(true)
    setTimeout(() => setDone(false), 2000)
  }
  return (
    <button onClick={copy} style={{
      padding: '6px 14px', background: done ? '#16a34a' : '#4f46e5',
      color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    }}>
      {done ? '✓ Copied' : label}
    </button>
  )
}

export default function Debug() {
  const qc = useQueryClient()
  const [errors, setErrors] = useState<string[]>([...capturedErrors])
  const [wsEvents, setWsEvents] = useState<string[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  // Sync error list periodically
  useEffect(() => {
    const t = setInterval(() => setErrors([...capturedErrors]), 2000)
    return () => clearInterval(t)
  }, [])

  // Global unhandled error capture
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      capturedErrors.push(`[${new Date().toISOString()}] UNCAUGHT: ${e.message} @ ${e.filename}:${e.lineno}`)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      capturedErrors.push(`[${new Date().toISOString()}] UNHANDLED REJECTION: ${e.reason}`)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  // Monitor WebSocket messages
  useEffect(() => {
    const wsUrl = (import.meta.env.VITE_WS_URL as string | undefined) || `ws://${window.location.host}/ws`
    // Don't create a competing WS connection — just count messages on the existing one
    // We attach a passive listener to window message events for debug purposes
    const counts: Record<string, number> = {}
    const onStorage = () => {} // placeholder

    // Patch: intercept native WebSocket to count messages
    const OrigWS = window.WebSocket
    let patchedWs: WebSocket | null = null
    try {
      patchedWs = new OrigWS(wsUrl)
      patchedWs.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data as string)
          counts[d.type] = (counts[d.type] || 0) + 1
          setWsEvents([...Object.entries(counts).map(([k, v]) => `${k}: ${v} messages`)])
        } catch { /* ignore */ }
      }
      patchedWs.onerror = () => {}
      wsRef.current = patchedWs
    } catch { /* no WS available */ }

    return () => { patchedWs?.close() }
  }, [])

  // Auto-refresh cache view every 5s
  useEffect(() => {
    const t = setInterval(() => setRefreshKey(k => k + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const { data: backendDebug, error: backendError, isFetching } = useQuery({
    queryKey: ['__debug__'],
    queryFn: async () => { const { data } = await api.get('/debug'); return data },
    refetchInterval: 15_000,
    retry: false,
  })

  // React Query cache snapshot
  const cacheEntries = qc.getQueryCache().getAll()
    .filter(q => q.queryKey[0] !== '__debug__')
    .map(q => ({
      key: JSON.stringify(q.queryKey),
      status: q.state.status,
      fetchStatus: q.state.fetchStatus,
      updatedAt: q.state.dataUpdatedAt ? new Date(q.state.dataUpdatedAt).toISOString().slice(11, 23) : '—',
      errorCount: q.state.errorUpdateCount,
      error: q.state.error ? String(q.state.error) : null,
      dataKb: q.state.data ? Math.round(JSON.stringify(q.state.data).length / 1024 * 10) / 10 : 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  // Browser memory
  const mem = (performance as any).memory
  const memInfo = mem
    ? { used: Math.round(mem.usedJSHeapSize / 1048576), total: Math.round(mem.totalJSHeapSize / 1048576), limit: Math.round(mem.jsHeapSizeLimit / 1048576) }
    : null

  const buildFullReport = () => {
    const lines: string[] = [
      '========================================',
      '  MyNet Debug Report',
      `  ${new Date().toISOString()}`,
      '========================================',
      '',
      '--- BACKEND ---',
      backendError ? `ERROR fetching /api/debug: ${backendError}` : JSON.stringify(backendDebug, null, 2),
      '',
      '--- REACT QUERY CACHE ---',
      cacheEntries.map(e =>
        `${e.key}\n  status=${e.status} fetch=${e.fetchStatus} updated=${e.updatedAt} size=${e.dataKb}kb errors=${e.errorCount}${e.error ? `\n  ERROR: ${e.error}` : ''}`
      ).join('\n'),
      '',
      '--- BROWSER MEMORY ---',
      memInfo ? `Used: ${memInfo.used}MB  Total: ${memInfo.total}MB  Limit: ${memInfo.limit}MB` : 'Not available (Chrome/Edge only)',
      '',
      '--- WEBSOCKET MESSAGES (this tab) ---',
      wsEvents.length ? wsEvents.join('\n') : 'No messages captured yet',
      '',
      '--- CONSOLE ERRORS ---',
      errors.length ? errors.join('\n') : 'None captured',
      '',
      '========================================',
    ]
    return lines.join('\n')
  }

  const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12 }
  const row: React.CSSProperties = { display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid #1e293b', alignItems: 'baseline' }
  const dim: React.CSSProperties = { color: '#475569', fontSize: 11 }
  const bad: React.CSSProperties = { color: '#f87171' }
  const good: React.CSSProperties = { color: '#34d399' }
  const warn: React.CSSProperties = { color: '#fbbf24' }

  return (
    <div style={{ ...mono, padding: 20, color: '#cbd5e1', background: '#0f172a', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>MyNet Diagnostics</div>
          <div style={dim}>Auto-refreshes every 15s — or copy all and paste for support</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <CopyBtn text={buildFullReport()} label="Copy full report" />
          <CopyBtn text={JSON.stringify(backendDebug, null, 2)} label="Copy backend JSON" />
        </div>
      </div>

      {/* Backend */}
      <Section title={`Backend ${isFetching ? '(fetching…)' : ''}`}>
        {backendError ? (
          <div style={bad}>Cannot reach /api/debug — backend may be down or restarting.<br />{String(backendError)}</div>
        ) : backendDebug ? (
          <>
            {/* Scheduler */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...dim, marginBottom: 4 }}>SCHEDULER</div>
              <div style={row}>
                <span style={{ width: 120 }}>Running</span>
                <span style={backendDebug.scheduler?.running ? good : bad}>
                  {String(backendDebug.scheduler?.running)}
                </span>
              </div>
              {(backendDebug.scheduler?.jobs ?? []).map((j: any) => (
                <div key={j.id} style={row}>
                  <span style={{ width: 200 }}>{j.id}</span>
                  <span style={dim}>next: {j.next_run_time?.slice(11, 19) ?? 'paused'}</span>
                  <span style={{ ...dim, marginLeft: 8 }}>{j.trigger}</span>
                </div>
              ))}
            </div>

            {/* Monitoring cache */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...dim, marginBottom: 4 }}>MONITORING CACHE</div>
              {Object.entries(backendDebug.monitoring_cache ?? {}).map(([k, v]) => (
                <div key={k} style={row}>
                  <span style={{ width: 220 }}>{k}</span>
                  <span style={
                    k === 'seconds_since_last_ping' && Number(v) > 120 ? warn :
                    k === 'seconds_since_last_ping' && Number(v) > 300 ? bad : {}
                  }>{String(v ?? '—')}</span>
                </div>
              ))}
            </div>

            {/* Database */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...dim, marginBottom: 4 }}>DATABASE</div>
              {Object.entries(backendDebug.database ?? {}).map(([k, v]) => (
                <div key={k} style={row}>
                  <span style={{ width: 220 }}>{k}</span>
                  <span style={
                    k === 'seconds_since_last_result' && Number(v) > 120 ? warn :
                    k === 'seconds_since_last_result' && Number(v) > 300 ? bad : {}
                  }>{String(v ?? '—')}</span>
                </div>
              ))}
            </div>

            {/* System */}
            <div>
              <div style={{ ...dim, marginBottom: 4 }}>SYSTEM</div>
              {Object.entries(backendDebug.system ?? {}).map(([k, v]) => (
                <div key={k} style={row}>
                  <span style={{ width: 220 }}>{k}</span>
                  <span style={
                    (k === 'memory_percent' || k === 'cpu_percent_1s') && Number(v) > 85 ? bad :
                    (k === 'memory_percent' || k === 'cpu_percent_1s') && Number(v) > 70 ? warn : {}
                  }>{JSON.stringify(v)}</span>
                </div>
              ))}
              <div style={row}><span style={{ width: 220 }}>python</span><span style={dim}>{backendDebug.python}</span></div>
              <div style={row}><span style={{ width: 220 }}>platform</span><span style={dim}>{backendDebug.platform}</span></div>
            </div>
          </>
        ) : (
          <div style={dim}>Loading…</div>
        )}
      </Section>

      {/* React Query cache */}
      <Section title={`React Query Cache (${cacheEntries.length} entries, refreshes every 5s)`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: '#475569', textAlign: 'left' }}>
              <th style={{ padding: '3px 6px' }}>Query key</th>
              <th style={{ padding: '3px 6px' }}>Status</th>
              <th style={{ padding: '3px 6px' }}>Last updated</th>
              <th style={{ padding: '3px 6px' }}>Size</th>
              <th style={{ padding: '3px 6px' }}>Errors</th>
            </tr>
          </thead>
          <tbody>
            {cacheEntries.map((e, i) => (
              <tr key={`${e.key}-${i}`} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '3px 6px', color: e.error ? '#f87171' : '#94a3b8', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.key}</td>
                <td style={{ padding: '3px 6px', color: e.status === 'error' ? '#f87171' : e.fetchStatus === 'fetching' ? '#fbbf24' : '#34d399' }}>
                  {e.status}/{e.fetchStatus}
                </td>
                <td style={{ padding: '3px 6px', color: '#64748b' }}>{e.updatedAt}</td>
                <td style={{ padding: '3px 6px', color: e.dataKb > 500 ? '#fbbf24' : '#64748b' }}>{e.dataKb > 0 ? `${e.dataKb}kb` : '—'}</td>
                <td style={{ padding: '3px 6px', color: e.errorCount > 0 ? '#f87171' : '#64748b' }}>{e.errorCount || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Browser memory */}
      <Section title="Browser Memory">
        {memInfo ? (
          <div>
            <span style={memInfo.used > 300 ? bad : memInfo.used > 150 ? warn : good}>
              Used: {memInfo.used}MB
            </span>
            <span style={dim}> / Total: {memInfo.total}MB / Limit: {memInfo.limit}MB</span>
          </div>
        ) : (
          <div style={dim}>Not available — only exposed in Chromium-based browsers (Edge, Chrome)</div>
        )}
      </Section>

      {/* WebSocket */}
      <Section title="WebSocket (this debug tab's connection)">
        {wsEvents.length === 0
          ? <div style={dim}>Waiting for messages…</div>
          : wsEvents.map((e, i) => <div key={i} style={{ color: '#94a3b8' }}>{e}</div>)
        }
      </Section>

      {/* Console errors */}
      <Section title={`Console Errors (${errors.length})`}>
        {errors.length === 0 ? (
          <div style={good}>None captured since page load</div>
        ) : (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {errors.map((e, i) => (
              <div key={i} style={{ ...bad, marginBottom: 4, wordBreak: 'break-all', fontSize: 11 }}>{e}</div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
