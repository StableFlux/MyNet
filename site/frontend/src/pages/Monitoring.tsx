import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, LayoutGrid, List, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Globe } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { DeviceTypeIcon, HARDWARE_TYPE_ICON, NIC_TYPE_ICON } from '../components/DeviceTypeIcon'
import { useColorSettings } from '../hooks/useColorSettings'
import api from '../lib/api'

const CARD_GRID = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3'

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
  const lineColor = nic.network_color ?? color
  const gradId = `nr-${deviceId}-${nic.nic_id}`
  const NicIcon = NIC_TYPE_ICON[nic.nic_type?.toUpperCase()] ?? NIC_TYPE_ICON.ETH

  return (
    <div className="flex items-center gap-1.5 overflow-hidden">
      {/* Status dot */}
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      {/* NIC type icon + IP */}
      <div className="flex items-center gap-1 w-20 flex-shrink-0 min-w-0">
        <NicIcon size={10} className="flex-shrink-0 text-white/25" />
        <span className="text-[10px] font-mono text-white/50 truncate">{nic.ip}</span>
      </div>
      {/* VLAN badge */}
      <div className="flex-1 min-w-0">
        {nic.network_name && (
          <span className="text-[10px] px-1.5 py-0.5 rounded truncate block w-fit max-w-full"
            style={{ color: nic.network_color, backgroundColor: `${nic.network_color ?? '#64748b'}22` }}>
            {nic.network_name}
          </span>
        )}
      </div>
      {/* Uptime */}
      <span className="text-[10px] font-mono text-white/40 w-9 flex-shrink-0 text-right">
        {nic.uptime_pct != null ? `${nic.uptime_pct}%` : '—'}
      </span>
      {/* Latency */}
      <span className="text-[10px] font-mono text-white/40 w-10 flex-shrink-0 text-right">
        {nic.status === 'up' && nic.latency_ms != null ? `${nic.latency_ms}ms` : nic.status}
      </span>
      {/* Sparkline */}
      <div className="h-5 w-12 flex-shrink-0">
        {nic.sparkline && nic.sparkline.length > 1 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={nic.sparkline} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="latency" stroke={lineColor} strokeWidth={1}
                fill={`url(#${gradId})`} dot={false} isAnimationActive={false} connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function WanConnectionCard({ wan, wanColor }: { wan: any; wanColor: string }) {
  const navigate = useNavigate()
  const color = statusColor(wan.status)
  const gradId = `wan-${wan.device_id}-${wan.switch_port_id ?? wan.ip.replace(/\./g, '-')}`
  const ispLabel = wan.nic_label?.replace(/^WAN\s*[–-]\s*/i, '').trim() || null

  return (
    <div
      className="glass-card p-4 cursor-pointer glass-card-interactive flex items-center gap-4"
      onClick={() => navigate(`/devices/${wan.device_id}`)}
      style={{
        borderLeftColor: `${color}66`,
        borderLeftWidth: 2,
        background: `linear-gradient(160deg, color-mix(in srgb, ${color} 6%, var(--card-base-mid)) 0%, var(--card-base-deep) 60%)`,
      }}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}18`, border: `1px solid ${color}33` }}>
        <Globe size={15} style={{ color: wanColor }} />
      </div>

      {/* ISP + device + ping target */}
      <div className="flex-shrink-0 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wan.status === 'up' ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: color, boxShadow: wan.status === 'up' ? `0 0 5px ${color}` : undefined }}
          />
          <p className="text-sm font-semibold text-white truncate">{ispLabel || wan.ip}</p>
        </div>
        <p className="text-[10px] text-white/30 truncate mt-0.5 pl-3">{wan.device_name}</p>
        <p className="text-[10px] font-mono text-white/25 truncate mt-0.5 pl-3">{wan.ip}</p>
      </div>

      {/* Sparkline — fills remaining space */}
      <div className="flex-1 h-14 min-w-0">
        {wan.sparkline && wan.sparkline.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={wan.sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const val = payload[0].value
                  return (
                    <div className="text-[10px] bg-surface-overlay border border-white/10 rounded px-2 py-1 text-white/70">
                      {val != null ? `${val}ms` : 'offline'}
                    </div>
                  )
                }}
              />
              <Area type="monotone" dataKey="latency" stroke={color} strokeWidth={1.5}
                fill={`url(#${gradId})`} dot={false} isAnimationActive={false} connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center">
            <div className="w-full h-px bg-white/5" />
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 flex-shrink-0 text-right">
        <div>
          <p className="text-sm font-mono text-white">
            {wan.status === 'up' && wan.latency_ms != null ? `${wan.latency_ms}ms` : '—'}
          </p>
          <p className="text-[10px] text-white/30">latency</p>
        </div>
        <div>
          <p className="text-sm font-mono text-white">{wan.avg_latency != null ? `${wan.avg_latency}ms` : '—'}</p>
          <p className="text-[10px] text-white/30">avg</p>
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color }}>
            {wan.uptime_pct != null ? `${wan.uptime_pct}%` : wan.status}
          </p>
          <p className="text-[10px] text-white/30">uptime</p>
        </div>
      </div>
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
        background: `linear-gradient(160deg, color-mix(in srgb, ${color} 8%, var(--card-base-mid)) 0%, var(--card-base-deep) 55%)`,
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

        <div className="flex items-start gap-4 flex-shrink-0">
          {d.avg_latency != null && (
            <div className="text-right">
              <p className="text-xs font-mono text-white/60">{d.avg_latency}ms</p>
              <p className="text-[10px] text-white/25">avg latency</p>
            </div>
          )}
          <div className="text-right">
            <p className="text-xs text-white/60">{relativeTime(d.last_seen)}</p>
            <p className="text-[10px] text-white/25">last seen</p>
          </div>
        </div>

      </div>

      {/* Main sparkline chart — single filled area for one NIC, coloured lines for multiple */}
      {(() => {
        const lanNics = (d.nics ?? []).filter((n: any) => !n.is_wan_ping)
        const multiNic = lanNics.length > 1

        if (!multiNic) {
          if (!d.sparkline || d.sparkline.length <= 1) return null
          const lineColor = lanNics[0]?.network_color ?? color
          return (
            <div className="h-14 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={lineColor} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" hide />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const val = payload[0].value
                    return <div className="text-[10px] bg-surface-overlay border border-white/10 rounded px-2 py-1 text-white/70">{val != null ? `${val}ms` : 'offline'}</div>
                  }} />
                  <Area type="monotone" dataKey="latency" stroke={lineColor} strokeWidth={1.5}
                    fill={`url(#${gradId})`} dot={false} isAnimationActive={false} connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )
        }

        // Merge per-NIC sparklines onto a shared time axis
        const allTs = new Set<string>()
        for (const nic of lanNics) for (const pt of (nic.sparkline ?? [])) allTs.add(pt.t)
        const timestamps = Array.from(allTs).sort()
        if (timestamps.length <= 1) return null

        const nicMaps = lanNics.map((nic: any) => {
          const m = new Map<string, number | null>()
          for (const pt of (nic.sparkline ?? [])) m.set(pt.t, pt.latency)
          return m
        })
        const chartData = timestamps.map(t => {
          const pt: any = { t }
          nicMaps.forEach((m: Map<string, number | null>, i: number) => { pt[`l${i}`] = m.get(t) ?? null })
          return pt
        })

        return (
          <div className="h-14 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" hide />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="text-[10px] bg-surface-overlay border border-white/10 rounded px-2 py-1 space-y-0.5">
                      {payload.map((p: any, i: number) => (
                        <div key={i} style={{ color: p.stroke }}>
                          {lanNics[i]?.network_name ?? `NIC ${i + 1}`}: {p.value != null ? `${p.value}ms` : 'offline'}
                        </div>
                      ))}
                    </div>
                  )
                }} />
                {lanNics.map((nic: any, i: number) => (
                  <Line key={i} type="monotone" dataKey={`l${i}`}
                    stroke={nic.network_color ?? color} strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )
      })()}

      {/* Per-NIC rows — LAN only */}
      {(() => {
        const lanNics = (d.nics ?? []).filter((n: any) => !n.is_wan_ping)
        return lanNics.length > 0 ? (
          <div className="border-t border-glass-border pt-3 space-y-2">
            {lanNics.map((nic: any) => (
              <NicRow key={nic.nic_id ?? nic.ip} nic={nic} deviceId={d.device_id} />
            ))}
          </div>
        ) : null
      })()}
    </div>
  )
}

