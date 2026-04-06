import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, HardDriveDownload, MapPin, QrCode, ShieldOff, Save, ScrollText, Lock, LockOpen, KeyRound, AlertTriangle, Palette, Wifi, Trash2 } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'

const SETTINGS_ITEMS = [
  {
    to: '/users',
    icon: Users,
    label: 'User Management',
    description: 'Manage user accounts, roles, and access.',
  },
  {
    to: '/settings/locations',
    icon: MapPin,
    label: 'Locations',
    description: 'Define locations that can be assigned to devices.',
  },
  {
    to: '/backup',
    icon: HardDriveDownload,
    label: 'Backup',
    description: 'Download a backup of the database.',
  },
  {
    to: '/settings/label-export',
    icon: QrCode,
    label: 'Label CSV Export',
    description: 'Export device names and URLs for label printer import.',
  },
  {
    to: '/settings/colours',
    icon: Palette,
    label: 'Colour Settings',
    description: 'Customise colours for location types, device categories, and statuses.',
  },
  {
    to: '/settings/pihole',
    icon: Wifi,
    label: 'Pi-hole Integration',
    description: 'Configure Pi-hole DNS filtering instances and polling interval.',
  },
  {
    to: '/events',
    icon: ScrollText,
    label: 'Events',
    description: 'View all system events — activity history, alerts, conflicts, and monitoring.',
  },
]

// ── Passphrase modal ─────────────────────────────────────────────────────────

type ModalMode = 'enable' | 'disable' | 'unlock'

