import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Download, CheckSquare, Square, ChevronDown, ChevronRight } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import api from '../lib/api'

const EXTRA_COLS = [
  { key: 'mynet_url',    label: 'MyNet URL'   },
  { key: 'ip',          label: 'IP Address'  },
  { key: 'hostname',    label: 'Hostname'    },
  { key: 'location',    label: 'Location'    },
  { key: 'brand',       label: 'Brand/Model' },
  { key: 'service_urls', label: 'Service URLs'},
] as const

type ExtraCol = typeof EXTRA_COLS[number]['key']

export default function LabelExport() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [includeStatuses, setIncludeStatuses] = useState<Set<string>>(new Set(['in_service']))
  const [extraCols, setExtraCols] = useState<Set<ExtraCol>>(new Set(['mynet_url'] as ExtraCol[]))

  const { data: devices = [], isLoading: devicesLoading } = useQuery<any[]>({
    queryKey: ['devices-all'],
    queryFn: async () => { const { data } = await api.get('/devices'); return data },
  })

  const { data: deviceTypes = [], isLoading: typesLoading } = useQuery<any[]>({
    queryKey: ['device-types'],
    queryFn: async () => { const { data } = await api.get('/device-types'); return data },
  })

  const grouped = useMemo(() => {
    if (!devices.length || !deviceTypes.length) return []
    const typeMap = Object.fromEntries((deviceTypes as any[]).map((dt: any) => [dt.id, dt]))
    const enriched = (devices as any[])
      .filter((d: any) => includeStatuses.has(d.status))
      .map((d: any) => ({
        ...d,
        category: typeMap[d.device_type_id]?.category ?? 'Uncategorised',
        primaryIp: d.nics?.find((n: any) => n.ip_address)?.ip_address ?? '',
      }))
    enriched.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    const groups: Record<string, any[]> = {}
    for (const d of enriched) {
      if (!groups[d.category]) groups[d.category] = []
      groups[d.category].push(d)
    }
    return Object.entries(groups)
  }, [devices, deviceTypes, includeStatuses])

  const allIds = useMemo(() => grouped.flatMap(([, devs]) => devs.map((d: any) => d.id)), [grouped])

  const toggleDevice = (id: number) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const toggleCategory = (ids: number[]) => {
    const allIn = ids.every(id => selected.has(id))
    setSelected(prev => { const next = new Set(prev); ids.forEach(id => allIn ? next.delete(id) : next.add(id)); return next })
  }

  const toggleExtraCol = (col: ExtraCol) => {
    setExtraCols(prev => { const next = new Set(prev); next.has(col) ? next.delete(col) : next.add(col); return next })
  }

  const toggleStatus = (key: string) => {
    setIncludeStatuses(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }

  const toggleCollapse = (category: string) => {
    setCollapsed(prev => { const next = new Set(prev); next.has(category) ? next.delete(category) : next.add(category); return next })
  }

  const getExtra = (d: any, col: ExtraCol) => {
    if (col === 'mynet_url')    return `${window.location.origin}/devices/${d.id}`
    if (col === 'ip')           return (d.nics ?? []).map((n: any) => n.ip_address).filter(Boolean).join(', ')
    if (col === 'hostname')     return d.hostname ?? ''
    if (col === 'location')     return d.location ?? ''
    if (col === 'brand')        return [d.brand, d.model].filter(Boolean).join(' ')
    if (col === 'service_urls') return (d.services ?? []).filter((s: any) => s.url).map((s: any) => s.url).join(', ')
    return ''
  }

  const downloadCsv = () => {
    const activeCols = EXTRA_COLS.filter(c => extraCols.has(c.key))
    const header = ['Name', ...activeCols.map(c => c.label)]
    const rows = [header]
    for (const [, devs] of grouped) {
      for (const d of devs) {
        if (!selected.has(d.id)) continue
        rows.push([d.name, ...activeCols.map(c => getExtra(d, c.key))])
      }
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'mynet_labels.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // Build dynamic grid template: checkbox + name + active extra cols
  const colCount = 1 + extraCols.size
  const gridCols = `2rem repeat(${colCount}, 1fr)`

  const isLoading = devicesLoading || typesLoading

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/settings')} className="btn-ghost p-2" aria-label="Back">
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Label CSV Export</h1>
            <p className="text-sm text-white/40 mt-0.5">Select devices to include in the export</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-white/40">{selected.size} of {allIds.length} selected</span>
          <button type="button" onClick={downloadCsv} disabled={selected.size === 0}
            className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={14} /> Download CSV
          </button>
        </div>
      </div>

      <GlassCard>
        <div className="flex flex-wrap gap-x-8 gap-y-4 divide-x divide-glass-border">
          {/* Status filters */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Include Status</p>
            <div className="flex items-center gap-4">
              {([
                { key: 'in_service',     label: 'In Service'     },
                { key: 'stock',          label: 'Stock'          },
                { key: 'undeployed',     label: 'Undeployed'     },
                { key: 'decommissioned', label: 'Decommissioned' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <button type="button" onClick={() => toggleStatus(key)}
                    className={includeStatuses.has(key) ? 'text-indigo-400' : 'text-white/25'}>
                    {includeStatuses.has(key) ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  <span className="text-sm text-white/60">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Extra column toggles */}
          <div className="space-y-1.5 pl-8">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Include Details</p>
            <div className="flex items-center gap-4">
              {EXTRA_COLS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <button type="button" onClick={() => toggleExtraCol(key)}
                    className={extraCols.has(key) ? 'text-indigo-400' : 'text-white/25'}>
                    {extraCols.has(key) ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  <span className="text-sm text-white/60">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Select all / clear */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setSelected(new Set(allIds))}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">Select all</button>
        <span className="text-white/20">·</span>
        <button type="button" onClick={() => setSelected(new Set())}
          className="text-sm text-white/40 hover:text-white/60 transition-colors">Clear all</button>
      </div>

      {/* Device list */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 glass-card rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, devs]) => {
            const catIds = devs.map((d: any) => d.id)
            const allIn = catIds.every((id: number) => selected.has(id))
            const someIn = catIds.some((id: number) => selected.has(id))
            const selectedCount = catIds.filter((id: number) => selected.has(id)).length
            const isCollapsed = collapsed.has(category)

            return (
              <GlassCard key={category} padding="none">
                {/* Category header */}
                <div className="flex items-center border-b border-glass-border">
                  <button type="button" onClick={() => toggleCategory(catIds)}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.03] transition-colors text-left flex-1">
                    <div className="text-indigo-400">
                      {allIn ? <CheckSquare size={15} /> : someIn ? <CheckSquare size={15} className="opacity-50" /> : <Square size={15} className="text-white/25" />}
                    </div>
                    <span className="text-sm font-semibold text-white">{category}</span>
                    <span className="text-xs text-white/30 ml-auto">
                      {selectedCount > 0 ? `${selectedCount} / ` : ''}{catIds.length} device{catIds.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                  <button type="button" onClick={() => toggleCollapse(category)}
                    className="px-4 py-3.5 text-white/30 hover:text-white/60 transition-colors border-l border-glass-border"
                    aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {!isCollapsed && <>
                  {/* Column headers */}
                  <div className="grid gap-x-4 px-5 py-1.5 border-b border-glass-border bg-white/[0.02]"
                    style={{ gridTemplateColumns: gridCols }}>
                    <div />
                    <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Name</span>
                    {EXTRA_COLS.filter(c => extraCols.has(c.key)).map(c => (
                      <span key={c.key} className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{c.label}</span>
                    ))}
                  </div>

                  {/* Devices */}
                  <div className="divide-y divide-glass-border/50">
                    {devs.map((d: any) => {
                      const isSelected = selected.has(d.id)
                      return (
                        <button key={d.id} type="button" onClick={() => toggleDevice(d.id)}
                          className="w-full grid gap-x-4 items-center px-5 py-2.5 hover:bg-white/[0.02] transition-colors text-left"
                          style={{ gridTemplateColumns: gridCols }}>
                          <div className={isSelected ? 'text-indigo-400' : 'text-white/25'}>
                            {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                          </div>
                          <span className={`text-sm truncate ${isSelected ? 'text-white' : 'text-white/60'}`}>{d.name}</span>
                          {EXTRA_COLS.filter(c => extraCols.has(c.key)).map(c => (
                            <span key={c.key} className={`text-xs truncate ${isSelected ? 'text-white/60' : 'text-white/25'}`}>
                              {getExtra(d, c.key)}
                            </span>
                          ))}
                        </button>
                      )
                    })}
                  </div>
                </>}
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
