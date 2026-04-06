import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, CheckCheck, Search, X, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'
import { SEVERITY_COLORS, CATEGORY_LABELS } from '../theme/colours'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'

const SEVERITIES = ['critical', 'warning', 'info', 'system']
const CATEGORIES = ['device', 'network', 'monitoring', 'conflict', 'security', 'system']

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border border-red-500/30',
  warning:  'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  info:     'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  system:   'bg-slate-500/15 text-slate-400 border border-slate-500/30',
}

export default function Events() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [severity, setSeverity] = useState(searchParams.get('severity') ?? '')
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [activeOnly, setActiveOnly] = useState(searchParams.get('active_only') === 'true')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 100

  const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) }
  if (search) params.search = search
  if (severity) params.severity = severity
  if (category) params.category = category
  if (activeOnly) params.active_only = 'true'

  const { data } = useQuery({
    queryKey: ['events', params],
    queryFn: async () => { const { data } = await api.get('/events', { params }); return data },
    refetchInterval: 30_000,
  })

  const events: any[] = data?.items ?? []
  const total: number = data?.total ?? 0
  const hasActive = events.some((e: any) => e.is_active)

  const ackMutation = useMutation({
    mutationFn: (id: number) => api.post(`/events/${id}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['events-count'] })
    },
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Failed to resolve event'),
  })

  const ackAllMutation = useMutation({
    mutationFn: () => api.post('/events/acknowledge-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['events-count'] })
    },
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Failed to resolve events'),
  })

  function clearFilters() {
    setSearch(''); setSeverity(''); setCategory(''); setActiveOnly(false); setPage(0)
  }
  const hasFilters = search || severity || category || activeOnly

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Events</h1>
          <p className="text-sm text-white/40 mt-0.5">{total.toLocaleString()} event{total !== 1 ? 's' : ''}</p>
        </div>
        {canEdit && hasActive && (
          <button onClick={() => ackAllMutation.mutate()}
            className="btn-ghost flex items-center gap-2 text-sm">
            <CheckCheck size={14} /> Resolve all active
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input type="text" placeholder="Search messages…" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            className="glass-input w-full pl-8 text-sm py-1.5" />
        </div>
        <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(0) }}
          className="glass-input text-sm py-1.5">
          <option value="">All severities</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}
          className="glass-input text-sm py-1.5">
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none px-2">
          <input type="checkbox" checked={activeOnly}
            onChange={(e) => { setActiveOnly(e.target.checked); setPage(0) }}
            className="accent-indigo-500" />
          Active only
        </label>
        {hasFilters && (
          <button onClick={clearFilters} className="btn-ghost p-1.5 text-white/40 hover:text-white/70" title="Clear filters">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Table */}
      {events.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <Activity size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No events found</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-[10px] font-medium text-white/30 uppercase tracking-wider px-4 py-2.5 w-36">Time</th>
                <th className="text-left text-[10px] font-medium text-white/30 uppercase tracking-wider px-3 py-2.5 w-24">Severity</th>
                <th className="text-left text-[10px] font-medium text-white/30 uppercase tracking-wider px-3 py-2.5 w-24">Category</th>
                <th className="text-left text-[10px] font-medium text-white/30 uppercase tracking-wider px-3 py-2.5 w-28">Entity</th>
                <th className="text-left text-[10px] font-medium text-white/30 uppercase tracking-wider px-3 py-2.5">Message</th>
                <th className="text-left text-[10px] font-medium text-white/30 uppercase tracking-wider px-3 py-2.5 w-24">User</th>
                <th className="text-left text-[10px] font-medium text-white/30 uppercase tracking-wider px-3 py-2.5 w-24">Status</th>
                {canEdit && <th className="w-10 px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {events.map((e: any) => (
                <tr key={e.id}
                  className={`transition-colors hover:bg-white/[0.02] ${e.is_active ? 'bg-white/[0.015]' : ''}`}
                  style={e.is_active ? { borderLeft: `2px solid ${SEVERITY_COLORS[e.severity] ?? '#64748b'}` } : undefined}>
                  {/* Time */}
                  <td className="px-4 py-2.5 text-[11px] text-white/40 whitespace-nowrap font-mono">
                    {new Date(e.created_at).toLocaleString(undefined, {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                    })}
                  </td>
                  {/* Severity */}
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${SEVERITY_BADGE[e.severity] ?? ''}`}>
                      {e.severity}
                    </span>
                  </td>
                  {/* Category */}
                  <td className="px-3 py-2.5 text-[11px] text-white/40 capitalize">
                    {CATEGORY_LABELS[e.category] ?? e.category}
                  </td>
                  {/* Entity */}
                  <td className="px-3 py-2.5">
                    {e.entity_id ? (
                      <button
                        onClick={() => navigate(`/${e.entity_type === 'network' ? 'networks' : 'devices'}/${e.entity_id}`)}
                        className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors truncate max-w-[100px]"
                        title={e.entity_name}>
                        <ExternalLink size={9} className="flex-shrink-0" />
                        <span className="truncate">{e.entity_name ?? e.entity_type}</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-white/20">—</span>
                    )}
                  </td>
                  {/* Message */}
                  <td className="px-3 py-2.5 text-[12px] text-white/80 max-w-xs">
                    <span className="line-clamp-2">{e.message}</span>
                  </td>
                  {/* User */}
                  <td className="px-3 py-2.5 text-[11px] text-white/40 truncate max-w-[90px]">
                    {e.username ?? <span className="text-white/20">system</span>}
                  </td>
                  {/* Status */}
                  <td className="px-3 py-2.5">
                    {e.is_active ? (
                      <span className="text-[10px] font-medium text-amber-400">Active</span>
                    ) : (
                      <span className="text-[10px] text-white/25">
                        {e.resolved_by === 'system' ? 'Auto-resolved' : `Resolved`}
                      </span>
                    )}
                  </td>
                  {/* Resolve action */}
                  {canEdit && (
                    <td className="px-3 py-2.5">
                      {e.is_active && (
                        <button onClick={() => ackMutation.mutate(e.id)}
                          className="p-1 rounded text-white/20 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                          title="Resolve">
                          <CheckCheck size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="btn-ghost flex items-center gap-1 text-sm disabled:opacity-30">
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="text-xs text-white/40">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}
            className="btn-ghost flex items-center gap-1 text-sm disabled:opacity-30">
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
