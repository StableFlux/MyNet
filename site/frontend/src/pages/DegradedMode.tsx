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

  const hasSnapshot = health.snapshots.current.exists || health.snapshots.previous.exists
  const latest = health.snapshots.current.exists ? health.snapshots.current : health.snapshots.previous

  const handleRetry = async () => {
    setRetrying(true)
    // Ask the backend to attempt a remount first (in case the user plugged
    // the drive back in). If that succeeds, the DB becomes reachable and
    // onRetry's health probe will take us back to the normal UI. We ignore
    // errors here because we're about to re-probe anyway — if remount
    // failed we'll just stay on this screen.
    try { await api.post('/storage/recover/remount') } catch { /* ignore */ }
    try { onRetry() } finally { setTimeout(() => setRetrying(false), 1500) }
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

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={24} className="text-amber-400 flex-shrink-0" />
            <div>
              <h1 className="text-lg font-semibold text-white">Database unavailable</h1>
              <p className="text-xs text-white/50">MyNet cannot reach its database.</p>
            </div>
          </div>

          {health.reason && (
            <div className="p-3 rounded bg-white/[0.02] border border-white/[0.05] text-xs text-white/60 font-mono">
              {health.reason}
            </div>
          )}

          {health.mode === 'usb' && (
            <div className="p-3 rounded border border-amber-500/30 bg-amber-500/[0.08] text-xs text-amber-400 flex items-start gap-2">
              <HardDrive size={14} className="mt-0.5 flex-shrink-0" />
              <div>
                The database is on a USB drive that isn't currently mounted. Re-insert it, wait a few seconds, then retry. If the drive has failed or is gone for good, restore from the last snapshot on the SD card.
              </div>
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="w-full px-3 py-2 rounded text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {retrying ? (<><Loader size={14} className="animate-spin" />Checking…</>) : (<><RefreshCw size={14} />Retry</>)}
            </button>

            {hasSnapshot && health.platform_supported && (
              <button
                type="button"
                onClick={handleRevert}
                disabled={reverting}
                className="w-full px-3 py-2 rounded text-sm text-white/80 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {reverting
                  ? (<><Loader size={14} className="animate-spin" />Restoring and restarting…</>)
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
