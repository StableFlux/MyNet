import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { GlassCard } from '../components/GlassCard'
import api from '../lib/api'

const ACTION_COLORS: Record<string, string> = {
  create: '#10b981',
  update: '#3b82f6',
  delete: '#ef4444',
  import: '#6366f1',
  deploy: '#f59e0b',
}

export default function AuditLog() {
  const navigate = useNavigate()
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)
  const limit = 50

  const { data, isLoading } = useQuery({
    queryKey: ['audit', entityType, action, page],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) })
      if (entityType) params.set('entity_type', entityType)
      if (action) params.set('action', action)
      const { data } = await api.get(`/audit?${params}`)
      return data
    },
  })

  const entries = data?.entries ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Audit Log</h1>
        <p className="text-sm text-white/40 mt-0.5">{total} entries</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(0) }}
          className="glass-input text-sm">
          <option value="" className="bg-surface-overlay">All entities</option>
          <option value="device" className="bg-surface-overlay">Device</option>
          <option value="network" className="bg-surface-overlay">Network</option>
          <option value="nic" className="bg-surface-overlay">NIC</option>
        </select>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(0) }}
          className="glass-input text-sm">
          <option value="" className="bg-surface-overlay">All actions</option>
          <option value="create" className="bg-surface-overlay">Create</option>
          <option value="update" className="bg-surface-overlay">Update</option>
          <option value="delete" className="bg-surface-overlay">Delete</option>
          <option value="import" className="bg-surface-overlay">Import</option>
          <option value="deploy" className="bg-surface-overlay">Deploy</option>
        </select>
      </div>

      <GlassCard padding="none">
        {isLoading ? (
          <div className="p-5 animate-pulse space-y-3">
            {Array.from({length: 8}).map((_,i) => <div key={i} className="h-10 bg-white/5 rounded" />)}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-center py-12 text-white/30 text-sm">No audit entries</p>
        ) : (
          <div className="divide-y divide-glass-border">
            {entries.map((e: any) => (
              <div key={e.id} className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <span
                  className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded flex-shrink-0"
                  style={{
                    color: ACTION_COLORS[e.action] ?? '#64748b',
                    backgroundColor: `${ACTION_COLORS[e.action] ?? '#64748b'}22`,
                  }}
                >
                  {e.action}
                </span>

                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => e.entity_id && navigate(`/${e.entity_type}s/${e.entity_id}`)}
                    className="text-sm text-white hover:text-indigo-300 transition-colors text-left truncate block"
                  >
                    {e.entity_name ?? `${e.entity_type} #${e.entity_id}`}
                  </button>
                  {e.changed_fields && (
                    <p className="text-[10px] text-white/30 truncate">
                      Changed: {e.changed_fields.join(', ')}
                    </p>
                  )}
                </div>

                <div className="text-right text-xs flex-shrink-0">
                  <p className="text-white/50">{e.username ?? 'system'}</p>
                  <p className="text-white/25">{new Date(e.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {total > limit && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="btn-ghost text-sm">Previous</button>
          <span className="text-sm text-white/40">Page {page + 1}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}
            className="btn-ghost text-sm">Next</button>
        </div>
      )}
    </div>
  )
}