function EncryptionModal({
  mode,
  onConfirm,
  onCancel,
  error,
  loading,
}: {
  mode: ModalMode
  onConfirm: (passphrase: string, confirm?: string) => void
  onCancel: () => void
  error: string
  loading: boolean
}) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')

  const titles: Record<ModalMode, string> = {
    enable: 'Enable Database Encryption',
    disable: 'Disable Database Encryption',
    unlock: 'Unlock Encryption',
  }

  const descriptions: Record<ModalMode, string> = {
    enable: 'Choose a passphrase to encrypt stored device credentials. You will need this passphrase to unlock encryption after a server restart or to disable it later. There is no recovery if you forget it.',
    disable: 'Enter your encryption passphrase to decrypt all stored credentials and disable encryption.',
    unlock: 'Enter your encryption passphrase to unlock credential access for this session.',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
            <KeyRound size={16} className="text-indigo-300" />
          </div>
          <h2 className="text-base font-semibold text-white">{titles[mode]}</h2>
        </div>

        <p className="text-sm text-white/50">{descriptions[mode]}</p>

        {mode === 'enable' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-300">
              After a server restart, encryption will be locked until an admin unlocks it.
              Stored passwords will be inaccessible until then.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 mb-1">
              {mode === 'unlock' ? 'Passphrase' : mode === 'disable' ? 'Current passphrase' : 'New passphrase'}
            </label>
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="glass-input w-full text-sm"
              placeholder="••••••••"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && mode !== 'enable') onConfirm(passphrase)
              }}
            />
          </div>
          {mode === 'enable' && (
            <div>
              <label className="block text-xs text-white/40 mb-1">Confirm passphrase</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="glass-input w-full text-sm"
                placeholder="••••••••"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onConfirm(passphrase, confirm)
                }}
              />
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !passphrase}
            onClick={() => onConfirm(passphrase, mode === 'enable' ? confirm : undefined)}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {loading ? 'Working…' : mode === 'enable' ? 'Enable Encryption' : mode === 'disable' ? 'Disable Encryption' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Factory Reset modal ──────────────────────────────────────────────────────

function FactoryResetModal({ onConfirm, onCancel, loading }: {
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  const [typed, setTyped] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1f2e] border border-red-500/30 rounded-xl p-6 w-full max-w-md shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-600/20 flex items-center justify-center flex-shrink-0">
            <Trash2 size={16} className="text-red-400" />
          </div>
          <h2 className="text-base font-semibold text-white">Factory Reset</h2>
        </div>

        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-1">
          <p className="text-xs font-semibold text-red-400">This will permanently delete:</p>
          <ul className="text-xs text-red-300/80 list-disc list-inside space-y-0.5">
            <li>All users and sessions</li>
            <li>All devices, NICs, and switch ports</li>
            <li>All networks and locations</li>
            <li>All WAN configs and monitoring history</li>
            <li>All events and alerts</li>
            <li>All custom settings and colours</li>
          </ul>
          <p className="text-xs text-red-300/80 pt-1">The setup wizard will appear on next page load. This cannot be undone.</p>
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">Type <span className="font-mono text-white/70">RESET</span> to confirm</label>
          <input
            type="text"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="glass-input w-full text-sm font-mono"
            placeholder="RESET"
          />
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onCancel} disabled={loading} className="btn-ghost text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={typed !== 'RESET' || loading}
            onClick={onConfirm}
            className="text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Trash2 size={13} />
            {loading ? 'Resetting…' : 'Factory Reset'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { setUser } = useAuthStore()

  const { data: sysData } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })

  const [systemName, setSystemName] = useState('')
  const [authRequired, setAuthRequired] = useState(true)
  const [authError, setAuthError] = useState('')

  const [modal, setModal] = useState<ModalMode | null>(null)
  const [modalError, setModalError] = useState('')
  const [modalLoading, setModalLoading] = useState(false)

  const [showResetModal, setShowResetModal] = useState(false)
  const resetMutation = useMutation({
    mutationFn: () => api.post('/backup/factory-reset', { confirm: 'RESET' }),
    onSuccess: () => {
      setUser(null)
      qc.clear()
      window.location.href = '/'
    },
    onError: (err: any) => {
      setShowResetModal(false)
      alert(err?.response?.data?.detail ?? 'Factory reset failed')
    },
  })

  useEffect(() => {
    if (sysData) {
      setSystemName(sysData.system_name ?? 'MyNet')
      setAuthRequired(sysData.auth_required ?? true)
    }
  }, [sysData])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch('/system-settings', {
        system_name: systemName,
        auth_required: authRequired,
      })
      return data
    },
    onSuccess: () => {
      setAuthError('')
      qc.invalidateQueries({ queryKey: ['system-settings'] })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      if (detail) setAuthError(detail)
    },
  })

  const dirty = sysData && (
    systemName !== sysData.system_name ||
    authRequired !== sysData.auth_required
  )

  const encEnabled = sysData?.encryption_enabled ?? false
  const encLocked = sysData?.encryption_locked ?? false

  function handleAuthToggle() {
    if (!authRequired && encEnabled) {
      setAuthError('Disable encryption before turning off the login requirement.')
      return
    }
    setAuthError('')
    setAuthRequired((v) => !v)
  }

  async function handleModalConfirm(passphrase: string, confirm?: string) {
    setModalError('')
    setModalLoading(true)
    try {
      if (modal === 'enable') {
        await api.post('/system-settings/encryption/enable', { passphrase, confirm })
      } else if (modal === 'disable') {
        await api.post('/system-settings/encryption/disable', { passphrase })
      } else if (modal === 'unlock') {
        await api.post('/system-settings/encryption/unlock', { passphrase })
      }
      setModal(null)
      qc.invalidateQueries({ queryKey: ['system-settings'] })
    } catch (err: any) {
      setModalError(err?.response?.data?.detail ?? 'An error occurred.')
    } finally {
      setModalLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {modal && (
        <EncryptionModal
          mode={modal}
          onConfirm={handleModalConfirm}
          onCancel={() => { setModal(null); setModalError('') }}
          error={modalError}
          loading={modalLoading}
        />
      )}
      {showResetModal && (
        <FactoryResetModal
          onConfirm={() => resetMutation.mutate()}
          onCancel={() => setShowResetModal(false)}
          loading={resetMutation.isPending}
        />
      )}

      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-white/40 mt-0.5">Administration</p>
      </div>

      {/* Nav cards */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Administration</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SETTINGS_ITEMS.map(({ to, icon: Icon, label, description }) => (
            <GlassCard key={to} hover onClick={() => navigate(to)} className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
                <Icon size={18} className="text-indigo-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-xs text-white/40 mt-0.5">{description}</p>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* System settings */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">System</h2>
        <GlassCard className="space-y-5">

          {/* System name */}
          <div className="flex items-center gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">System Name</p>
              <p className="text-xs text-white/40 mt-0.5">Displayed in the top-left of the sidebar.</p>
            </div>
            <input
              type="text"
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              className="glass-input text-sm w-48"
              placeholder="MyNet"
            />
          </div>

          <div className="h-px bg-white/[0.06]" />

          {/* Require login toggle */}
          <div className="flex items-start gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Require Login</p>
              <p className="text-xs text-white/40 mt-0.5">
                When disabled, anyone on the network can access the system without a username or password.
                Only turn this off on a trusted private LAN.
              </p>
              {!authRequired && (
                <div className="flex items-center gap-1.5 mt-2 text-amber-400/80 text-xs">
                  <ShieldOff size={12} />
                  <span>Authentication is currently disabled — all access is open.</span>
                </div>
              )}
              {authError && (
                <p className="mt-2 text-xs text-red-400">{authError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleAuthToggle}
              className="flex-shrink-0 mt-0.5"
              aria-label={authRequired ? 'Disable login requirement' : 'Enable login requirement'}
            >
              <div className={`relative w-10 h-6 rounded-full transition-colors ${authRequired ? 'bg-indigo-600' : 'bg-amber-500/70'}`}>
                <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${authRequired ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
          </div>

          <div className="h-px bg-white/[0.06]" />

          {/* Encryption */}
          <div className="flex items-start gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Database Encryption</p>
              <p className="text-xs text-white/40 mt-0.5">
                Encrypts stored device credentials at rest. Requires a passphrase — keys are never
                included in backups.
              </p>
              <div className="mt-2 flex items-center gap-2">
                {!encEnabled ? (
                  <span className="text-xs text-white/30">Off</span>
                ) : encLocked ? (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400">
                    <Lock size={11} /> Enabled — locked (unlock to access credentials)
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <LockOpen size={11} /> Enabled — unlocked
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0 mt-0.5">
              {!encEnabled && (
                <button
                  type="button"
                  onClick={() => { setModalError(''); setModal('enable') }}
                  disabled={!authRequired}
                  title={!authRequired ? 'Enable Require Login first' : undefined}
                  className="btn-ghost text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Lock size={12} /> Enable
                </button>
              )}
              {encEnabled && encLocked && (
                <button
                  type="button"
                  onClick={() => { setModalError(''); setModal('unlock') }}
                  className="btn-primary text-xs flex items-center gap-1.5"
                >
                  <LockOpen size={12} /> Unlock
                </button>
              )}
              {encEnabled && !encLocked && (
                <button
                  type="button"
                  onClick={() => { setModalError(''); setModal('disable') }}
                  className="btn-ghost text-xs flex items-center gap-1.5"
                >
                  <LockOpen size={12} /> Disable
                </button>
              )}
            </div>
          </div>

          {dirty && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <Save size={14} />
                {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-red-400/60 uppercase tracking-widest">Danger Zone</h2>
        <GlassCard className="border-red-500/20">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-red-600/15 flex items-center justify-center flex-shrink-0">
              <Trash2 size={18} className="text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Factory Reset</p>
              <p className="text-xs text-white/40 mt-0.5">
                Wipe all users, devices, networks, and settings. Returns the system to a
                freshly installed state and launches the setup wizard.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowResetModal(true)}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Reset…
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
