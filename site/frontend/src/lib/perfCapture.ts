/**
 * Persistent API timing capture.
 * Starts a PerformanceObserver at module load time so entries are collected
 * across all client-side navigations for the lifetime of the browser tab.
 * The browser's built-in resource timing buffer is only 150 entries and can
 * overflow; this module keeps up to 500 in a plain array that never resets.
 */

export interface ApiEntry {
  t: string        // HH:MM:SS.mmm
  url: string      // path without origin or /api prefix
  ms: number       // total duration ms
  kb: number       // transfer size kb (0 if cached/from SW)
  status: number   // HTTP status (0 if unavailable)
}

const MAX_ENTRIES = 500
const _entries: ApiEntry[] = []

function record(entry: PerformanceResourceTiming) {
  if (!entry.name.includes('/api/')) return
  if (entry.name.includes('/api/debug')) return   // exclude debug polling noise

  _entries.push({
    t: new Date().toISOString().slice(11, 23),
    url: entry.name.replace(window.location.origin, '').replace(/^\/api/, ''),
    ms: Math.round(entry.duration),
    kb: Math.round((entry as any).transferSize / 102.4) / 10,
    status: (entry as any).responseStatus ?? 0,
  })

  if (_entries.length > MAX_ENTRIES) _entries.shift()
}

// Backfill anything already in the buffer before this module loaded
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
}
