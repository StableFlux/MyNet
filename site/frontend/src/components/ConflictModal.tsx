import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, X, ExternalLink, ShieldCheck } from 'lucide-react'
import api from '../lib/api'

export interface Conflict {
  type: 'ip' | 'mac'
  ip?: string
  mac?: string
  nic_id: number
  nic_label: string
  conflicting_device_id: number
  conflicting_device_name: string
  conflicting_nic_label: string
}

interface Props {
  deviceId: number
  conflicts: Conflict[]
  onClose: () => void
}

export function ConflictModal({ deviceId, conflicts, onClose }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const ipConflicts = conflicts.filter(c => c.type === 'ip')
  const macConflicts = conflicts.filter(c => c.type === 'mac')

  async function handleSuppressMac(conflict: Conflict) {
    try {
      await api.post(`/devices/${deviceId}/nics/${conflict.nic_id}/suppress-mac-conflict`)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? 'Failed to suppress conflict')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md glass-card p-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={16} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Address Conflicts Detected</h2>
              <p className="text-xs text-white/40 mt-0.5">Device saved — review the conflicts below</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="text-white/30 hover:text-white/70 transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* IP conflicts */}
        {ipConflicts.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-red-400/70 font-medium">IP Conflicts — Critical</p>
            {ipConflicts.map((c, i) => (
              <div key={i} className="p-3 rounded-lg bg-red-500/[0.07] border border-red-500/20 space-y-2">
                <p className="text-xs text-white/80">
                  <span className="font-mono text-red-300">{c.ip}</span>
                  {' '}on <span className="text-white/60">{c.nic_label}</span>
                  {' '}is also used by{' '}
                  <span className="font-medium text-white">{c.conflicting_device_name}</span>
                  {' '}({c.conflicting_nic_label})
                </p>
                <button
                  type="button"
                  onClick={() => { navigate(`/devices/${c.conflicting_device_id}`); onClose() }}
                  className="flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300 transition-colors"
                >
                  <ExternalLink size={11} /> Go to conflicting device
                </button>
              </div>
            ))}
          </div>
        )}

        {/* MAC conflicts */}
        {macConflicts.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-400/70 font-medium">MAC Conflicts — Warning</p>
            {macConflicts.map((c, i) => (
              <div key={i} className="p-3 rounded-lg bg-amber-500/[0.07] border border-amber-500/20 space-y-2">
                <p className="text-xs text-white/80">
                  <span className="font-mono text-amber-300">{c.mac}</span>
                  {' '}on <span className="text-white/60">{c.nic_label}</span>
                  {' '}is also used by{' '}
                  <span className="font-medium text-white">{c.conflicting_device_name}</span>
                  {' '}({c.conflicting_nic_label})
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSuppressMac(c)}
                    className="flex items-center gap-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    <ShieldCheck size={11} /> Mark as intentional
                  </button>
                  <button
                    type="button"
                    onClick={() => { navigate(`/devices/${c.conflicting_device_id}`); onClose() }}
                    className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <ExternalLink size={11} /> Go to conflicting device
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Dismiss */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white/80 hover:border-white/20 transition-all"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
