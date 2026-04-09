import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload, AlertTriangle, CheckCircle, Loader, ChevronLeft } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import api from '../lib/api'

export default function Backup() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: any } | null>(null)

  const handleExport = async () => {
    try {
      const resp = await api.get('/backup/export', { responseType: 'blob' })
      const blob = new Blob([resp.data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '')
      a.download = `mynet-backup-${ts}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.response?.data?.detail ?? 'Export failed — check you are logged in as an admin.')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (!confirm(
      'This will REPLACE all current data (devices, networks, NICs, topology, relationships) ' +
      'with the contents of the backup file.\n\nAre you sure?'
    )) return

    setImporting(true)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/backup/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const r = data.restored
      setResult({
        ok: true,
        message: 'Restore complete',
        detail: r,
      })
      qc.invalidateQueries()
    } catch (err: any) {
      setResult({
        ok: false,
        message: err.response?.data?.detail ?? 'Import failed',
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => navigate('/settings')} className="btn-ghost flex items-center gap-1.5 text-sm">
          <ChevronLeft size={14} />
          Settings
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">Backup & Restore</h1>
          <p className="text-sm text-white/40 mt-0.5">Export all data or restore from a previous backup</p>
        </div>
      </div>

      {/* JSON Export */}
      <GlassCard>
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">JSON Export</h3>
        <p className="text-sm text-white/60 mb-3">
          Downloads a complete JSON backup of all networks, devices, users, and settings.
          Encryption keys are never included.
        </p>
        <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400/80">
            Backup files contain <strong className="text-amber-400">sensitive data</strong> including user account hashes and device credentials. Store backups securely and never share them.
          </p>
        </div>
        <button type="button" onClick={handleExport} className="btn-primary flex items-center gap-2">
          <Download size={15} /> Download JSON Backup
        </button>
      </GlassCard>

      {/* Import */}
      <GlassCard>
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">Restore</h3>
        <div className="flex items-start gap-2 mb-4">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-400/80">
            Restoring will <strong className="text-amber-400">permanently replace</strong> all current
            data with the contents of the backup file. This cannot be undone.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          aria-label="Choose backup file to restore"
          className="hidden"
          onChange={handleImport}
        />
        <button
          type="button"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
          className="btn-ghost flex items-center gap-2 border border-glass-border"
        >
          {importing
            ? <><Loader size={15} className="animate-spin" /> Restoring…</>
            : <><Upload size={15} /> Choose Backup File…</>}
        </button>
      </GlassCard>

      {/* Result */}
      {result && (
        <GlassCard className={result.ok ? 'border-emerald-500/30' : 'border-red-500/30'}>
          <div className="flex items-start gap-3">
            {result.ok
              ? <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              : <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />}
            <div>
              <p className={`text-sm font-medium ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {result.message}
              </p>
              {result.ok && result.detail && (
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-white/50">
                  {Object.entries(result.detail).map(([k, v]) => (
                    <span key={k}>{k.replace('_', ' ')}: <span className="text-white/70">{String(v)}</span></span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  )
}
