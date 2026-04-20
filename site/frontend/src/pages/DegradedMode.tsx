import { useState } from 'react'
import { AlertTriangle, RefreshCw, HardDrive, Loader } from 'lucide-react'
import api from '../lib/api'

interface SnapshotEntry {
  exists: boolean
  modified_at?: number
  size_bytes?: number
}

interface DegradedHealth {
  db_reachable: boolean
  db_integrity_ok?: boolean
  db_integrity_reason?: string
  platform_supported: boolean
  mode: string
  reason: string
  snapshots: {
    current: SnapshotEntry
    previous: SnapshotEntry
  }
}

function formatAgo(epoch?: number): string {
  if (!epoch) return 'never'
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

export default function DegradedMode({ health, onRetry }: { health: DegradedHealth; onRetry: () => void }) {
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const hasSnapshot = health.snapshots.current.exists || health.snapshots.previous.exists
  const latest = health.snapshots.current.exists ? health.snapshots.current : health.snapshots.previous
  // db_integrity_ok defaults to true when the field is absent (older /health
  // response shape). False means PRAGMA quick_check caught corruption at
  // startup — the DB file is there but its contents are bad, so the Right
  // Thing is to overwrite it from a known-good snapshot without changing
  // storage mode (which would be the wrong fix for a corrupt USB DB).
  const isCorrupt = health.db_integrity_ok === false

  const handleRetry = async () => {
    setRetrying(true)
    setRevertError('')
    try {
      // Recovery is async: the backend spawns a detached worker that stops
      // the service, cleans the stale mount, remounts, and restarts the
      // service. We poll /health until the DB is reachable again (or give
      // up after ~25s — enough for a normal restart plus some slack).
      await api.post('/storage/recover/remount')
      const start = Date.now()
      while (Date.now() - start < 25_000) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const { data } = await api.get('/storage/health')
          if (data.db_reachable) {
            // Back online — let the parent re-probe and clear degraded state
            onRetry()
            return
          }
        } catch { /* service still restarting, keep polling */ }
      }
      // Timed out — either the USB isn't actually available, or something
      // deeper is wrong. Tell the user and give them the escape hatch.
      setRevertError('Retry timed out. If the drive is definitely re-inserted, try Restore from snapshot instead.')
    } catch (err: any) {
      setRevertError(err?.response?.data?.detail ?? 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  const handleRevert = async () => {
    if (!confirm('Restore the latest snapshot to the SD card and restart MyNet in SD mode? This disconnects the USB and resumes from the most recent hourly snapshot.')) return
    setReverting(true)
    setRevertError('')
    try {
      await api.post('/storage/recover/revert-to-sd')
      // Service will restart; wait then reload
      setTimeout(() => { window.location.href = '/' }, 6000)
    } catch (err: any) {
      setRevertError(err.response?.data?.detail ?? 'Recovery failed')
      setReverting(false)
    }
  }

  const handleRestoreInPlace = async (which: 'current' | 'previous') => {
    const entry = which === 'current' ? health.snapshots.current : health.snapshots.previous
    const age = formatAgo(entry.modified_at)
    if (!confirm(`Overwrite the current database with the ${which} snapshot (${age})? This keeps the current storage mode and restarts MyNet.`)) return
    setRestoring(true)
    setRevertError('')
    try {
      await api.post('/storage/recover/restore-snapshot', { which })
      // Worker stops/starts the service; wait then reload
      setTimeout(() => { window.location.href = '/' }, 6000)
    } catch (err: any) {
      setRevertError(err?.response?.data?.detail ?? 'Restore failed')
      setRestoring(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={24} className="text-amber-400 flex-shrink-0" />
            <div>
              <h1 className="text-lg font-semibold text-white">
                {isCorrupt ? 'Database corrupted' : 'Database unavailable'}
              </h1>
              <p className="text-xs text-white/50">
                {isCorrupt
                  ? 'MyNet detected a corrupt database on startup. Restore from a recent snapshot to continue.'
                  : 'MyNet cannot reach its database.'}
              </p>
            </div>
          </div>

          {health.reason && (
            <div className="p-3 rounded bg-white/[0.02] border border-white/[0.05] text-xs text-white/60 font-mono">
              {health.reason}
            </div>
          )}

          {!isCorrupt && health.mode === 'usb' && (
            <div className="p-3 rounded border border-amber-500/30 bg-amber-500/[0.08] text-xs text-amber-400 flex items-start gap-2">
              <HardDrive size={14} className="mt-0.5 flex-shrink-0" />
              <div>
                The database is on a USB drive that isn't currently mounted. Re-insert it, wait a few seconds, then retry. If the drive has failed or is gone for good, restore from the last snapshot on the SD card.
              </div>
            </div>
          )}

          {isCorrupt && (
            <div className="p-3 rounded border border-amber-500/30 bg-amber-500/[0.08] text-xs text-amber-400 flex items-start gap-2">
              <HardDrive size={14} className="mt-0.5 flex-shrink-0" />
              <div>
                <strong>The storage medium itself is fine</strong> — only the database file contents are bad. Restoring from a snapshot overwrites the current DB in place and keeps your current storage mode ({health.mode === 'usb' ? 'USB' : 'SD'}). Worst-case data loss: whatever was written since the snapshot was taken.
              </div>
            </div>
          )}

          <div className="space-y-2">
            {/* Primary action — corrupt DB: restore current snapshot.
                USB unreachable: retry the mount. */}
            {isCorrupt && hasSnapshot ? (
              <button
                type="button"
                onClick={() => handleRestoreInPlace(health.snapshots.current.exists ? 'current' : 'previous')}
                disabled={restoring}
                className="w-full px-3 py-2 rounded text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {restoring
                  ? (<><Loader size={14} className="animate-spin" />Restoring and restarting…</>)
                  : <>Restore from snapshot ({formatAgo(latest.modified_at)})</>}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="w-full px-3 py-2 rounded text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {retrying
                  ? (<><Loader size={14} className="animate-spin" />Recovering — restarting service…</>)
                  : (<><RefreshCw size={14} />Retry</>)}
              </button>
            )}

            {/* Secondary action for the corruption case — try the older
                snapshot if the current one also reads as corrupt after
                restore (e.g., a snapshot taken while corruption was
                already in progress). */}
            {isCorrupt && health.snapshots.previous.exists && health.snapshots.current.exists && (
              <button
                type="button"
                onClick={() => handleRestoreInPlace('previous')}
                disabled={restoring}
                className="w-full px-3 py-2 rounded text-sm text-white/80 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                Restore from previous snapshot ({formatAgo(health.snapshots.previous.modified_at)}) instead
              </button>
            )}

            {/* Fall-back: move to SD mode entirely. Primary action for
                usb-missing-permanently; also available in corruption case
                if the user wants to abandon USB altogether. */}
            {hasSnapshot && health.platform_supported && (
              <button
                type="button"
                onClick={handleRevert}
                disabled={reverting}
                className="w-full px-3 py-2 rounded text-sm text-white/80 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {reverting
                  ? (<><Loader size={14} className="animate-spin" />Restoring and restarting…</>)
                  : isCorrupt
                    ? <>Restore from snapshot and move database to SD card</>
                    : <>Restore from snapshot ({formatAgo(latest.modified_at)}) and switch back to SD</>}
              </button>
            )}

            {!hasSnapshot && (
              <p className="text-xs text-white/40 text-center">
                No snapshots available on the SD card. You'll need to SSH to the server and recover manually.
              </p>
            )}
          </div>

          {revertError && (
            <p className="text-xs text-red-400">{revertError}</p>
          )}

          <div className="text-[11px] text-white/30 text-center pt-2 border-t border-white/[0.05]">
            Detected: <span className="font-mono">{health.mode}</span> mode. Service status is refreshed every few seconds.
          </div>
        </div>
      </div>
    </div>
  )
}
