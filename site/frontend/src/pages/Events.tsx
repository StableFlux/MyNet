import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, CheckCheck, Search, X, ExternalLink, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
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

function shortTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const PAGE_SIZE = 100

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

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
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        {/* Row 1 (mobile): severity + category half-width each */}
        <div className="flex gap-2 sm:contents">
          <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(0) }}
            className="glass-input text-sm py-1.5 flex-1 sm:flex-none">
            <option value="">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}
            className="glass-input text-sm py-1.5 flex-1 sm:flex-none">
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
          </select>
        </div>
        {/* Row 2 (mobile): search + active only */}
        <div className="flex items-center gap-2 sm:contents">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input type="text" placeholder="Search messages…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className="glass-input w-full pl-8 text-sm py-1.5" />
          </div>
          <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none px-2 flex-shrink-0">
            <input type="checkbox" checked={activeOnly}
              onChange={(e) => { setActiveOnly(e.target.checked); setPage(0) }}
              className="accent-indigo-500" />
            Active only
          </label>
          {hasFilters && (
            <button onClick={clearFilters} className="btn-ghost p-1.5 text-white/40 hover:text-white/70 flex-shrink-0" title="Clear filters">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Event list */}
      {events.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <Activity size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No events found</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden p-0 divide-y divide-white/[0.04]">
          {events.map((e: any) => {
            const isExpanded = expandedIds.has(e.id)
            const accentColor = SEVERITY_COLORS[e.severity] ?? '#64748b'

            return (
              <div key={e.id}
                className={e.is_active ? 'bg-white/[0.015]' : ''}
                style={e.is_active ? { borderLeft: `2px solid ${accentColor}` } : undefined}>

                {/* Collapsed row — always visible */}
                <button
                  type="button"
                  onClick={() => toggleExpand(e.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors group"
                >
                  {/* Severity badge */}
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize flex-shrink-0 mt-0.5 ${SEVERITY_BADGE[e.severity] ?? ''}`}>
                    {e.severity}
                  </span>

                  {/* Message */}
                  <span className={`flex-1 text-sm text-white/75 group-hover:text-white/90 transition-colors min-w-0 ${isExpanded ? '' : 'line-clamp-2'}`}>
                    {e.message}
                  </span>

                  {/* Time + chevron */}
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-[11px] text-white/30 font-mono whitespace-nowrap hidden sm:block">
                      {shortTime(e.created_at)}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-white/20 transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {/* Expanded drawer */}
                {isExpanded && (
                  <div className="px-4 pb-3 pt-1 border-t border-white/[0.05]">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
                      <div>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Time</p>
                        <p className="text-xs font-mono text-white/60">{fullTime(e.created_at)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Category</p>
                        <p className="text-xs text-white/60 capitalize">{CATEGORY_LABELS[e.category] ?? e.category}</p>
                      </div>
                      {e.entity_id ? (
                        <div>
                          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Entity</p>
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              navigate(`/${e.entity_type === 'network' ? 'networks' : 'devices'}/${e.entity_id}`)
                            }}
                            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors truncate max-w-full"
                          >
                            <ExternalLink size={10} className="flex-shrink-0" />
                            <span className="truncate">{e.entity_name ?? e.entity_type}</span>
                          </button>
                        </div>
                      ) : (
                        <div>
                          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Entity</p>
                          <p className="text-xs text-white/20">—</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">User</p>
                        <p className="text-xs text-white/60">{e.username ?? <span className="text-white/25">system</span>}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Status</p>
                        {e.is_active ? (
                          <span className="text-xs font-medium text-amber-400">Active</span>
                        ) : (
                          <span className="text-xs text-white/30">
                            {e.resolved_by === 'system' ? 'Auto-resolved' : 'Resolved'}
                          </span>
                        )}
                      </div>
                    </div>

                    {canEdit && e.is_active && (
                      <div className="mt-3 pt-2.5 border-t border-white/[0.05]">
                        <button
                          type="button"
                          onClick={(ev) => { ev.stopPropagation(); ackMutation.mutate(e.id) }}
                          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          <CheckCheck size={12} /> Resolve event
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
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
