import { useState, useEffect, useRef } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { getApiTimings, clearApiTimings } from '../lib/perfCapture'

// ── Error capture (module-level so it runs before first render) ───────────────
const capturedErrors: { t: string; msg: string }[] = []
const _origError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  _origError(...args)
  capturedErrors.push({ t: new Date().toISOString().slice(11, 23), msg: args.map(String).join(' ') })
  if (capturedErrors.length > 100) capturedErrors.shift()
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fallbackCopy(text: string) {
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 2, margin: '0 0 10px 0', borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>{title}</h2>
      {children}
    </div>
  )
}

function KV({ k, v, warn, bad }: { k: string; v: unknown; warn?: boolean; bad?: boolean }) {
  const color = bad ? '#f87171' : warn ? '#fbbf24' : '#94a3b8'
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid #0f172a', fontSize: 12 }}>
      <span style={{ width: 240, color: '#475569', flexShrink: 0 }}>{k}</span>
      <span style={{ color, wordBreak: 'break-all' }}>{JSON.stringify(v)}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Debug() {
  const qc = useQueryClient()
  const [errors, setErrors] = useState<typeof capturedErrors>([])
  const [longTasks, setLongTasks] = useState<{ duration: number; startTime: number }[]>([])
  const [wsStatus, setWsStatus] = useState<string>('connecting…')
  const [wsMsgCounts, setWsMsgCounts] = useState<Record<string, number>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const longTasksRef = useRef<typeof longTasks>([])

  // Sync captured errors every 2s
  useEffect(() => {
    const t = setInterval(() => setErrors([...capturedErrors]), 2000)
    return () => clearInterval(t)
  }, [])

  // Global unhandled errors
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      capturedErrors.push({ t: new Date().toISOString().slice(11, 23), msg: `UNCAUGHT: ${e.message} @ ${e.filename}:${e.lineno}` })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      capturedErrors.push({ t: new Date().toISOString().slice(11, 23), msg: `UNHANDLED REJECTION: ${String(e.reason)}` })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection) }
  }, [])

  // Long task detection (tasks >50ms that block the main thread)
  useEffect(() => {
    if (!('PerformanceObserver' in window)) return
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasksRef.current = [
            ...longTasksRef.current.slice(-29),
            { duration: Math.round(entry.duration), startTime: Math.round(entry.startTime) },
          ]
          setLongTasks([...longTasksRef.current])
        }
      })
      obs.observe({ entryTypes: ['longtask'] })
      return () => obs.disconnect()
    } catch { /* browser doesn't support longtask */ }
  }, [])

  // WebSocket monitor — connects with same auth mechanism as the app (cookie)
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${window.location.host}/ws`
    let ws: WebSocket
    const counts: Record<string, number> = {}
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl)
        ws.onopen = () => setWsStatus('connected')
        ws.onclose = (e) => setWsStatus(`closed (code ${e.code})`)
        ws.onerror = () => setWsStatus('error')
        ws.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data as string)
            counts[d.type] = (counts[d.type] || 0) + 1
            setWsMsgCounts({ ...counts })
          } catch { /* ignore */ }
        }
      } catch (err) {
        setWsStatus(`failed: ${err}`)
      }
    }
    connect()
    return () => { try { ws?.close() } catch { /* ignore */ } }
  }, [])

  // Auto-refresh cache view every 5s
  useEffect(() => {
    const t = setInterval(() => setRefreshKey(k => k + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const { data: backend, error: backendError, isFetching } = useQuery({
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
      dataKb: q.state.data ? Math.round(JSON.stringify(q.state.data).length / 102.4) / 10 : 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  // API timing from persistent capture (survives client-side navigation, up to 500 entries)
  const apiTimings = getApiTimings()

  // Browser memory (Chrome/Edge only)
  const mem = (performance as any).memory
  const memInfo = mem ? {
    used: Math.round(mem.usedJSHeapSize / 1048576),
    total: Math.round(mem.totalJSHeapSize / 1048576),
    limit: Math.round(mem.jsHeapSizeLimit / 1048576),
  } : null

  // Navigation timing
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const navInfo = nav ? {
    dom_content_loaded_ms: Math.round(nav.domContentLoadedEventEnd),
    load_ms: Math.round(nav.loadEventEnd),
    type: nav.type,
  } : null

  // ── Report builder ────────────────────────────────────────────────────────
  const buildReport = () => [
    '========================================',
    '  MyNet Debug Report',
    `  ${new Date().toISOString()}`,
    `  Page: ${window.location.pathname}`,
    `  UA: ${navigator.userAgent}`,
    '========================================',
    '',
    '--- BACKEND ---',
    backendError ? `ERROR: ${backendError}` : JSON.stringify(backend, null, 2),
    '',
    '--- REACT QUERY CACHE ---',
    cacheEntries.map(e =>
      `${e.key}\n  ${e.status}/${e.fetchStatus} updated=${e.updatedAt} size=${e.dataKb}kb errors=${e.errorCount}${e.error ? `\n  ERROR: ${e.error}` : ''}`
    ).join('\n'),
    '',
    `--- API TIMINGS (${apiTimings.length} requests captured, excl /debug) ---`,
    apiTimings.map(t => `[${t.t}] ${t.ms}ms  ${t.kb}kb  ${t.status || '?'}  ${t.url}`).join('\n'),
    '',
    '--- LONG TASKS (>50ms, blocks UI) ---',
    longTasks.length
      ? longTasks.map(t => `${t.duration}ms at ${t.startTime}ms`).join('\n')
      : 'None detected',
    '',
    '--- BROWSER MEMORY ---',
    memInfo ? `Used: ${memInfo.used}MB  Total: ${memInfo.total}MB  Limit: ${memInfo.limit}MB` : 'Not available',
    '',
    '--- PAGE LOAD TIMING ---',
    navInfo ? JSON.stringify(navInfo) : 'Not available',
    '',
    '--- WEBSOCKET ---',
    `Status: ${wsStatus}`,
    Object.entries(wsMsgCounts).map(([k, v]) => `${k}: ${v}`).join('\n') || 'No messages',
    '',
    '--- CONSOLE ERRORS ---',
    errors.length ? errors.map(e => `[${e.t}] ${e.msg}`).join('\n') : 'None',
    '',
    '========================================',
  ].join('\n')

  // ── Render ────────────────────────────────────────────────────────────────
  const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12 }

  return (
    <div style={{ ...mono, padding: 20, color: '#cbd5e1', background: '#0f172a', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>MyNet Diagnostics</div>
          <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
            Auto-refreshes every 15s · {new Date().toISOString().slice(11, 19)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <CopyBtn text={buildReport()} label="Copy full report" />
          <CopyBtn text={JSON.stringify(backend, null, 2)} label="Copy backend JSON" />
        </div>
      </div>

      {/* Backend */}
      <Section title={`Backend ${isFetching ? '(fetching…)' : ''}`}>
        {backendError ? (
          <div style={{ color: '#f87171', marginBottom: 12 }}>
            Cannot reach /api/debug — {String(backendError)}
          </div>
        ) : !backend ? (
          <div style={{ color: '#475569' }}>Loading…</div>
        ) : (
          <>
            {/* Scheduler */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Scheduler</div>
              {backend.scheduler?._error ? (
                <pre style={{ color: '#f87171', fontSize: 11 }}>{backend.scheduler._traceback}</pre>
              ) : (
                <>
                  <KV k="running" v={backend.scheduler?.running} bad={!backend.scheduler?.running} />
                  {(backend.scheduler?.jobs ?? []).map((j: any) => (
                    <KV key={j.id} k={j.id} v={`next: ${j.next_run_time?.slice(11, 19) ?? 'paused'} · ${j.trigger}`} warn={!j.next_run_time} />
                  ))}
                </>
              )}
            </div>

            {/* Monitoring cache */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Monitoring ping cache</div>
              {backend.monitoring_cache?._error ? (
                <pre style={{ color: '#f87171', fontSize: 11 }}>{backend.monitoring_cache._traceback}</pre>
              ) : Object.entries(backend.monitoring_cache ?? {}).map(([k, v]) => (
                <KV key={k} k={k} v={v}
                  warn={k === 'seconds_since_last_ping' && Number(v) > 90}
                  bad={k === 'seconds_since_last_ping' && Number(v) > 180}
                />
              ))}
            </div>

            {/* Database */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Database</div>
              {backend.database?._error ? (
                <pre style={{ color: '#f87171', fontSize: 11 }}>{backend.database._traceback}</pre>
              ) : Object.entries(backend.database ?? {}).map(([k, v]) => (
                <KV key={k} k={k} v={v}
                  warn={k === 'seconds_since_last_result' && Number(v) > 90}
                  bad={k === 'seconds_since_last_result' && Number(v) > 180}
                />
              ))}
            </div>

            {/* SQLite */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>SQLite</div>
              {backend.sqlite?._error ? (
                <pre style={{ color: '#f87171', fontSize: 11 }}>{backend.sqlite._traceback}</pre>
              ) : Object.entries(backend.sqlite ?? {}).map(([k, v]) => (
                <KV key={k} k={k} v={v} />
              ))}
            </div>

            {/* System */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>System</div>
              {backend.system?._error ? (
                <pre style={{ color: '#f87171', fontSize: 11 }}>{backend.system._traceback}</pre>
              ) : Object.entries(backend.system ?? {}).map(([k, v]) => (
                <KV key={k} k={k} v={v}
                  warn={(k === 'memory_percent' || k === 'cpu_percent_1s') && Number(v) > 70}
                  bad={(k === 'memory_percent' || k === 'cpu_percent_1s') && Number(v) > 85}
                />
              ))}
            </div>

            {/* Recent backend logs */}
            <div>
              <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Recent backend logs (WARNING+)
              </div>
              {backend.recent_logs?._error ? (
                <pre style={{ color: '#f87171', fontSize: 11 }}>{backend.recent_logs._traceback}</pre>
              ) : (backend.recent_logs ?? []).length === 0 ? (
                <div style={{ color: '#34d399', fontSize: 11 }}>No warnings or errors</div>
              ) : (
                <div style={{ maxHeight: 250, overflow: 'auto' }}>
                  {[...(backend.recent_logs ?? [])].reverse().map((entry: any, i: number) => (
                    <div key={i} style={{ color: entry.level === 'ERROR' || entry.level === 'CRITICAL' ? '#f87171' : '#fbbf24', fontSize: 11, marginBottom: 2, wordBreak: 'break-all' }}>
                      [{entry.t}] {entry.level} {entry.logger}: {entry.msg}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Section>

      {/* React Query Cache */}
      <Section title={`React Query Cache (${cacheEntries.length} entries)`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: '#475569', textAlign: 'left' }}>
              {['Query key', 'Status', 'Updated', 'Size', 'Errors'].map(h => (
                <th key={h} style={{ padding: '3px 8px', fontWeight: 'normal' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cacheEntries.map((e, i) => (
              <tr key={i}>
                <td style={{ padding: '3px 8px', color: e.error ? '#f87171' : '#94a3b8', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.key}</td>
                <td style={{ padding: '3px 8px', color: e.status === 'error' ? '#f87171' : e.fetchStatus === 'fetching' ? '#fbbf24' : '#34d399' }}>{e.status}/{e.fetchStatus}</td>
                <td style={{ padding: '3px 8px', color: '#64748b' }}>{e.updatedAt}</td>
                <td style={{ padding: '3px 8px', color: e.dataKb > 500 ? '#fbbf24' : '#64748b' }}>{e.dataKb > 0 ? `${e.dataKb}kb` : '—'}</td>
                <td style={{ padding: '3px 8px', color: e.errorCount > 0 ? '#f87171' : '#64748b' }}>{e.errorCount || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* API timings */}
      <Section title={`API Timings — ${apiTimings.length} requests captured this session (excl. /debug)`}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { clearApiTimings(); setRefreshKey(k => k + 1) }}
            style={{ fontSize: 11, padding: '3px 10px', background: '#1e293b', color: '#64748b', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer' }}>
            Clear timings
          </button>
          <span style={{ fontSize: 11, color: '#475569' }}>Timings persist across page reloads within this tab (stored in sessionStorage)</span>
        </div>
        {apiTimings.length === 0 ? (
          <div style={{ color: '#475569' }}>No API requests captured yet — navigate to other pages then return here. Timings survive page reloads.</div>
        ) : (
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: '#475569', textAlign: 'left', position: 'sticky', top: 0, background: '#0f172a' }}>
                  {['time', 'ms', 'size', 'status', 'endpoint'].map(h => <th key={h} style={{ padding: '2px 8px', fontWeight: 'normal' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {apiTimings.map((t, i) => (
                  <tr key={i}>
                    <td style={{ padding: '2px 8px', color: '#475569', width: 80 }}>{t.t}</td>
                    <td style={{ padding: '2px 8px', color: t.ms > 5000 ? '#f87171' : t.ms > 1000 ? '#fbbf24' : '#34d399', width: 55, fontWeight: t.ms > 1000 ? 700 : 'normal' }}>{t.ms}</td>
                    <td style={{ padding: '2px 8px', color: '#64748b', width: 55 }}>{t.kb > 0 ? `${t.kb}kb` : '—'}</td>
                    <td style={{ padding: '2px 8px', color: t.status >= 400 ? '#f87171' : '#64748b', width: 45 }}>{t.status || '—'}</td>
                    <td style={{ padding: '2px 8px', color: '#94a3b8' }}>{t.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Long tasks */}
      <Section title="Long Tasks >50ms (blocks UI thread — causes freezes)">
        {longTasks.length === 0 ? (
          <div style={{ color: '#34d399' }}>None detected since page load</div>
        ) : (
          longTasks.slice().reverse().map((t, i) => (
            <div key={i} style={{ color: t.duration > 200 ? '#f87171' : '#fbbf24', fontSize: 11, marginBottom: 2 }}>
              {t.duration}ms at {t.startTime}ms into page life
            </div>
          ))
        )}
      </Section>

      {/* WebSocket */}
      <Section title={`WebSocket — ${wsStatus}`}>
        {Object.keys(wsMsgCounts).length === 0 ? (
          <div style={{ color: '#475569' }}>No messages received yet</div>
        ) : Object.entries(wsMsgCounts).map(([k, v]) => (
          <div key={k} style={{ color: '#94a3b8', fontSize: 12 }}>{k}: {v} messages</div>
        ))}
      </Section>

      {/* Browser memory */}
      <Section title="Browser Memory">
        {memInfo ? (
          <div style={{ color: memInfo.used > 300 ? '#f87171' : memInfo.used > 150 ? '#fbbf24' : '#34d399', fontSize: 12 }}>
            Used: {memInfo.used}MB / Total: {memInfo.total}MB / Limit: {memInfo.limit}MB
          </div>
        ) : (
          <div style={{ color: '#475569' }}>Not available (Chrome/Edge only)</div>
        )}
        {navInfo && (
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>
            Page load: DOMContentLoaded {navInfo.dom_content_loaded_ms}ms · Load {navInfo.load_ms}ms · Type: {navInfo.type}
          </div>
        )}
        <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
          UA: {navigator.userAgent}
        </div>
      </Section>

      {/* Console errors */}
      <Section title={`Console Errors (${errors.length})`}>
        {errors.length === 0 ? (
          <div style={{ color: '#34d399' }}>None captured since page load</div>
        ) : (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {[...errors].reverse().map((e, i) => (
              <div key={i} style={{ color: '#f87171', fontSize: 11, marginBottom: 3, wordBreak: 'break-all' }}>
                [{e.t}] {e.msg}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
