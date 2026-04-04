import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, LayoutGrid, List, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { DeviceTypeIcon, HARDWARE_TYPE_ICON } from '../components/DeviceTypeIcon'
import api from '../lib/api'

const CARD_GRID = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'

const STATUS_COLOR: Record<string, string> = {
  up: '#10b981',
  down: '#ef4444',
  timeout: '#f59e0b',
  unknown: '#64748b',
}

function statusColor(status: string) {
  return STATUS_COLOR[status] ?? '#64748b'
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function NicRow({ nic, deviceId }: { nic: any; deviceId: number }) {
  const color = statusColor(nic.status)
  const gradId = `nr-${deviceId}-${nic.nic_id}`

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-mono text-white/50 w-24 truncate flex-shrink-0">{nic.ip}</span>
      {nic.nic_label && (
        <span className="text-[10px] text-white/30 truncate min-w-0">{nic.nic_label}</span>
      )}
      {nic.network_name && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ color: nic.network_color, backgroundColor: `${nic.network_color ?? '#64748b'}22` }}
        >
          {nic.network_name}
        </span>
      )}
      <span className="text-[10px] font-mono text-white/40 w-14 text-right flex-shrink-0 ml-auto">
        {nic.status === 'up' && nic.latency_ms != null ? `${nic.latency_ms}ms` : nic.status}
      </span>
      {nic.sparkline && nic.sparkline.length > 1 && (
        <div className="h-5 w-16 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={nic.sparkline} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="latency"
                stroke={color}
                strokeWidth={1}
                fill={`url(#${gradId})`}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function DeviceMonitorCard({ d }: { d: any }) {
  const navigate = useNavigate()
  const color = statusColor(d.status)
  const gradId = `mc-${d.device_id}`

  return (
    <div
      className="glass-card p-5 space-y-3 cursor-pointer glass-card-interactive"
      onClick={() => navigate(`/devices/${d.device_id}`)}
      style={{
        borderTopColor: `${color}66`,
        background: `linear-gradient(160deg, color-mix(in srgb, ${color} 8%, #1d2540) 0%, #151b2e 55%)`,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}18`, border: `1px solid ${color}33` }}
        >
          <DeviceTypeIcon name={d.device_type_icon ?? HARDWARE_TYPE_ICON[d.hardware_type]} size={16} style={{ color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${d.status === 'up' ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: color,
                boxShadow: d.status === 'up' ? `0 0 6px ${color}` : undefined,
              }}
            />
            <p className="text-sm font-semibold text-white truncate">{d.device_name}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {(d.device_type || d.hardware_type) && <span className="text-[10px] text-white/30">{d.device_type ?? d.hardware_type}</span>}
            {(d.device_type || d.hardware_type) && d.location && <span className="text-[10px] text-white/15">·</span>}
            {d.location && <span className="text-[10px] text-white/20">{d.location}</span>}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          {d.status === 'up' && d.latency_ms != null ? (
            <p className="text-sm font-mono text-white">{d.latency_ms}ms</p>
          ) : (
            <p className="text-xs capitalize font-medium" style={{ color }}>{d.status}</p>
          )}
        </div>
      </div>

      {/* Main sparkline chart */}
      {d.sparkline && d.sparkline.length > 1 && (
        <div className="h-14 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={d.sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const val = payload[0].value
                  return (
                    <div className="text-[10px] bg-[#1d2540] border border-white/10 rounded px-2 py-1 text-white/70">
                      {val != null ? `${val}ms` : 'offline'}
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="latency"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#${gradId})`}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs font-medium text-white">
            {d.uptime_pct != null ? `${d.uptime_pct}%` : '—'}
          </p>
          <p className="text-[10px] text-white/30">uptime</p>
        </div>
        <div>
          <p className="text-xs font-mono text-white">
            {d.avg_latency != null ? `${d.avg_latency}ms` : '—'}
          </p>
          <p className="text-[10px] text-white/30">avg latency</p>
        </div>
        <div>
          <p className="text-xs text-white">{relativeTime(d.last_seen)}</p>
          <p className="text-[10px] text-white/30">last seen</p>
        </div>
      </div>

      {/* Per-NIC rows — only shown when multiple NICs are monitored */}
      {d.nics && d.nics.length > 1 && (
        <div className="border-t border-glass-border pt-3 space-y-2">
          {d.nics.map((nic: any) => (
            <NicRow key={nic.nic_id ?? nic.ip} nic={nic} deviceId={d.device_id} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Monitoring() {
  const [viewMode, setViewMode] = useState<'grouped' | 'grid'>(() => {
    try { return (JSON.parse(sessionStorage.getItem('monitoring-view') ?? '{}').viewMode ?? 'grouped') } catch { return 'grouped' }
  })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(sessionStorage.getItem('monitoring-collapsed') ?? '{}') } catch { return {} }
  })

  const saveViewMode = (mode: 'grouped' | 'grid') => {
    setViewMode(mode)
    sessionStorage.setItem('monitoring-view', JSON.stringify({ viewMode: mode }))
  }

  const saveCollapsed = (next: Record<string, boolean>) => {
    setCollapsed(next)
    sessionStorage.setItem('monitoring-collapsed', JSON.stringify(next))
  }

  const { data: summary } = useQuery({
    queryKey: ['monitoring', 'summary'],
    queryFn: async () => { const { data } = await api.get('/monitoring/summary'); return data },
    refetchInterval: 30_000,
  })

  const { data: devices, isLoading } = useQuery({
    queryKey: ['monitoring', 'devices'],
    queryFn: async () => { const { data } = await api.get('/monitoring/devices'); return data },
    refetchInterval: 30_000,
  })

  const totalOnline = summary?.reduce((n: number, s: any) => n + s.online, 0) ?? 0
  const totalDevices = summary?.reduce((n: number, s: any) => n + s.total, 0) ?? 0

  // Group by primary network (first NIC's network_name)
  const groups = useMemo(() => {
    if (!devices) return []
    const map = new Map<string, { color: string | null; devices: any[] }>()
    for (const d of devices) {
      const net = d.nics?.[0]?.network_name ?? 'Unassigned'
      const color = d.nics?.[0]?.network_color ?? null
      if (!map.has(net)) map.set(net, { color, devices: [] })
      map.get(net)!.devices.push(d)
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, { color, devices }]) => ({ name, color, devices }))
  }, [devices])

  const allCollapsed = groups.length > 0 && groups.every(g => collapsed[g.name])
  const anyCollapsed = groups.some(g => collapsed[g.name])

  const collapseAll = () => {
    const next: Record<string, boolean> = {}
    for (const g of groups) next[g.name] = true
    saveCollapsed(next)
  }
  const expandAll = () => saveCollapsed({})

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Monitoring</h1>
        <p className="text-sm text-white/40 mt-0.5">
          {totalDevices > 0 ? `${totalOnline} of ${totalDevices} devices online` : 'Ping availability by network'}
        </p>
      </div>

      {/* Network summary tiles */}
      {summary && summary.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {summary.map((stat: any) => {
            const uptimePct = stat.total > 0 ? Math.round((stat.online / stat.total) * 100) : 0
            const hasOffline = stat.offline > 0
            return (
              <div
                key={stat.network_id}
                className="glass-card px-4 py-2.5 flex items-center gap-4 flex-shrink-0 transition-all"
                style={hasOffline ? {
                  borderColor: '#ef444455',
                  background: 'linear-gradient(160deg, color-mix(in srgb, #ef4444 8%, #1d2540) 0%, #151b2e 60%)',
                } : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: hasOffline ? '#ef4444' : stat.color }} />
                  <span className="text-xs font-medium text-white">{stat.network_name}</span>
                </div>
                <p className="text-sm font-bold text-white">
                  {stat.online}<span className="text-xs font-normal text-white/30">/{stat.total}</span>
                </p>
                <div className="w-20 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${uptimePct}%`, backgroundColor: stat.color }} />
                </div>
                {stat.offline > 0 && (
                  <span className="text-[10px] text-red-400">{stat.offline} offline</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* View mode toggle + collapse controls */}
      {!isLoading && devices && devices.length > 0 && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 divide-x divide-white/10">
            {([
              { value: 'grouped', icon: List,       label: 'Grouped' },
              { value: 'grid',    icon: LayoutGrid,  label: 'Grid'    },
            ] as const).map(({ value, icon: Icon, label }) => (
              <label key={value} className="flex items-center gap-2 cursor-pointer select-none first:pr-4">
                <button type="button" onClick={() => saveViewMode(value)}
                  className={viewMode === value ? 'text-indigo-400' : 'text-white/25'}>
                  <Icon size={14} />
                </button>
                <span className="text-sm text-white/60">{label}</span>
              </label>
            ))}
          </div>

          {viewMode === 'grouped' && (
            <div className="ml-auto flex items-center gap-1">
              {anyCollapsed && (
                <button type="button" onClick={expandAll}
                  className="btn-ghost flex items-center gap-1.5 text-xs text-white/40">
                  <ChevronsUpDown size={12} /> Expand all
                </button>
              )}
              {!allCollapsed && (
                <button type="button" onClick={collapseAll}
                  className="btn-ghost flex items-center gap-1.5 text-xs text-white/40">
                  <ChevronsDownUp size={12} /> Collapse all
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className={CARD_GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card p-5 h-52 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!devices || devices.length === 0) && (
        <div className="text-center py-16 text-white/30">
          <Activity size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No devices being monitored</p>
          <p className="text-xs text-white/20 mt-1">Enable monitoring on a device to see it here</p>
        </div>
      )}

      {/* Grid view */}
      {!isLoading && devices && devices.length > 0 && viewMode === 'grid' && (
        <div className={CARD_GRID}>
          {devices.map((d: any) => (
            <DeviceMonitorCard key={d.device_id} d={d} />
          ))}
        </div>
      )}

      {/* Grouped view */}
      {!isLoading && devices && devices.length > 0 && viewMode === 'grouped' && (
        <div className="space-y-4">
          {groups.map(({ name, color, devices: groupDevices }) => {
            const isCollapsed = collapsed[name]
            const offlineCount = groupDevices.filter(d => d.status !== 'up').length
            return (
              <div key={name}>
                <button
                  type="button"
                  onClick={() => saveCollapsed({ ...collapsed, [name]: !collapsed[name] })}
                  className="w-full flex items-center gap-2 mb-3 group"
                >
                  {color && (
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                  )}
                  <span className="text-sm font-bold text-white/70 group-hover:text-white/90 transition-colors">
                    {name}
                  </span>
                  <span className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded-full">
                    {groupDevices.length}
                  </span>
                  {offlineCount > 0 && (
                    <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                      {offlineCount} offline
                    </span>
                  )}
                  <span className="flex-1 h-px bg-white/[0.08]" />
                  {isCollapsed
                    ? <ChevronRight size={14} className="text-white/30 group-hover:text-white/50 transition-colors" />
                    : <ChevronDown size={14} className="text-white/30 group-hover:text-white/50 transition-colors" />}
                </button>

                {!isCollapsed && (
                  <div className={CARD_GRID}>
                    {groupDevices.map((d: any) => (
                      <DeviceMonitorCard key={d.device_id} d={d} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
