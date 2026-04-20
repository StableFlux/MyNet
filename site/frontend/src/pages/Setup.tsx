import { useState, useRef } from 'react'
import { useAuthStore } from '../store/authStore'
import { UploadCloud, Usb, Loader } from 'lucide-react'
import api from '../lib/api'

type Mode = 'create' | 'restore'

interface StorageCandidate {
  device: string
  uuid: string
  label: string
  size_bytes: number
}

interface SetupProps {
  storageCandidate?: StorageCandidate | null
}

export default function Setup({ storageCandidate }: SetupProps = {}) {
  const setUser = useAuthStore((s) => s.setUser)
  const [mode, setMode] = useState<Mode>('create')
  const [dismissedUSB, setDismissedUSB] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [adoptError, setAdoptError] = useState('')

  // ── Create admin state ────────────────────────────────────────────
  const [form, setForm] = useState({ username: '', display_name: '', password: '', confirm: '' })
  const [createError, setCreateError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password !== form.confirm) { setCreateError('Passwords do not match'); return }
    setCreateLoading(true)
    setCreateError('')
    try {
      await api.post('/auth/setup', {
        username: form.username,
        display_name: form.display_name,
        password: form.password,
      })
      const fd = new FormData()
      fd.append('username', form.username)
      fd.append('password', form.password)
      await api.post('/auth/login', fd, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      const { data: me } = await api.get('/auth/me')
      setUser(me)
      window.location.href = '/'
    } catch (err: any) {
      setCreateError(err.response?.data?.detail ?? 'Setup failed')
    } finally {
      setCreateLoading(false)
    }
  }

  // ── Restore state ─────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [restoreError, setRestoreError] = useState('')
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restored, setRestored] = useState(false)

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!backupFile) return
    setRestoreLoading(true)
    setRestoreError('')
    try {
      const fd = new FormData()
      fd.append('file', backupFile)
      await api.post('/backup/restore-setup', fd)
      setRestored(true)
      // Give the user a moment to read the success message then reload
      setTimeout(() => { window.location.href = '/' }, 2000)
    } catch (err: any) {
      setRestoreError(err.response?.data?.detail ?? 'Restore failed')
    } finally {
      setRestoreLoading(false)
    }
  }

  // First-run USB gate (§6). Shown when a MYNET-STORAGE drive is present AND
  // the user hasn't dismissed it. "Use this database" mounts the USB and
  // restarts the service — the page is reloaded and the user lands at login.
  const showUSBGate = storageCandidate && !dismissedUSB

  const handleAdopt = async () => {
    if (!storageCandidate) return
    setAdopting(true)
    setAdoptError('')
    try {
      await api.post('/auth/adopt-storage-candidate', { usb_uuid: storageCandidate.uuid })
      // Service will restart shortly. Wait, then reload — /setup-required
      // will return setup_required:false because the USB brings its users
      // with it, sending us to the login page (or unlock if encrypted).
      setTimeout(() => { window.location.href = '/' }, 6000)
    } catch (err: any) {
      setAdoptError(err.response?.data?.detail ?? 'Could not adopt USB database')
      setAdopting(false)
    }
  }

  function formatGB(n: number): string {
    return n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`
  }

  if (showUSBGate) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="w-full max-w-md relative">
          <img src="/logo.png" alt="MyNet" className="w-[346px] max-w-full mx-auto absolute bottom-full left-0 right-0 -mb-8" />
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Usb size={20} className="text-emerald-400" />
              <h1 className="text-lg font-semibold text-white">USB database detected</h1>
            </div>
            <p className="text-sm text-white/60">
              A USB drive labelled <span className="font-mono text-white/80">MYNET-STORAGE</span> was found on this server.
              You can seed this install from the database it contains, or start fresh.
            </p>
            <div className="p-3 rounded bg-white/[0.02] border border-white/[0.05] text-xs text-white/60 space-y-0.5">
              <div><span className="text-white/40">Device:</span> <span className="font-mono">{storageCandidate.device}</span></div>
              <div><span className="text-white/40">Size:</span> {formatGB(storageCandidate.size_bytes)}</div>
              <div><span className="text-white/40">UUID:</span> <span className="font-mono">{storageCandidate.uuid.slice(0, 13)}…</span></div>
            </div>
            <p className="text-xs text-white/40">
              Using the existing database preserves every user, device, and setting from the previous install.
              If encryption was enabled, you will be prompted for the passphrase after adoption.
            </p>
            {adoptError && <p className="text-xs text-red-400">{adoptError}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAdopt}
                disabled={adopting}
                className="flex-1 px-3 py-2 rounded text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {adopting ? (<><Loader size={14} className="animate-spin" />Mounting…</>) : 'Use this database'}
              </button>
              <button
                type="button"
                onClick={() => setDismissedUSB(true)}
                disabled={adopting}
                className="px-3 py-2 rounded text-sm text-white/60 hover:text-white border border-white/[0.1] hover:bg-white/[0.04] disabled:opacity-40"
              >
                Start fresh
              </button>
            </div>
            {adopting && (
              <p className="text-xs text-white/40 text-center">
                Mounting the USB, swapping the database pointer, and restarting the service. This takes about 10 seconds.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md relative">
        <img src="/logo.png" alt="MyNet" className="w-[346px] max-w-full mx-auto absolute bottom-full left-0 right-0 -mb-8" />
        <div className="glass-card p-6 space-y-5">

          {/* Mode tabs */}
          <div className="flex rounded-lg overflow-hidden border border-glass-border">
            {(['create', 'restore'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === m
                    ? 'bg-indigo-600/30 text-indigo-300'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {m === 'create' ? 'Create Admin Account' : 'Restore from Backup'}
              </button>
            ))}
          </div>

          {/* Create admin form */}
          {mode === 'create' && (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="setup-username" className="block text-xs font-medium text-white/60 mb-1.5">Username</label>
                <input
                  id="setup-username"
                  className="glass-input w-full"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="admin"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="setup-display-name" className="block text-xs font-medium text-white/60 mb-1.5">Display name</label>
                <input
                  id="setup-display-name"
                  className="glass-input w-full"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder="Your Name"
                  required
                />
              </div>
              <div>
                <label htmlFor="setup-password" className="block text-xs font-medium text-white/60 mb-1.5">Password</label>
                <input
                  id="setup-password"
                  className="glass-input w-full"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="setup-confirm" className="block text-xs font-medium text-white/60 mb-1.5">Confirm password</label>
                <input
                  id="setup-confirm"
                  className="glass-input w-full"
                  type="password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  required
                />
              </div>
              {createError && <p className="text-sm text-red-400">{createError}</p>}
              <button type="submit" className="btn-primary w-full mt-2" disabled={createLoading}>
                {createLoading ? 'Creating account…' : 'Create admin account'}
              </button>
            </form>
          )}

          {/* Restore form */}
          {mode === 'restore' && (
            <form onSubmit={handleRestore} className="space-y-4">
              <p className="text-xs text-white/40">
                Upload a MyNet backup file to restore all data including users, devices, and networks.
                You will be redirected to the login page once the restore completes.
              </p>

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`w-full flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed transition-colors ${
                  backupFile
                    ? 'border-indigo-500/60 bg-indigo-500/[0.06] text-indigo-300'
                    : 'border-white/15 hover:border-white/30 text-white/40 hover:text-white/60'
                }`}
              >
                <UploadCloud size={24} />
                <span className="text-sm">
                  {backupFile ? backupFile.name : 'Click to select backup file'}
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                aria-label="Select backup file"
                className="hidden"
                onChange={(e) => setBackupFile(e.target.files?.[0] ?? null)}
              />

              {restoreError && <p className="text-sm text-red-400">{restoreError}</p>}
              {restored && <p className="text-sm text-green-400">Restore complete — redirecting to login…</p>}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={!backupFile || restoreLoading || restored}
              >
                {restoreLoading ? 'Restoring…' : 'Restore backup'}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}
