/**
 * Persistent API timing capture.
 * Starts a PerformanceObserver at module load time so entries are collected
 * across all client-side navigations for the lifetime of the browser tab.
 *
 * Entries are backed by sessionStorage so they survive full page reloads
 * (e.g. navigating to /debug directly) while still being cleared when the
 * tab is closed.
 */

export interface ApiEntry {
  t: string        // HH:MM:SS.mmm
  url: string      // path without origin or /api prefix
  ms: number       // total duration ms
  kb: number       // transfer size kb (0 if cached/from SW)
  status: number   // HTTP status (0 if unavailable)
}

const MAX_ENTRIES = 500
const SESSION_KEY = 'mynet-api-timings'

// Load any entries persisted from earlier in this tab session
function _load(): ApiEntry[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function _save(entries: ApiEntry[]) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries))
  } catch {
    // sessionStorage quota exceeded — silently ignore
  }
}

const _entries: ApiEntry[] = _load()

function record(entry: PerformanceResourceTiming) {
  if (!entry.name.includes('/api/')) return
  if (entry.name.includes('/api/debug')) return   // exclude debug polling noise

  // Avoid duplicating entries already loaded from sessionStorage on reload
  const t = new Date().toISOString().slice(11, 23)
  const url = entry.name.replace(window.location.origin, '').replace(/^\/api/, '')
  const ms = Math.round(entry.duration)

  // On a fresh page load the browser replays resource entries from its own
  // buffer; skip any that look identical to the last entry to avoid exact
  // duplicates when the module restores from sessionStorage.
  const last = _entries[_entries.length - 1]
  if (last && last.url === url && last.ms === ms) return

  _entries.push({
    t,
    url,
    ms,
    kb: Math.round((entry as any).transferSize / 102.4) / 10,
    status: (entry as any).responseStatus ?? 0,
  })

  if (_entries.length > MAX_ENTRIES) _entries.shift()
  _save(_entries)
}

// Backfill anything already in the buffer before this module loaded.
// On a full reload these are the requests made during the current page load.
for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
  record(e)
}

// Observe all future resource entries
if ('PerformanceObserver' in window) {
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        record(e)
      }
    })
    obs.observe({ type: 'resource', buffered: false })

    // Prevent the browser's own buffer from overflowing and losing entries
    performance.setResourceTimingBufferSize(500)
  } catch {
    // PerformanceObserver not available — backfill above is the fallback
  }
}

export function getApiTimings(): ApiEntry[] {
  return [..._entries].reverse()
}

export function clearApiTimings() {
  _entries.length = 0
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}
