import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, HardDrive, AlertTriangle, Download, RefreshCw,
  ArrowLeftRight, Usb, Trash2, Loader, CheckCircle, Clock, AlertCircle,
} from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import api from '../lib/api'

// ── Types (server shape from /api/storage/status) ───────────────────────────
interface Candidate {
  device: string
  uuid: string
  size_bytes: number
  fstype: string
  label: string
  mountpoint: string
}
interface StorageStatus {
  platform_supported: boolean
  reason?: string
  mode: 'sd' | 'usb'
  usb_uuid: string
  snapshot_interval_secs: number
  allowed_snapshot_intervals: number[]
  helper: any
  snapshots: {
    current: { exists: boolean; size_bytes?: number; modified_at?: number }
    previous: { exists: boolean; size_bytes?: number; modified_at?: number }
  }
  migration_in_progress: boolean
  migration_state: null | { target: string; phase: string; error?: string; usb_uuid?: string }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatBytes(n?: number): string {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function formatAgo(epoch?: number): string {
  if (!epoch) return 'never'
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

const INTERVAL_LABELS: Record<number, string> = {
  900:   '15 minutes',
  1800:  '30 minutes',
  3600:  '1 hour',
  21600: '6 hours',
}

// ── Migration confirmation modal (§9) ───────────────────────────────────────
function MigrationModal({
  target, candidate, onCancel, onConfirm,
}: {
  target: 'usb' | 'sd'
  candidate?: Candidate
  onCancel: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const canSubmit = typed === 'MIGRATE'
  const isUSB = target === 'usb'
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="w-full max-w-lg glass-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Move database to {isUSB ? 'USB' : 'SD card'}
        </h2>
        <div className="text-sm text-white/70 space-y-2">
          {isUSB ? (
            <>
              <p>Once MyNet is using the USB drive:</p>
              <ul className="list-disc list-inside space-y-1 text-white/60">
                <li>The USB drive <strong className="text-amber-400">must stay inserted</strong> whenever the server is powered on.</li>
                <li>Removing or inserting the USB drive while running <strong className="text-red-400">WILL corrupt your database</strong>.</li>
                <li>If the drive is lost or fails, MyNet will offer to restore from an hourly snapshot on the SD card (at most 1 interval of data loss).</li>
                <li>The MyNet service will restart during migration. If encryption is enabled, you'll need to re-enter your passphrase afterwards.</li>
                <li>Initialising the USB will <strong className="text-red-400">ERASE</strong> all data already on it.</li>
              </ul>
              {candidate && (
                <div className="mt-2 p-3 rounded bg-white/[0.03] text-xs text-white/60">
                  <div><strong className="text-white/80">Target:</strong> {candidate.device} · {formatBytes(candidate.size_bytes)} · {candidate.fstype || 'unformatted'}{candidate.label ? ` · ${candidate.label}` : ''}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <p>This will move the database back to the SD card:</p>
              <ul className="list-disc list-inside space-y-1 text-white/60">
                <li>The service will restart during migration.</li>
                <li>If encryption is enabled, you'll need to re-enter your passphrase afterwards.</li>
                <li>Once the SD copy is verified, the database file is <strong className="text-amber-400">wiped from the USB drive</strong>. A 24-hour safety anchor and the hourly snapshots remain on SD.</li>
                <li>The USB drive will be unmounted once the move completes — you can then safely remove it.</li>
              </ul>
            </>
          )}
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Type MIGRATE to confirm</label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="glass-input w-full font-mono"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-white/60 hover:text-white">Cancel</button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onConfirm}
            className="px-3 py-1.5 rounded text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Start migration
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Phase label for the live status stream ──────────────────────────────────
const PHASE_LABELS: Record<string, string> = {
  preflight: 'Pre-flight checks',
  snapshot: 'Snapshotting current database',
  stop_service: 'Stopping service',
  copy: 'Copying database',
  verify_destination: 'Verifying destination',
  install_dropin: 'Installing systemd drop-in',
  swap: 'Swapping database pointer',
  start_service: 'Restarting service',
  verify_probe: 'Verifying new database',
  complete: 'Complete',
  rolling_back: 'Rolling back',
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function Storage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // `handoffPending` covers the window between clicking "Start migration" and
  // the backend worker writing migration_state.json — without it the UI sits
  // silent for several seconds, which reads as "nothing happened".
  const [handoffPending, setHandoffPending] = useState(false)

  const { data: status, isLoading, refetch } = useQuery<StorageStatus>({
    queryKey: ['storage-status'],
    queryFn: async () => (await api.get('/storage/status')).data,
    refetchInterval: (q) => {
      if (handoffPending) return 500
      if (q.state.data?.migration_in_progress) return 1000
      return 5000
    },
  })

  // Clear the handoff banner the instant the worker picks up the lock.
  useEffect(() => {
    if (status?.migration_in_progress) setHandoffPending(false)
  }, [status?.migration_in_progress])

  // Safety net: if something goes wrong and migration_in_progress never flips
  // to true, don't leave the banner up forever. 30s is comfortably longer
  // than the worker's spin-up under normal conditions.
  useEffect(() => {
    if (!handoffPending) return
    const t = setTimeout(() => setHandoffPending(false), 30000)
    return () => clearTimeout(t)
  }, [handoffPending])

  // Auto-redirect when a migration completes successfully. The user has
  // been staring at a phase-progress banner for 30s+ while the service
  // restarted; leaving them static on the Storage page afterwards makes
  // them wonder whether anything actually finished. Once we observe the
  // migration_in_progress flag transition from true → false AND there's
  // no rollback state, show a brief "complete" banner and reload to / ,
  // which takes them through login (service restart may have invalidated
  // their session state, and if encryption is enabled they need to unlock
  // again anyway).
  const wasMigratingRef = useRef(false)
  const [migrationJustCompleted, setMigrationJustCompleted] = useState(false)
  useEffect(() => {
    if (status?.migration_in_progress) {
      wasMigratingRef.current = true
      return
    }
    if (!wasMigratingRef.current) return
    // Just transitioned from in-progress → idle
    wasMigratingRef.current = false
    if (status && !status.migration_state) {
      // Clean completion — no rolling_back state left behind. Redirect.
      setMigrationJustCompleted(true)
      const t = setTimeout(() => { window.location.href = '/' }, 2500)
      return () => clearTimeout(t)
    }
    // Otherwise the rolling_back banner in the normal render handles it.
  }, [status?.migration_in_progress, status?.migration_state, status])

  const { data: candidatesData, refetch: rescan, isFetching: scanning } = useQuery<{ candidates: Candidate[] }>({
    queryKey: ['storage-candidates'],
    queryFn: async () => (await api.post('/storage/scan')).data,
    enabled: status?.platform_supported === true && status?.mode === 'sd',
  })

  const [migrateModal, setMigrateModal] = useState<null | { target: 'usb' | 'sd'; candidate?: Candidate }>(null)
  const [selectedUuid, setSelectedUuid] = useState<string>('')

  const migrateMutation = useMutation({
    mutationFn: async (body: { target: string; confirm: string; usb_uuid?: string }) =>
      (await api.post('/storage/migrate', body)).data,
    onError: () => { setHandoffPending(false) },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['storage-status'] })
      // Immediate status refetch — don't wait for the next scheduled poll
      refetch()
    },
  })

  const initialiseMutation = useMutation({
    mutationFn: async (device: string) =>
      (await api.post('/storage/initialise', { device, confirm: 'INITIALISE' })).data,
    onSuccess: (data: any) => {
      // The helper returns the new UUID; pre-select it for the migrate flow
      if (data?.uuid) setSelectedUuid(data.uuid)
      rescan()
    },
  })

  const intervalMutation = useMutation({
    mutationFn: async (seconds: number) =>
      (await api.patch('/storage/snapshot-interval', { seconds })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-status'] }),
  })

  const snapshotNowMutation = useMutation({
    mutationFn: async () => (await api.post('/storage/snapshot/now')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-status'] }),
  })

  const dismissMutation = useMutation({
    mutationFn: async () => (await api.post('/storage/migration-state/dismiss')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-status'] }),
  })

  // Server-sent phase updates via the existing WebSocket
  const [phase, setPhase] = useState<string | null>(null)
  const [phaseError, setPhaseError] = useState<string | null>(null)
  useEffect(() => {
    let ws: WebSocket | null = null
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const token = localStorage.getItem('jwt') ?? ''
      ws = new WebSocket(`${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'storage' && msg.subtype === 'migration.phase') {
            setPhase(msg.phase)
            if (msg.error) setPhaseError(msg.error)
          }
        } catch { /* ignore */ }
      }
    } catch { /* no WS — poll-only */ }
    return () => { ws?.close() }
  }, [])

  if (isLoading || !status) {
    return (
      <div className="flex items-center justify-center p-8 text-white/50">
        <Loader size={16} className="animate-spin mr-2" />
        Loading storage status…
      </div>
    )
  }

  if (!status.platform_supported) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <button type="button" onClick={() => navigate('/settings')} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70">
          <ChevronLeft size={14} /> Settings
        </button>
        <GlassCard>
          <div className="p-6 space-y-2">
            <h1 className="text-lg font-semibold text-white flex items-center gap-2"><HardDrive size={18} />Storage</h1>
            <p className="text-sm text-white/60">{status.reason ?? 'USB storage is not available on this host.'}</p>
            <p className="text-xs text-white/40">Supported on Raspberry Pi / Ubuntu / Debian with systemd.</p>
          </div>
        </GlassCard>
      </div>
    )
  }

  const isUSB = status.mode === 'usb'
  const helper = status.helper ?? {}
  const sdFree = helper?.sd?.free_bytes ?? 0
  const sdTotal = helper?.sd?.total_bytes ?? 0
  const usbFree = helper?.usb?.free_bytes ?? 0
  const usbTotal = helper?.usb?.total_bytes ?? 0
  const usbUsedPct = usbTotal > 0 ? 1 - usbFree / usbTotal : 0

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button type="button" onClick={() => navigate('/settings')} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70">
        <ChevronLeft size={14} /> Settings
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2"><HardDrive size={18} />Storage</h1>
        <button type="button" onClick={() => refetch()} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* USB-mode warning banner — persistent safety reminder, stays at top */}
      {isUSB && (
        <div className="p-3 rounded border border-amber-500/30 bg-amber-500/[0.08] text-xs text-amber-400 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            <strong>USB mode active.</strong> Never insert or remove the USB drive while the server is powered on — doing so will corrupt the database.
          </div>
        </div>
      )}

      {/* Migration status / result — sits adjacent to the Current Storage
          card so the user's eye catches it, but not *inside* the card where
          it disrupts the mode/path/usage reading flow. Backend-driven so it
          survives the service restart mid-migration. Only one banner visible
          at a time: handoff → pre-worker error → in-progress → rolling-back. */}

      {/* 1. Handoff window: the instant the user confirms, held until the
          worker picks up the lock. Covers the gap between HTTP 202 and
          first /status poll reporting migration_in_progress=true. */}
      {handoffPending && !status.migration_in_progress && (
        <div className="p-3 rounded border border-indigo-500/30 bg-indigo-500/[0.08] text-xs text-indigo-300 flex items-center gap-2">
          <Loader size={14} className="animate-spin flex-shrink-0" />
          <div>
            <strong>Starting migration…</strong> spinning up the background worker. The service will restart in a few seconds; you may be asked to log in again once it's done.
          </div>
        </div>
      )}

      {/* 2. Pre-worker failure (mount failed, validation failed, etc.) —
          mutation itself errored before the worker was spawned. */}
      {!migrateMutation.isPending && migrateMutation.isError && !handoffPending && (
        <div className="p-3 rounded border border-red-500/30 bg-red-500/[0.08] text-xs text-red-400 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            <strong>Could not start migration:</strong> {(migrateMutation.error as any)?.response?.data?.detail ?? String(migrateMutation.error)}
          </div>
        </div>
      )}

      {/* 3. Worker is running — phase-by-phase status. */}
      {status.migration_in_progress && (
        <div className="p-3 rounded border border-indigo-500/30 bg-indigo-500/[0.08] text-xs text-indigo-300 flex items-center gap-2">
          <Loader size={14} className="animate-spin flex-shrink-0" />
          <div>
            <strong>Migration in progress:</strong> {(() => {
              const p = phase ?? status.migration_state?.phase ?? 'starting'
              return PHASE_LABELS[p] ?? p
            })()}
            <span className="ml-2 text-white/40">— the service will restart; you'll briefly lose the connection, then need to log back in.</span>
          </div>
        </div>
      )}

      {/* 4. Migration completed cleanly. Brief display before the auto-
          redirect kicks in — gives the user confirmation something
          finished, rather than the page quietly going blank. */}
      {migrationJustCompleted && (
        <div className="p-3 rounded border border-emerald-500/30 bg-emerald-500/[0.08] text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle size={14} className="flex-shrink-0" />
          <div>
            <strong>Migration complete.</strong> Refreshing the app…
          </div>
        </div>
      )}

      {/* 5. Worker finished and rolled back after an error — persists until
          dismissed. Next migration attempt also clears it. */}
      {!status.migration_in_progress && status.migration_state && status.migration_state.phase === 'rolling_back' && (
        <div className="p-3 rounded border border-red-500/30 bg-red-500/[0.08] text-xs text-red-400 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <strong>Migration failed and rolled back.</strong>
            {status.migration_state.error && <div className="mt-1 text-red-400/90 font-mono text-[10px] break-all">{status.migration_state.error}</div>}
          </div>
          <button
            type="button"
            onClick={() => dismissMutation.mutate()}
            disabled={dismissMutation.isPending}
            className="text-[10px] px-2 py-0.5 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 flex-shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Current location */}
      <GlassCard>
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-white/40">Current storage</div>
              <div className="text-sm font-medium text-white mt-1">
                {isUSB ? 'USB drive' : 'SD card'}
                {isUSB && status.usb_uuid && <span className="ml-2 text-white/40 font-mono text-xs">UUID {status.usb_uuid.slice(0, 8)}…</span>}
              </div>
              <div className="font-mono text-[11px] text-white/50 mt-0.5">
                {helper?.db_target || (isUSB ? '/mnt/mynet-storage/mynet.db' : '/opt/mynet/data/mynet.db')}
                <span className="ml-2">({formatBytes(helper?.db_size_bytes)})</span>
              </div>
            </div>
            <HardDrive size={24} className={isUSB ? 'text-amber-400' : 'text-white/30'} />
          </div>

          {/* SD usage bar */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-white/40">
              <span>SD card</span>
              <span>{formatBytes(sdTotal - sdFree)} used / {formatBytes(sdTotal)}</span>
            </div>
            <div className="h-1.5 mt-1 bg-white/[0.06] rounded overflow-hidden">
              <div className="h-full bg-indigo-500/60" style={{ width: sdTotal ? `${((sdTotal - sdFree) / sdTotal * 100).toFixed(1)}%` : '0%' }} />
            </div>
          </div>

          {/* USB usage bar (only when mounted) */}
          {isUSB && usbTotal > 0 && (
            <div>
              <div className="flex items-center justify-between text-[11px] text-white/40">
                <span>USB drive</span>
                <span>{formatBytes(usbTotal - usbFree)} used / {formatBytes(usbTotal)}</span>
              </div>
              <div className={`h-1.5 mt-1 rounded overflow-hidden ${usbUsedPct > 0.95 ? 'bg-red-500/10' : usbUsedPct > 0.80 ? 'bg-amber-500/10' : 'bg-white/[0.06]'}`}>
                <div
                  className={`h-full ${usbUsedPct > 0.95 ? 'bg-red-500/70' : usbUsedPct > 0.80 ? 'bg-amber-500/70' : 'bg-emerald-500/60'}`}
                  style={{ width: `${(usbUsedPct * 100).toFixed(1)}%` }}
                />
              </div>
              {usbUsedPct > 0.80 && (
                <p className="text-[11px] mt-1 text-amber-400">
                  {usbUsedPct > 0.95 ? 'USB is nearly full — monitoring writes will be paused until resolved.' : 'USB is over 80% full.'}
                </p>
              )}
            </div>
          )}
        </div>
      </GlassCard>

      {/* Snapshots */}
      <GlassCard>
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-white/40">Snapshots (SD card)</div>
              <div className="text-xs text-white/50 mt-1">Automatic backups of the live database. Used to restore after a USB drive failure or removal.</div>
            </div>
            <Clock size={20} className="text-white/30" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded bg-white/[0.02] border border-white/[0.04]">
              <div className="text-white/40 text-[10px] uppercase tracking-wider">Current</div>
              {status.snapshots.current.exists ? (
                <>
                  <div className="text-white/70 mt-1">{formatAgo(status.snapshots.current.modified_at)}</div>
                  <div className="text-white/40">{formatBytes(status.snapshots.current.size_bytes)}</div>
                </>
              ) : (
                <div className="text-white/30 italic mt-1">No snapshot yet</div>
              )}
            </div>
            <div className="p-3 rounded bg-white/[0.02] border border-white/[0.04]">
              <div className="text-white/40 text-[10px] uppercase tracking-wider">Previous</div>
              {status.snapshots.previous.exists ? (
                <>
                  <div className="text-white/70 mt-1">{formatAgo(status.snapshots.previous.modified_at)}</div>
                  <div className="text-white/40">{formatBytes(status.snapshots.previous.size_bytes)}</div>
                </>
              ) : (
                <div className="text-white/30 italic mt-1">—</div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-white/40">Interval</label>
              <select
                value={status.snapshot_interval_secs}
                onChange={(e) => intervalMutation.mutate(Number(e.target.value))}
                disabled={intervalMutation.isPending}
                className="glass-input text-xs py-1"
              >
                {status.allowed_snapshot_intervals.map((s) => (
                  <option key={s} value={s}>{INTERVAL_LABELS[s] ?? `${s}s`}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => snapshotNowMutation.mutate()}
                disabled={snapshotNowMutation.isPending || status.migration_in_progress}
                className="text-xs px-2 py-1 rounded text-white/60 hover:text-white hover:bg-white/[0.05] disabled:opacity-40"
              >
                {snapshotNowMutation.isPending ? 'Snapshotting…' : 'Snapshot now'}
              </button>
              <a
                href="/api/storage/snapshot/download?which=current"
                className={`text-xs px-2 py-1 rounded text-indigo-400 hover:bg-indigo-500/10 flex items-center gap-1 ${status.snapshots.current.exists ? '' : 'pointer-events-none opacity-30'}`}
              >
                <Download size={12} /> Download latest
              </a>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* SD mode → show USB picker */}
      {!isUSB && (
        <GlassCard>
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-white/40">USB drives detected</div>
                <div className="text-xs text-white/50 mt-1">Dedicated, ext4-only. Other filesystems can be initialised below (wipes the drive).</div>
              </div>
              <button type="button" onClick={() => rescan()} disabled={scanning} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1 disabled:opacity-40">
                <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} /> Rescan
              </button>
            </div>

            {/* Initialise progress / error banner */}
            {initialiseMutation.isPending && (
              <div className="p-3 rounded border border-indigo-500/30 bg-indigo-500/[0.08] text-xs text-indigo-300 flex items-center gap-2">
                <Loader size={14} className="animate-spin" />
                <div>
                  <strong>Initialising drive</strong> — unmounting any existing filesystem, then formatting as ext4. This can take 10–30 seconds on a USB stick.
                </div>
              </div>
            )}
            {initialiseMutation.isError && (
              <div className="p-3 rounded border border-red-500/30 bg-red-500/[0.08] text-xs text-red-400 flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div>
                  <strong>Initialisation failed:</strong> {(initialiseMutation.error as any)?.response?.data?.detail ?? String(initialiseMutation.error)}
                </div>
              </div>
            )}
            {initialiseMutation.isSuccess && !initialiseMutation.isPending && (
              <div className="p-3 rounded border border-emerald-500/30 bg-emerald-500/[0.08] text-xs text-emerald-400 flex items-start gap-2">
                <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div>Drive initialised and selected. You can now migrate the database.</div>
              </div>
            )}

            {(!candidatesData || candidatesData.candidates.length === 0) ? (
              <p className="text-xs text-white/40 italic">No USB partitions detected. Insert a drive and click Rescan.</p>
            ) : (
              <div className="space-y-2">
                {candidatesData.candidates.map((c) => {
                  const selectable = c.fstype === 'ext4'
                  const isSelected = c.uuid && selectedUuid === c.uuid
                  return (
                    <div key={c.device} className={`p-3 rounded border flex items-center gap-3 ${isSelected ? 'border-indigo-500/40 bg-indigo-500/[0.05]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                      <Usb size={16} className={selectable ? 'text-emerald-400' : 'text-white/40'} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white/80 font-mono">{c.device}</div>
                        <div className="text-[11px] text-white/40">
                          {formatBytes(c.size_bytes)} · {c.fstype || 'unformatted'}
                          {c.label && <> · label {c.label}</>}
                          {c.mountpoint && <> · mounted at {c.mountpoint}</>}
                        </div>
                      </div>
                      {selectable ? (
                        <button
                          type="button"
                          onClick={() => setSelectedUuid(c.uuid)}
                          className="text-xs px-2 py-1 rounded text-indigo-400 hover:bg-indigo-500/10"
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Formatting ${c.device} as ext4 will ERASE all data on it. Continue?`)) {
                              initialiseMutation.mutate(c.device)
                            }
                          }}
                          disabled={initialiseMutation.isPending}
                          className="text-xs px-2 py-1 rounded text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
                        >
                          {initialiseMutation.isPending ? 'Initialising…' : 'Initialise (erase)'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.05]">
              <button
                type="button"
                disabled={!selectedUuid || status.migration_in_progress}
                onClick={() => {
                  const candidate = candidatesData?.candidates.find((c) => c.uuid === selectedUuid)
                  setMigrateModal({ target: 'usb', candidate })
                }}
                className="text-xs px-3 py-1.5 rounded font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 flex items-center gap-1.5"
              >
                <ArrowLeftRight size={12} /> Move database to USB…
              </button>
            </div>
          </div>
        </GlassCard>
      )}

      {/* USB mode → show migrate-back button */}
      {isUSB && (
        <GlassCard>
          <div className="p-5 space-y-3">
            <div className="text-xs uppercase tracking-wider text-white/40">Return to SD card</div>
            <p className="text-xs text-white/50">Copies the database from the USB back to the SD card, unmounts the USB, and resumes normal SD operation.</p>
            <div className="flex items-center justify-end">
              <button
                type="button"
                disabled={status.migration_in_progress}
                onClick={() => setMigrateModal({ target: 'sd' })}
                className="text-xs px-3 py-1.5 rounded font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 flex items-center gap-1.5"
              >
                <ArrowLeftRight size={12} /> Move database back to SD card…
              </button>
            </div>
          </div>
        </GlassCard>
      )}

      {migrateModal && (
        <MigrationModal
          target={migrateModal.target}
          candidate={migrateModal.candidate}
          onCancel={() => setMigrateModal(null)}
          onConfirm={() => {
            // Flip the banner on BEFORE firing the mutation so the user sees
            // feedback the instant the modal closes. If the mutation errors
            // (pre-worker failure like mount fail), onError clears this.
            setHandoffPending(true)
            migrateMutation.mutate({
              target: migrateModal.target,
              confirm: 'MIGRATE',
              usb_uuid: migrateModal.target === 'usb' ? selectedUuid : undefined,
            })
            setMigrateModal(null)
          }}
        />
      )}
    </div>
  )
}