export default function Monitoring() {
  const [viewMode, setViewMode] = useState<'grouped' | 'grid'>(() => {
    try { return (JSON.parse(sessionStorage.getItem('monitoring-view') ?? '{}').viewMode ?? 'grid') } catch { return 'grid' }
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

  const { wanPortColor } = useColorSettings()

  const { data: summary } = useQuery({
    queryKey: ['monitoring', 'summary'],
    queryFn: async () => { const { data } = await api.get('/monitoring/summary'); return data },
    refetchInterval: 60_000,
    staleTime: 60_000,
  })

  const { data: devices, isLoading } = useQuery({
    queryKey: ['monitoring', 'devices'],
    queryFn: async () => { const { data } = await api.get('/monitoring/devices'); return data },
    refetchInterval: 60_000,
    staleTime: 60_000,
  })

  const totalOnline = summary?.reduce((n: number, s: any) => n + s.online, 0) ?? 0
  const totalDevices = summary?.reduce((n: number, s: any) => n + s.total, 0) ?? 0

  // Extract WAN connections from all device NIC lists
  const wanConnections = useMemo(() => {
    if (!devices) return []
    const result: any[] = []
    for (const d of devices) {
      for (const nic of (d.nics ?? [])) {
        if (nic.is_wan_ping) {
          result.push({ ...nic, device_id: d.device_id, device_name: d.device_name })
        }
      }
    }
    return result.sort((a, b) => {
      // Offline first, then by ISP label
      const aDown = a.status !== 'up' ? 0 : 1
      const bDown = b.status !== 'up' ? 0 : 1
      return aDown - bDown || (a.nic_label ?? '').localeCompare(b.nic_label ?? '')
    })
  }, [devices])

  // Group by primary network (first LAN NIC's network_name)
  const groups = useMemo(() => {
    if (!devices) return []
    const map = new Map<string, { color: string | null; devices: any[] }>()
    for (const d of devices) {
      const firstLan = d.nics?.find((n: any) => !n.is_wan_ping)
      const net = firstLan?.network_name ?? 'Unassigned'
      const color = firstLan?.network_color ?? null
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
          {(() => {
            const wanOnline = wanConnections.filter((w: any) => w.status === 'up').length
            const parts = []
            if (wanConnections.length > 0) parts.push(`${wanOnline} of ${wanConnections.length} WAN`)
            if (totalDevices > 0) parts.push(`${totalOnline} of ${totalDevices} LAN`)
            return parts.length > 0 ? `${parts.join(' · ')} online` : 'Ping availability by network'
          })()}
        </p>
      </div>

      {/* WAN Connections */}
      {wanConnections.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} style={{ color: wanPortColor }} />
            <h2 className="text-sm font-semibold text-white">WAN Connections</h2>
            <span className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded-full">
              {wanConnections.filter(w => w.status === 'up').length}/{wanConnections.length} online
            </span>
          </div>
          <div className="space-y-2">
            {wanConnections.map((wan: any) => (
              <WanConnectionCard
                key={`${wan.device_id}-${wan.switch_port_id ?? wan.ip}`}
                wan={wan}
                wanColor={wanPortColor}
              />
            ))}
          </div>
        </div>
      )}

      {/* LAN Monitoring header */}
      {devices && devices.length > 0 && (
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-white/40" />
          <h2 className="text-sm font-semibold text-white">LAN Monitoring</h2>
          <span className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded-full">
            {totalOnline}/{totalDevices} online
          </span>
        </div>
      )}

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
                  background: 'linear-gradient(160deg, color-mix(in srgb, #ef4444 8%, var(--card-base-mid)) 0%, var(--card-base-deep) 60%)',
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
