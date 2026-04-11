import { useState } from 'react'
import { useResolvedTheme } from '../store/themeStore'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Monitor, Package, Bell, Activity, ChevronRight, Clock, WifiOff,
  Network, X, ScrollText, Server, ShieldAlert, CheckCircle2, AlertTriangle,
  Cpu, MapPin, TrendingUp, Box, Shield,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { GlassCard } from '../components/GlassCard'
import { DEVICE_TYPE_COLORS } from '../theme/colours'

import api from '../lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const eventTypeColors: Record<string, string> = {
  device_created: 'text-emerald-400',
  device_deployed: 'text-sky-400',
  device_updated: 'text-amber-400',
  device_deleted: 'text-red-400',
  device_imported: 'text-purple-400',
  device_offline: 'text-red-400',
  device_recovered: 'text-emerald-400',
  wan_offline: 'text-red-400',
  wan_recovered: 'text-emerald-400',
  network_created: 'text-emerald-400',
  network_updated: 'text-amber-400',
  network_deleted: 'text-red-400',
  ip_conflict: 'text-red-400',
  ip_conflict_resolved: 'text-emerald-400',
  mac_conflict: 'text-amber-400',
  mac_conflict_resolved: 'text-emerald-400',
  mac_conflict_suppressed: 'text-sky-400',
  system_startup: 'text-slate-400',
  backup_created: 'text-slate-400',
  backup_restored: 'text-purple-400',
}
const eventTypeLabels: Record<string, string> = {
  device_created: 'Created', device_updated: 'Updated', device_deleted: 'Deleted',
  device_deployed: 'Deployed', device_imported: 'Imported',
  device_offline: 'Offline', device_recovered: 'Recovered',
  wan_offline: 'WAN Offline', wan_recovered: 'WAN Recovered',
  network_created: 'Created', network_updated: 'Updated', network_deleted: 'Deleted',
  ip_conflict: 'IP Conflict', ip_conflict_resolved: 'Resolved',
  mac_conflict: 'MAC Conflict', mac_conflict_resolved: 'Resolved', mac_conflict_suppressed: 'Suppressed',
  system_startup: 'Startup', backup_created: 'Backup', backup_restored: 'Restored',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ label, value, sub, icon: Icon, color, to, alert }: {
  label: string; value: number | string; sub?: string
  icon: any; color: string; to: string; alert?: boolean
}) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(to)}
      className={`glass-card glass-card-interactive cursor-pointer p-5 flex items-center gap-4 ${alert ? 'border-red-500/40' : ''}`}
      style={alert ? { background: 'var(--bg-status-error)' } : undefined}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}22`, border: `1px solid ${color}44` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-white leading-none">{value}</p>
        <p className="text-xs text-white/40 mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-white/25 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------
function SectionHeader({ title, to, label = 'View all' }: { title: string; to: string; label?: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <button onClick={() => navigate(to)}
        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
        {label} <ChevronRight size={12} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const navigate = useNavigate()
  const [activityOpen, setActivityOpen] = useState(false)
  const isDark = useResolvedTheme() === 'dark'

  const { data: s } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => { const { data } = await api.get('/dashboard'); return data },
    refetchInterval: 60_000,
  })
  const { data: health = [] } = useQuery({
    queryKey: ['monitoring', 'summary'],
    queryFn: async () => { const { data } = await api.get('/monitoring/summary'); return data },
    refetchInterval: 60_000,
  })
  const { data: pihole } = useQuery({
    queryKey: ['pihole', 'dashboard'],
    queryFn: async () => { const { data } = await api.get('/pihole/dashboard'); return data },
    refetchInterval: 300_000,
  })
  const { data: piholeHistory = [] } = useQuery({
    queryKey: ['pihole', 'history'],
    queryFn: async () => { const { data } = await api.get('/pihole/history'); return data },
    refetchInterval: 300_000,
    enabled: !!pihole?.enabled,
  })


  const networks: any[] = s?.networks ?? []
  const activeEventList: any[] = s?.active_event_list ?? []
  const byCategory: any[] = s?.by_category ?? []
  const byBrand: any[] = s?.by_brand ?? []
  const offline: any[] = s?.offline_devices ?? []
  const recentDevices: any[] = s?.recent_devices ?? []
  const activity: any[] = s?.recent_activity ?? []

  const maxCat = Math.max(...byCategory.map((c: any) => c.count), 1)
  const maxBrand = Math.max(...byBrand.map((b: any) => b.count), 1)

  const monitoringOk = (s?.monitoring_online ?? 0) === (s?.monitoring_total ?? 0)
  const monitoringColor = offline.length > 0 ? '#ef4444' : '#10b981'

  const wanAnyDown = (s?.wan_summary?.total ?? 0) > 0 && (s?.wan_summary?.online ?? 0) < (s?.wan_summary?.total ?? 0)
  const hasCritical = offline.length > 0 || (s?.critical_events ?? 0) > 0 || wanAnyDown
  const hasWarning = !hasCritical && (s?.warning_events ?? 0) > 0
  const dashBg = hasCritical
    ? 'var(--bg-status-critical)'
    : hasWarning
    ? 'var(--bg-status-warning)'
    : undefined

  return (
    <div className="space-y-5 -m-6 p-6 min-h-full" style={{ background: dashBg }}>

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-white/40 mt-0.5">Network overview</p>
        </div>
        <button type="button" onClick={() => setActivityOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] hover:border-white/[0.12] transition-all text-sm">
          <ScrollText size={14} />
          Recent Activity
        </button>
      </div>


      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="In Service" value={s?.in_service ?? 0}
          sub={`${s?.decommissioned_count ?? 0} decommissioned`}
          icon={Monitor} color="#6366f1" to="/devices" />
        <StatCard label="Stock" value={(s?.stock_count ?? 0) + (s?.undeployed_count ?? 0)}
          sub={`${s?.stock_count ?? 0} in stock · ${s?.undeployed_count ?? 0} undeployed`}
          icon={Package} color="#f59e0b" to="/stock" />
        <StatCard label="Networks" value={networks.length}
          sub={networks.map((n: any) => n.vlan_id ? `VLAN ${n.vlan_id}` : n.name).slice(0, 3).join(' · ')}
          icon={Network} color="#06b6d4" to="/networks" />
        {/* WAN Monitoring card */}
        {(() => {
          const total = s?.wan_summary?.total ?? 0
          const online = s?.wan_summary?.online ?? 0
          const allUp = total > 0 && online === total
          const anyDown = total > 0 && online < total
          const statusColor = anyDown ? '#ef4444' : total > 0 ? '#10b981' : '#64748b'
          const isps = (s?.wan_summary?.connections ?? []).map((c: any) => c.isp_name).filter(Boolean)
          const sub = total === 0 ? 'No WAN configured' : allUp ? 'All connections online' : `${total - online} offline`
          return (
            <div
              onClick={() => navigate('/monitoring')}
              className={`glass-card glass-card-interactive cursor-pointer p-5 flex items-center gap-4 ${anyDown ? 'border-red-500/40' : ''}`}
              style={anyDown ? { background: 'var(--bg-status-error)' } : undefined}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${statusColor}22`, border: `1px solid ${statusColor}44` }}>
                {anyDown ? <WifiOff size={18} style={{ color: statusColor }} /> : <CheckCircle2 size={18} style={{ color: statusColor }} />}
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-white leading-none">{total === 0 ? '—' : `${online}/${total}`}</p>
                <p className="text-xs text-white/40 mt-0.5">WAN Monitoring</p>
                <p className="text-[10px] text-white/25 mt-0.5 truncate">{isps.length > 0 ? isps.slice(0, 3).join(' · ') : sub}</p>
              </div>
            </div>
          )
        })()}
        <StatCard
          label="LAN Monitoring"
          value={s?.monitoring_total ? `${s.monitoring_online}/${s.monitoring_total}` : '—'}
          sub={monitoringOk ? 'All devices online' : `${offline.length} offline`}
          icon={monitoringOk ? CheckCircle2 : WifiOff}
          color={monitoringColor} to="/monitoring" alert={!monitoringOk} />
        {/* Events card */}
        <div
          onClick={() => navigate('/events?active_only=true')}
          className={`glass-card glass-card-interactive cursor-pointer p-5 flex items-center gap-4 ${hasCritical ? 'border-red-500/40' : hasWarning ? 'border-amber-500/40' : ''}`}
          style={hasCritical ? { background: 'var(--bg-status-error)' } : hasWarning ? { background: 'var(--bg-status-warning)' } : undefined}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${hasCritical ? '#ef4444' : hasWarning ? '#f59e0b' : '#6366f1'}22`, border: `1px solid ${hasCritical ? '#ef4444' : hasWarning ? '#f59e0b' : '#6366f1'}44` }}>
            {hasCritical ? <ShieldAlert size={18} style={{ color: '#ef4444' }} /> : <Bell size={18} style={{ color: hasWarning ? '#f59e0b' : '#6366f1' }} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold text-white leading-none">{s?.active_events ?? 0}</p>
            <p className="text-xs text-white/40 mt-0.5">Active Events</p>
            {activeEventList.length === 0 && (
              <p className="text-[10px] text-white/25 mt-0.5">All clear</p>
            )}
            {activeEventList.length > 0 && (
              <p className="text-[10px] text-white/50 mt-0.5 truncate">
                {activeEventList[0].message}
                {activeEventList.length > 1 && <span className="text-white/25"> · +{activeEventList.length - 1} more</span>}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Main grid: 4-col with Pi-hole, 3-col without ── */}
      <div className={`grid grid-cols-1 gap-5 items-start ${pihole?.enabled ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>

        {/* ── Col 1: Networks (always) + Offline + Health (Pi-hole layout only) ── */}
        <div className="space-y-5">
          {pihole?.enabled && offline.length > 0 && (
            <GlassCard className="border-red-500/20">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <WifiOff size={13} className="text-red-400" />
                  Offline Devices
                  <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full tabular-nums">{offline.length}</span>
                </h2>
                <button onClick={() => navigate('/monitoring')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
                  Monitor <ChevronRight size={12} />
                </button>
              </div>
              <div className="space-y-1.5">
                {offline.map((d: any) => (
                  <button key={d.id} type="button" onClick={() => navigate(`/devices/${d.id}`)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-red-500/[0.06] border border-red-500/15 hover:bg-red-500/10 transition-colors text-left">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
                    <span className="text-sm text-white/80 flex-1 truncate">{d.name}</span>
                    <span className="text-[10px] text-white/30 flex-shrink-0">{timeAgo(d.last_seen)}</span>
                  </button>
                ))}
              </div>
            </GlassCard>
          )}
          {pihole?.enabled && health.length > 0 && (
            <GlassCard>
              <SectionHeader title="Monitoring Health" to="/monitoring" />
              <div className="space-y-2">
                {health.map((stat: any) => {
                  const pct = stat.total > 0 ? Math.round(((stat.total - stat.offline) / stat.total) * 100) : 100
                  const allOk = stat.offline === 0
                  return (
                    <div key={stat.network_id}
                      className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: stat.color }} />
                          <span className="text-xs text-white/70 truncate">{stat.network_name}</span>
                        </div>
                        <span className={`text-xs font-medium ${allOk ? 'text-emerald-400' : 'text-red-400'}`}>
                          {allOk ? 'All OK' : `${stat.offline} down`}
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: allOk ? '#10b981' : '#ef4444' }} />
                      </div>
                      <p className="text-[10px] text-white/25">{stat.total - stat.offline}/{stat.total} online</p>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          )}

          <GlassCard>
            <SectionHeader title="Networks" to="/networks" label="Manage" />
            <div className="space-y-2">
              {networks.map((n: any) => (
                <button key={n.id} type="button"
                  onClick={() => navigate(`/subnet-map?network=${n.id}`)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left hover:brightness-110"
                  style={{ backgroundColor: `${n.color}0d`, borderColor: `${n.color}25` }}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: n.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/90 truncate">
                      {n.vlan_id && <span className="text-white/40 text-xs mr-1.5">VLAN {n.vlan_id}</span>}
                      {n.name}
                    </p>
                    {n.cidr && <p className="text-[10px] font-mono text-white/30">{n.cidr}</p>}
                  </div>
                  <span className="text-xs text-white/40 flex-shrink-0 tabular-nums">{n.device_count}</span>
                </button>
              ))}
              {networks.length === 0 && <p className="text-xs text-white/30 text-center py-4">No networks configured</p>}
            </div>
          </GlassCard>
        </div>

        {/* ── Col 2 (no Pi-hole only): Offline + Monitoring Health + Recently Added ── */}
        {!pihole?.enabled && (
          <div className="space-y-5">
            {offline.length > 0 && (
              <GlassCard className="border-red-500/20">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <WifiOff size={13} className="text-red-400" />
                    Offline Devices
                    <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full tabular-nums">{offline.length}</span>
                  </h2>
                  <button onClick={() => navigate('/monitoring')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
                    Monitor <ChevronRight size={12} />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {offline.map((d: any) => (
                    <button key={d.id} type="button" onClick={() => navigate(`/devices/${d.id}`)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-red-500/[0.06] border border-red-500/15 hover:bg-red-500/10 transition-colors text-left">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
                      <span className="text-sm text-white/80 flex-1 truncate">{d.name}</span>
                      <span className="text-[10px] text-white/30 flex-shrink-0">{timeAgo(d.last_seen)}</span>
                    </button>
                  ))}
                </div>
              </GlassCard>
            )}
            {health.length > 0 && (
              <GlassCard>
                <SectionHeader title="Monitoring Health" to="/monitoring" />
                <div className="space-y-2">
                  {health.map((stat: any) => {
                    const pct = stat.total > 0 ? Math.round(((stat.total - stat.offline) / stat.total) * 100) : 100
                    const allOk = stat.offline === 0
                    return (
                      <div key={stat.network_id}
                        className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: stat.color }} />
                            <span className="text-xs text-white/70 truncate">{stat.network_name}</span>
                          </div>
                          <span className={`text-xs font-medium ${allOk ? 'text-emerald-400' : 'text-red-400'}`}>
                            {allOk ? 'All OK' : `${stat.offline} down`}
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: allOk ? '#10b981' : '#ef4444' }} />
                        </div>
                        <p className="text-[10px] text-white/25">{stat.total - stat.offline}/{stat.total} online</p>
                      </div>
                    )
                  })}
                </div>
              </GlassCard>
            )}
            {recentDevices.length > 0 && (
              <GlassCard>
                <SectionHeader title="Recently Added" to="/devices" label="All devices" />
                <div className="space-y-1">
                  {recentDevices.map((d: any) => (
                    <button key={d.id} type="button" onClick={() => navigate(`/devices/${d.id}`)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left group">
                      <div className="w-6 h-6 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                        <Server size={10} className="text-indigo-400/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/80 truncate group-hover:text-white/95 transition-colors">{d.name}</p>
                        <p className="text-[10px] text-white/30 truncate">
                          {[d.brand, d.model].filter(Boolean).join(' ')}
                          {d.location && <span className="ml-1">· {d.location}</span>}
                        </p>
                      </div>
                      {d.created_at && (
                        <span className="text-[10px] text-white/25 flex-shrink-0">{timeAgo(d.created_at)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {/* ── Col 2–3 (1/2): DNS Protection — only rendered when Pi-hole is enabled ── */}
        {pihole?.enabled && (
        <div className="lg:col-span-2 space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Shield size={13} className="text-red-400" />
                  <h2 className="text-xs font-semibold text-white/50 uppercase tracking-widest">DNS Protection</h2>
                </div>
                {pihole.any_blocking_disabled && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                    <AlertTriangle size={9} />
                    Blocking disabled on one or more instances
                  </span>
                )}
              </div>

              {/* Stat tiles */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total Queries', value: (pihole.total_queries ?? 0).toLocaleString(), color: '#3b82f6' },
                  { label: 'Queries Blocked', value: (pihole.total_blocked ?? 0).toLocaleString(), color: '#ef4444' },
                  { label: 'Percent Blocked', value: `${pihole.percent_blocked ?? 0}%`, color: '#f59e0b' },
                  { label: 'Domains on Lists', value: (pihole.domains_on_blocklist ?? 0).toLocaleString(), color: '#10b981' },
                ].map(({ label, value, color }) => (
                  <GlassCard key={label} className="py-3 px-4 text-center">
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-xl font-bold tabular-nums" style={{ color }}>{value}</p>
                  </GlassCard>
                ))}
              </div>

              {/* Over-time chart */}
              {piholeHistory.length > 0 && (
                <GlassCard>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Queries over 24h</h3>
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5 text-[10px] text-white/40">
                        <span className="w-3 h-0.5 rounded-full bg-blue-400 inline-block" />
                        Total
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] text-white/40">
                        <span className="w-3 h-0.5 rounded-full bg-red-400 inline-block" />
                        Blocked
                      </span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={piholeHistory} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradBlocked" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={(ts) => {
                          const d = new Date(ts * 1000)
                          return d.getHours() % 4 === 0 && d.getMinutes() < 10
                            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''
                        }}
                        tick={{ fill: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.35)', fontSize: 9 }}
                        axisLine={false} tickLine={false}
                      />
                      <YAxis tick={{ fill: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.35)', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: isDark ? '#0e1520' : '#ffffff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, borderRadius: 8, fontSize: 11 }}
                        labelFormatter={(ts) => new Date((ts as number) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        formatter={(val: any, name: string) => [val.toLocaleString(), name]}
                        itemStyle={{ color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.7)' }}
                        labelStyle={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.4)' }}
                      />
                      <Area type="monotone" dataKey="total" name="Total" stroke="#3b82f6" strokeWidth={1.5} fill="url(#gradTotal)" dot={false} />
                      <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#ef4444" strokeWidth={1.5} fill="url(#gradBlocked)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </GlassCard>
              )}

              <div className="grid grid-cols-2 gap-3">
              {/* Top clients */}
              <GlassCard>
                <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Top DNS Clients</h3>
                {pihole.top_clients?.length > 0 ? (
                  <div className="space-y-1.5">
                    {pihole.top_clients.map((c: any, i: number) => {
                      const max = pihole.top_clients[0]?.queries || 1
                      const pct = Math.round((c.queries / max) * 100)
                      const blockPct = c.queries > 0 ? Math.round((c.blocked / c.queries) * 100) : 0
                      return (
                        <button key={c.device_id} type="button"
                          onClick={() => navigate(`/devices/${c.device_id}`)}
                          className="w-full text-left group">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-white/25 tabular-nums w-4">{i + 1}</span>
                              <span className="text-xs text-white/80 group-hover:text-white transition-colors truncate">{c.device_name}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {c.blocked > 0 && (
                                <span className="text-[10px] text-red-400/70 tabular-nums">{blockPct}% blocked</span>
                              )}
                              <span className="text-xs text-white/40 tabular-nums">{c.queries.toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="h-1 rounded-full bg-white/5 overflow-hidden relative">
                            <div className="h-full rounded-full bg-blue-500/50 transition-all" style={{ width: `${pct}%` }} />
                            {blockPct > 0 && (
                              <div className="absolute inset-y-0 left-0 rounded-full bg-red-500/40 transition-all" style={{ width: `${Math.round(pct * blockPct / 100)}%` }} />
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-white/25 italic">No client data yet — poll Pi-hole to populate</p>
                )}
              </GlassCard>

              {/* Top blocked domains */}
              <GlassCard>
                <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Top Blocked Domains</h3>
                {pihole.top_blocked?.length > 0 ? (
                  <div className="space-y-1.5">
                    {pihole.top_blocked.map((d: any, i: number) => {
                      const max = pihole.top_blocked[0]?.count || 1
                      const pct = Math.round((d.count / max) * 100)
                      return (
                        <div key={d.domain}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-white/25 tabular-nums w-4">{i + 1}</span>
                              <span className="text-xs text-white/70 font-mono truncate">{d.domain}</span>
                            </div>
                            <span className="text-xs text-red-400/70 tabular-nums flex-shrink-0 ml-2">{d.count.toLocaleString()}</span>
                          </div>
                          <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full bg-red-500/40 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-white/25 italic">No blocked domain data yet — poll Pi-hole to populate</p>
                )}
              </GlassCard>
              </div>
        </div>
        )}

        {/* ── Col 4 (1/4): Devices by Type + Brand + Recently Added ── */}
        <div className="space-y-5">
          <GlassCard>
            <SectionHeader title="Devices by Type" to="/devices" />
            <div className="space-y-2">
              {byCategory.map((cat: any) => {
                const color = DEVICE_TYPE_COLORS[cat.category] ?? '#6366f1'
                const pct = Math.round((cat.count / maxCat) * 100)
                return (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-white/70">{cat.category}</span>
                      <span className="text-xs text-white/40 tabular-nums">{cat.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                )
              })}
              {byCategory.length === 0 && <p className="text-xs text-white/30 text-center py-3">No devices in service</p>}
            </div>
          </GlassCard>

          <GlassCard>
            <SectionHeader title="Devices by Brand" to="/devices" />
            <div className="space-y-2">
              {byBrand.map((b: any) => {
                const pct = Math.round((b.count / maxBrand) * 100)
                return (
                  <div key={b.brand}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-white/70">{b.brand}</span>
                      <span className="text-xs text-white/40 tabular-nums">{b.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#6366f1' }} />
                    </div>
                  </div>
                )
              })}
              {byBrand.length === 0 && <p className="text-xs text-white/30 text-center py-3">No data</p>}
            </div>
          </GlassCard>


          {pihole?.enabled && recentDevices.length > 0 && (
            <GlassCard>
              <SectionHeader title="Recently Added" to="/devices" label="All devices" />
              <div className="space-y-1">
                {recentDevices.map((d: any) => (
                  <button key={d.id} type="button" onClick={() => navigate(`/devices/${d.id}`)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left group">
                    <div className="w-6 h-6 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                      <Server size={10} className="text-indigo-400/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/80 truncate group-hover:text-white/95 transition-colors">{d.name}</p>
                      <p className="text-[10px] text-white/30 truncate">
                        {[d.brand, d.model].filter(Boolean).join(' ')}
                        {d.location && <span className="ml-1">· {d.location}</span>}
                      </p>
                    </div>
                    {d.created_at && (
                      <span className="text-[10px] text-white/25 flex-shrink-0">{timeAgo(d.created_at)}</span>
                    )}
                  </button>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      {/* ── Activity drawer ── */}
      {activityOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActivityOpen(false)} />
          <div className="relative w-full max-w-sm h-full flex flex-col border-l border-white/[0.08] bg-surface"
            style={{ background: 'linear-gradient(180deg, var(--card-base-deepest) 0%, var(--card-base-deepest) 100%)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <ScrollText size={13} className="text-indigo-400" />
                </div>
                <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
              </div>
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={() => { setActivityOpen(false); navigate('/events') }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
                  View all <ChevronRight size={11} />
                </button>
                <button type="button" onClick={() => setActivityOpen(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all">
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {activity.length === 0 && (
                <p className="text-xs text-white/30 text-center py-8">No recent activity</p>
              )}
              {activity.map((entry: any) => (
                <button key={entry.id} type="button"
                  onClick={() => entry.entity_id && navigate(`/${entry.entity_type === 'network' ? 'networks' : 'devices'}/${entry.entity_id}`)}
                  className="w-full flex items-start gap-3 text-left hover:bg-white/[0.04] px-5 py-3 transition-colors group">
                  <div className="w-6 h-6 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:border-white/[0.10] transition-colors">
                    <Clock size={10} className="text-white/25" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/80 leading-snug">
                      <span className={`font-medium mr-1 ${eventTypeColors[entry.event_type] ?? 'text-white/50'}`}>
                        {eventTypeLabels[entry.event_type] ?? entry.event_type}
                      </span>
                      {entry.entity_name ?? entry.message}
                    </p>
                    <p className="text-[10px] text-white/25 mt-0.5">
                      {entry.username ?? 'system'} · {timeAgo(entry.created_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
