import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink, Copy, Terminal, Zap, Activity, Tag,
  Pencil, Trash2, ChevronLeft, Cable, Wifi, Check, CopyPlus, ArrowUp, History, X,
  Shield, CheckCircle, MapPin, XCircle, Clock, Globe, ChevronDown, ChevronUp,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { GlassCard } from '../../components/GlassCard'
import { DeviceTypeIcon, HARDWARE_TYPE_ICON, NIC_TYPE_ICON } from '../../components/DeviceTypeIcon'
import { NetworkBadge } from '../../components/NetworkBadge'
import { DraggableCard } from '../../components/DraggableCard'
import { SwitchDiagram } from '../../components/SwitchDiagram'
import { useDeviceLayout, CardId, LayoutProfile } from '../../hooks/useDeviceLayout'
import { LOCATION_TYPE_ICON, STATUS_ICON } from '../../components/DeviceTypeIcon'
import { useAuthStore } from '../../store/authStore'
import { useColorSettings } from '../../hooks/useColorSettings'
import api from '../../lib/api'



function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
  const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback(text, done))
  } else {
    fallback(text, done)
  }
}

function fallback(text: string, done: () => void) {
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
  done()
}

function MonitoringTargets({ deviceId }: { deviceId: number }) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['monitoring', deviceId],
    queryFn: async () => {
      const { data } = await api.get(`/monitoring/device/${deviceId}?hours=1`)
      return data
    },
    refetchInterval: 60_000,
  })

  if (!data) return null

  const nicsList: any[] = data.nics ?? []

  // Fallback: single entry from top-level history
  if (nicsList.length === 0) {
    const history = data.history as { latency: number | null; status: string }[] | undefined
    if (!history || history.length < 2) return null
    return (
      <button type="button" onClick={() => navigate(`/monitoring?device=${deviceId}`)} className="w-full text-left space-y-1">
        <div className="h-14 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="mg-grad-fb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="latency" stroke="#10b981" strokeWidth={1.5} fill="url(#mg-grad-fb)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </button>
    )
  }

  return (
    <button type="button" onClick={() => navigate(`/monitoring?device=${deviceId}`)} className="w-full text-left space-y-3">
      {nicsList.map((nic: any, i: number) => {
        const dotClass =
          nic.current_status === 'up' ? 'bg-emerald-500' :
          nic.current_status === 'down' ? 'bg-red-500' :
          nic.current_status === 'timeout' ? 'bg-amber-500' :
          'bg-slate-500'
        const gradId = `mg-grad-${nic.nic_id ?? i}`
        const hasChart = nic.history && nic.history.length >= 2
        return (
          <div key={nic.nic_id ?? nic.ip}>
            {/* Title row */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
              {(() => { const I = NIC_TYPE_ICON[nic.nic_type?.toUpperCase()] ?? NIC_TYPE_ICON.ETH; return <I size={11} className="flex-shrink-0 text-white/50" /> })()}
              <span className="text-xs text-white/60 truncate">{nic.nic_label || nic.ip}</span>
              {nic.current_latency != null && <span className="text-[10px] font-mono text-white/35 ml-auto flex-shrink-0">{nic.current_latency}ms</span>}
            </div>
            {/* IP row */}
            <p className="text-[10px] font-mono text-white/30 mb-1">{nic.ip}</p>
            {/* Graph */}
            {hasChart && (
              <div className="h-10 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={nic.history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="latency" stroke="#10b981" strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      })}
    </button>
  )
}

const CONNECTION_TYPE_LABELS: Record<string, string> = {
  dhcp: 'DHCP', static: 'Static IP', pppoe: 'PPPoE', '4g-lte': '4G/LTE', 'ds-lite': 'DS-Lite',
}

function WanConfigCard({ wanConfigs }: { wanConfigs: any[] }) {
  const [shownPasswords, setShownPasswords] = useState<Set<number>>(new Set())
  const { wanPortColor } = useColorSettings()
  const togglePassword = (id: number) => setShownPasswords(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-3">
        <Globe size={13} style={{ color: wanPortColor }} />
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">WAN Configuration</h3>
      </div>
      <div className="space-y-4">
        {wanConfigs.map((wc: any) => {
          const portLabel = wc.port_name ? `Port ${wc.port_number} / ${wc.port_name}` : `Port ${wc.port_number}`
          const connLabel = CONNECTION_TYPE_LABELS[wc.connection_type] ?? wc.connection_type ?? '—'
          return (
            <div key={wc.id} className="rounded-lg border p-3"
              style={{ borderColor: wanPortColor + '33', backgroundColor: wanPortColor + '05' }}>
              {/* Port header */}
              <div className="flex items-center gap-2 mb-3">
                <Globe size={11} className="shrink-0" style={{ color: wanPortColor + 'b3' }} />
                <span className="text-xs font-medium text-white/60">{portLabel}</span>
              </div>
              {/* Fields */}
              <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                {/* Row 1: Connection | VLAN ID | MTU */}
                <div><Field label="Connection" value={connLabel} /></div>
                <div>{wc.vlan_id != null ? <Field label="VLAN ID" value={String(wc.vlan_id)} mono /> : <span />}</div>
                <div>{wc.mtu != null ? <Field label="MTU" value={String(wc.mtu)} mono /> : <span />}</div>
                {/* Row 2: WAN IP | DNS 1 | DNS 2 */}
                <div>{wc.ip_address ? <Field label="WAN IP" value={wc.ip_address} mono /> : <span />}</div>
                <div>{wc.dns_primary ? <Field label="DNS 1" value={wc.dns_primary} mono /> : <span />}</div>
                <div>{wc.dns_secondary ? <Field label="DNS 2" value={wc.dns_secondary} mono /> : <span />}</div>
                {/* Row 3: PPPoE (only when present) */}
                {(wc.pppoe_username || wc.pppoe_password) && <>
                  <div>{wc.pppoe_username ? <Field label="PPPoE Username" value={wc.pppoe_username} mono /> : <span />}</div>
                  <div>
                    {wc.pppoe_password && (
                      <>
                        <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">PPPoE Password</p>
                        {shownPasswords.has(wc.id) ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-mono text-white">{wc.pppoe_password}</span>
                            <button type="button" onClick={() => togglePassword(wc.id)}
                              className="text-white/30 hover:text-white/70 transition-colors" aria-label="Hide password">
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => togglePassword(wc.id)}
                            className="text-xs text-indigo-400 hover:text-indigo-300">
                            Reveal password
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div />
                </>}
                {/* Row 4: Speed Down | Speed Up */}
                {(wc.speed_down || wc.speed_up) && <>
                  <div>{wc.speed_down ? <Field label="Speed Down" value={wc.speed_down} /> : <span />}</div>
                  <div>{wc.speed_up ? <Field label="Speed Up" value={wc.speed_up} /> : <span />}</div>
                  <div />
                </>}
                {/* Row 5: Notes */}
                {wc.notes && <div className="col-span-3"><Field label="Notes" value={wc.notes} /></div>}
              </div>
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copiedSsh, setCopiedSsh] = useState(false)

  const copyKeyed = (key: string, text: string) => {
    const done = () => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500) }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback(text, done))
    } else {
      fallback(text, done)
    }
  }
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showQrPanel, setShowQrPanel] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const historyLimit = 50

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', id],
    queryFn: async () => { const { data } = await api.get(`/devices/${id}`); return data },
  })


const { data: auditHistory, isLoading: auditLoading } = useQuery({
    queryKey: ['audit', 'device', id, historyPage],
    queryFn: async () => {
      const { data } = await api.get(`/events?entity_type=device&entity_id=${id}&limit=${historyLimit}&offset=${historyPage * historyLimit}`)
      return { total: data.total, entries: data.items }
    },
    enabled: !!device && showHistory,
  })

  const pihole = device?.pihole_cache ?? null

  const [showQueryLog, setShowQueryLog] = useState(false)
  const { data: queryLog = [], isFetching: queryLogFetching } = useQuery({
    queryKey: ['pihole', 'queries', id],
    queryFn: async () => { const { data } = await api.get(`/pihole/queries/${id}`); return data },
    enabled: !!device && showQueryLog,
    refetchInterval: showQueryLog ? 30_000 : false,
  })

  const { data: piholeStatus } = useQuery({
    queryKey: ['pihole', 'status', id],
    queryFn: async () => {
      const { data } = await api.get('/pihole/status')
      return (data as any[]).find((p: any) => p.device_id === device?.id) ?? null
    },
    enabled: !!device?.pihole_enabled,
    refetchInterval: 60_000,
  })

  const { data: piholeGlobal } = useQuery({
    queryKey: ['pihole', 'dashboard'],
    queryFn: async () => { const { data } = await api.get('/pihole/dashboard'); return data },
  })

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })
  const piholeConfigured = piholeGlobal?.enabled === true

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/devices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['search'] })
      qc.invalidateQueries({ queryKey: ['monitoring'] })
      qc.invalidateQueries({ queryKey: ['switches'] })
      qc.invalidateQueries({ queryKey: ['pihole-status'] })
      qc.invalidateQueries({ queryKey: ['subnet-map'] })
      navigate('/devices')
    },
    onError: (err: any) => alert(`Delete failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const wolMutation = useMutation({
    mutationFn: () => api.post(`/devices/${id}/wol`),
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Wake on LAN failed'),
  })

  const fetchPassword = async () => {
    const { data } = await api.get(`/devices/${id}/password`)
    setPassword(data.password)
    setShowPassword(true)
  }

  if (isLoading) return <div className="animate-pulse h-96 glass-card rounded-xl" />
  if (!device) return <p className="text-white/40">Device not found</p>

  const canEdit = user?.role === 'admin' || user?.role === 'editor'
  const statusClass = `status-${device.status.replace(/_/g, '-')}`
  const primaryIp = device.nics?.find((n: any) => n.ip_address && n.ip_address !== 'DHCP')?.ip_address
  const primaryDns = device.nics?.find((n: any) => n.dns_entry)?.dns_entry
  const mynetUrl = `${window.location.origin}/devices/${device.id}`
  const labelEnabled = !!(sysSettings?.mynet_url)

const profile: LayoutProfile = device.switch_ports?.length > 0 ? 'switch' : 'general'

  return (
    <DeviceDetailInner
      device={device}
      id={id!}
      navigate={navigate}
      canEdit={canEdit}
      statusClass={statusClass}
      primaryIp={primaryIp}
      primaryDns={primaryDns}
      mynetUrl={mynetUrl}
      labelEnabled={labelEnabled}
      profile={profile}
      copiedKey={copiedKey}
      copiedSsh={copiedSsh}
      setCopiedSsh={setCopiedSsh}
      copyKeyed={copyKeyed}
      wolMutation={wolMutation}
      showPassword={showPassword}
      password={password}
      fetchPassword={fetchPassword}
      showHistory={showHistory}
      setShowHistory={setShowHistory}
      historyPage={historyPage}
      setHistoryPage={setHistoryPage}
      historyLimit={historyLimit}
      auditHistory={auditHistory}
      auditLoading={auditLoading}
      pihole={pihole}
      piholeConfigured={piholeConfigured}
      piholeStatus={piholeStatus}
      showQueryLog={showQueryLog}
      setShowQueryLog={setShowQueryLog}
      queryLog={queryLog}
      queryLogFetching={queryLogFetching}
      deleteMutation={deleteMutation}
      showQrPanel={showQrPanel}
      setShowQrPanel={setShowQrPanel}
    />
  )
}

function DeviceDetailInner({
  device, id, navigate, canEdit, statusClass, primaryIp, primaryDns, mynetUrl, labelEnabled,
  profile, copiedKey, copiedSsh, setCopiedSsh, copyKeyed,
  wolMutation, showPassword, password, fetchPassword,
  showHistory, setShowHistory, historyPage,
  setHistoryPage, historyLimit, auditHistory, auditLoading,
  pihole, piholeConfigured, piholeStatus, showQueryLog, setShowQueryLog, queryLog, queryLogFetching,
  deleteMutation, showQrPanel, setShowQrPanel,
}: any) {
  const { layout, reorderInZone, toggleColSpan, swapColumn, resetLayout } = useDeviceLayout(profile)
  const queryClient = useQueryClient()
  const colors = useColorSettings()

  const WAN_TYPE_NAMES = ['Router / Gateway', 'Firewall', '4G / 5G Router']
  const isWanCapable = WAN_TYPE_NAMES.includes((device as any).device_type_name ?? '')
  const { data: wanConfigs = [] } = useQuery<any[]>({
    queryKey: ['wan-configs', device.id],
    queryFn: async () => { const { data } = await api.get(`/wan-configs/device/${device.id}`); return data },
    enabled: isWanCapable,
  })

  const { data: monitoringData } = useQuery({
    queryKey: ['monitoring', device.id],
    queryFn: async () => { const { data } = await api.get(`/monitoring/device/${device.id}?hours=1`); return data },
    refetchInterval: 60_000,
    enabled: device.monitoring_enabled,
  })
  const wanStatusByPortId: Record<number, string> = {}
  if (monitoringData?.nics) {
    for (const nic of monitoringData.nics) {
      if (nic.is_wan_ping && nic.switch_port_id != null) wanStatusByPortId[nic.switch_port_id] = nic.current_status
    }
  }
  const wanConfigsWithStatus = wanConfigs.map((wc: any) => ({
    ...wc,
    wan_current_status: wanStatusByPortId[wc.switch_port_id] ?? null,
  }))

  const [pingResults, setPingResults] = useState<Record<string, any>>({})
  const [pingHighlight, setPingHighlight] = useState<Record<string, 'success' | 'failure'>>({})
  const pingMutation = useMutation({
    mutationFn: (ip: string) => api.post(`/monitoring/ping/${device.id}?ip=${encodeURIComponent(ip)}`),
    onSuccess: (res, ip) => {
      setPingResults(prev => ({ ...prev, [ip]: res.data }))
      const hl: 'success' | 'failure' = res.data.status === 'up' ? 'success' : 'failure'
      setPingHighlight(prev => ({ ...prev, [ip]: hl }))
      setTimeout(() => setPingHighlight(prev => { const n = { ...prev }; delete n[ip]; return n }), 5000)
    },
    onError: (err: any) => alert(`Ping failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const blockingMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.post(`/pihole/blocking/${device.id}?enabled=${enabled}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pihole', 'status', id] })
      queryClient.invalidateQueries({ queryKey: ['pihole', 'dashboard'] })
    },
    onError: (err: any) => alert(`Failed to update blocking: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const monitoringMutation = useMutation({
    mutationFn: ({ enabled, interval_secs }: { enabled: boolean; interval_secs: number }) =>
      api.patch(`/devices/${device.id}/monitoring?enabled=${enabled}&interval_secs=${interval_secs}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device', id] }),
    onError: (err: any) => alert(`Failed to update monitoring: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const [wanPingTargets, setWanPingTargets] = useState<Record<number, string>>({})
  const wanPingMutation = useMutation({
    mutationFn: ({ portId, target, enabled }: { portId: number; target: string; enabled?: boolean }) => {
      const body: any = { wan_ping_target: target || null }
      if (enabled !== undefined) body.wan_monitoring_enabled = enabled
      return api.put(`/wan-configs/port/${portId}`, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wan-configs', device.id] })
      queryClient.invalidateQueries({ queryKey: ['wan-configs-all'] })
    },
    onError: (err: any) => alert(`Failed to save WAN config: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const monitorNicsMutation = useMutation({
    mutationFn: (nic_ids: number[]) =>
      api.patch(`/devices/${device.id}/monitor-nics`, { nic_ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device', id] }),
    onError: (err: any) => alert(`Failed to update monitored NICs: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderInZone(active.id as CardId, over.id as CardId)
    }
  }

  const hasContent: Record<CardId, boolean> = {
    'nics': device.nics?.length > 0,
    'switch-ports': device.switch_ports?.length > 0,
    'vm-guests': device.vm_guests?.length > 0,
    'notes': !!device.notes,
    'hardware': !!(device.brand || device.model || device.cpu || device.ram || device.gpu || device.drives?.length > 0),
    'software': !!(device.os || device.hostname || device.username || device.has_password || device.ssh_enabled || device.ssh_key),
    'services': !!(device.services?.length > 0),
  }

  const visibleLayout = layout.filter(c => hasContent[c.id])
  const wideCards = visibleLayout.filter(c => c.colSpan === 2)
  const col0Cards = visibleLayout.filter(c => c.colSpan === 1 && c.column === 0)
  const col1Cards = visibleLayout.filter(c => c.colSpan === 1 && c.column === 1)

  const renderCard = (cardId: CardId): React.ReactNode => {
    switch (cardId) {
      case 'nics':
        return (
          <GlassCard>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Network Configuration</h3>
            <div className="space-y-3">
              {device.nics?.map((nic: any) => (
                <div key={nic.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-opacity ${nic.is_active === false ? 'bg-white/[0.01] border-white/[0.06] opacity-50' : 'bg-white/[0.03] border-glass-border'}`}>
                  <div className="mt-0.5 text-white/30 flex flex-col items-center gap-1">
                    {(() => { const I = NIC_TYPE_ICON[nic.nic_type?.toUpperCase()] ?? NIC_TYPE_ICON.ETH; return <I size={14} /> })()}
                    {nic.is_active === false && (
                      <span className="text-[8px] font-medium text-white/30 uppercase tracking-wide leading-none">off</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-3 gap-x-4 gap-y-2">
                    <div><Field label="Interface" value={nic.label || (nic.nic_type?.toUpperCase() === 'WIFI' ? 'WiFi' : 'Ethernet')} mono={!!nic.label} /></div>
                    <div>
                      {nic.nic_type?.toUpperCase() === 'WIFI'
                        ? <Field label="SSID" value={nic.ssid || '—'} />
                        : (nic.switch_device_name || nic.switch_port_id || nic.switch_port) && <Field label="Switch" value={nic.switch_device_name || '—'} />}
                    </div>
                    <div>
                      {nic.nic_type?.toUpperCase() === 'WIFI'
                        ? <Field label="Band" value={nic.band || '—'} />
                        : (nic.switch_port_label || nic.switch_port) && <Field label="Port" value={nic.switch_port_label || nic.switch_port} mono />}
                    </div>
                    <div>
                      {nic.mac && (
                        <>
                          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">MAC</p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-mono text-white">{nic.mac}</span>
                            <button type="button" onClick={() => copyKeyed(`mac-${nic.id}`, nic.mac)}
                              className="text-white/30 hover:text-white/70 transition-colors flex-shrink-0">
                              {copiedKey === `mac-${nic.id}` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <div>
                      {(nic.ip_address || nic.address_type === 'dhcp') && (
                        <>
                          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">IP</p>
                          {nic.ip_address ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-mono text-white">{nic.ip_address}</span>
                              <button type="button" onClick={() => copyKeyed(`ip-${nic.id}`, nic.ip_address)}
                                className="text-white/30 hover:text-white/70 transition-colors flex-shrink-0">
                                {copiedKey === `ip-${nic.id}` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                              </button>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">DHCP</span>
                          )}
                        </>
                      )}
                    </div>
                    <div>
                      {nic.network_name && (
                        <>
                          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">Network</p>
                          <NetworkBadge name={nic.network_name} color={nic.network_color} vlan={nic.vlan_id} size="md" />
                        </>
                      )}
                    </div>
                    {(() => {
                      const dns1 = nic.dns_server_1 || nic.network_dns_primary
                      const dns2 = nic.dns_server_2 || nic.network_dns_secondary
                      const dns1Inherited = !nic.dns_server_1 && !!nic.network_dns_primary
                      const dns2Inherited = !nic.dns_server_2 && !!nic.network_dns_secondary
                      const inheritedLabel = nic.address_type === 'static' ? '(network)' : '(DHCP)'
                      const addrLabel = nic.address_type === 'reserved' ? 'Reserved (DHCP)' : nic.address_type === 'dhcp' ? 'DHCP' : 'Static'
                      return (dns1 || dns2 || nic.gateway || nic.subnet_mask) ? <>
                        {nic.gateway && <div><Field label="Gateway" value={nic.gateway} mono /></div>}
                        {nic.subnet_mask && <div><Field label="Subnet Mask" value={nic.subnet_mask} mono /></div>}
                        {dns1 && <div>
                          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">
                            DNS Server 1{dns1Inherited && <span className="text-white/25 normal-case tracking-normal ml-1">{inheritedLabel}</span>}
                          </p>
                          <p className={`text-sm font-mono ${dns1Inherited ? 'text-white/50' : 'text-white'}`}>{dns1}</p>
                        </div>}
                        {dns2 && <div>
                          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">
                            DNS Server 2{dns2Inherited && <span className="text-white/25 normal-case tracking-normal ml-1">{inheritedLabel}</span>}
                          </p>
                          <p className={`text-sm font-mono ${dns2Inherited ? 'text-white/50' : 'text-white'}`}>{dns2}</p>
                        </div>}
                        <div><Field label="Address Type" value={addrLabel} /></div>
                      </> : null
                    })()}
                    {/* ETH/WiFi — dns name, connection + speed */}
                    {(nic.nic_type?.toUpperCase() === 'ETH' || nic.nic_type?.toUpperCase() === 'WIFI') && (nic.dns_entry || nic.connection_type || nic.nic_speed) && <>
                      <div>{nic.dns_entry && <Field label="DNS Name" value={nic.dns_entry} mono />}</div>
                      {nic.connection_type && <div><Field label="Connection" value={nic.connection_type === 'built-in' ? 'Built-in' : 'USB'} /></div>}
                      {nic.nic_speed && <div><Field label="NIC Speed" value={nic.nic_speed} /></div>}
                      {nic.nic_type?.toUpperCase() === 'ETH' && nic.poe_enabled && <div><Field label="PoE" value="Enabled" /></div>}
                    </>}
                    {/* SFP/QSFP — dns name + transceiver */}
                    {(nic.nic_type?.toUpperCase() === 'SFP' || nic.nic_type?.toUpperCase() === 'QSFP') && (nic.dns_entry || nic.transceiver_type || nic.transceiver_speed) && <>
                      {nic.dns_entry && <div><Field label="DNS Name" value={nic.dns_entry} mono /></div>}
                      {nic.transceiver_type && <div><Field label="Transceiver" value={
                        nic.transceiver_type === 'fiber-sm' ? 'Fiber — Single-mode' :
                        nic.transceiver_type === 'fiber-mm' ? 'Fiber — Multi-mode' :
                        nic.transceiver_type === 'dac'      ? 'DAC' :
                        nic.transceiver_type === 'aoc'      ? 'AOC' :
                        nic.transceiver_type === 'copper'   ? 'Copper / RJ45' : nic.transceiver_type
                      } /></div>}
                      {nic.transceiver_speed && <div><Field label="Speed" value={nic.transceiver_speed} /></div>}
                    </>}
                    {nic.notes && <div className="col-span-3"><Field label="Notes" value={nic.notes} /></div>}
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )

      case 'switch-ports': {
        const connectedPorts = device.switch_ports.filter((p: any) => p.connected_device_name || (device.uplink_port_id && p.id === device.uplink_port_id)).length
        const typeLabel: Record<string, string> = { eth: 'ETH', dac: 'DAC', sfp: 'SFP', 'sfp+': 'SFP+', qsfp: 'QSFP' }
        const typeColor: Record<string, string> = {
          eth: 'text-blue-400/70', dac: 'text-amber-400/70', sfp: 'text-indigo-400/70',
          'sfp+': 'text-purple-400/70', qsfp: 'text-emerald-400/70',
        }
        return (
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Switch Ports</h3>
              <span className="text-[10px] text-white/25 font-mono">{connectedPorts} / {device.switch_ports.length} connected</span>
            </div>

            {device.upstream_device_name && (
              <button type="button"
                onClick={() => navigate(`/devices/${device.upstream_device_id}`)}
                className="w-full flex items-center gap-3 mb-4 px-3 py-2.5 rounded-lg bg-indigo-500/[0.08] border border-indigo-500/20 hover:bg-indigo-500/[0.13] transition-colors text-left">
                <ArrowUp size={13} className="text-indigo-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-indigo-400 truncate">{device.upstream_device_name}</p>
                  {(device.uplink_port_label || device.upstream_port_label) && (
                    <p className="text-[10px] text-indigo-400/70 truncate">
                      {[device.uplink_port_label, device.upstream_port_label].filter(Boolean).join(' → ')}
                    </p>
                  )}
                </div>
                <ExternalLink size={11} className="text-indigo-400/60 shrink-0" />
              </button>
            )}

            <div className="space-y-0.5">
              {device.switch_ports.map((port: any) => {
                const isUplink = device.uplink_port_id && port.id === device.uplink_port_id
                const isMgmt = !!port.is_management
                const isWan = port.port_mode === 'wan'
                const isConnected = !!port.connected_device_name || isUplink
                const accentColor = isUplink ? '#818cf8' : isWan ? colors.wanPortColor : isMgmt ? '#a78bfa' : (port.connected_network_color || '#4ade80')
                const connectedName = isUplink ? device.upstream_device_name : port.connected_device_name
                const targetId = isUplink ? device.upstream_device_id : port.connected_device_id
                const wanConfig = isWan ? wanConfigs.find((wc: any) => wc.switch_port_id === port.id) : null

                return (
                  <div
                    key={port.id}
                    className={`relative flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg transition-colors
                      ${isConnected ? 'hover:bg-white/[0.04] cursor-pointer' : isMgmt ? 'hover:bg-violet-500/[0.04] cursor-pointer' : isWan ? 'hover:bg-white/[0.03]' : ''}`}
                    onClick={() => { if (targetId) navigate(`/devices/${targetId}`) }}
                  >
                    {/* Left accent bar */}
                    {(isConnected || isMgmt || isWan) && (
                      <div className="absolute left-0 top-[5px] bottom-[5px] w-[3px] rounded-full"
                        style={{ backgroundColor: accentColor }} />
                    )}

                    {/* Port number */}
                    <span className="text-[10px] font-mono w-5 text-right shrink-0 text-white/20 tabular-nums">
                      {port.port_number}
                    </span>

                    {/* Primary content */}
                    <div className="flex-1 min-w-0">
                      {isWan ? (
                        <>
                          <p className="text-sm truncate leading-snug"
                            style={{ color: colors.wanPortColor + 'cc' }}>
                            {wanConfig?.isp_name || 'WAN'}
                          </p>
                          {(wanConfig?.connection_type || port.port_name) && (
                            <p className="text-[10px] truncate leading-tight"
                              style={{ color: colors.wanPortColor + '66' }}>
                              {[wanConfig && (CONNECTION_TYPE_LABELS[wanConfig.connection_type] ?? wanConfig.connection_type), port.port_name].filter(Boolean).join(' — ')}
                            </p>
                          )}
                        </>
                      ) : isConnected ? (
                        <>
                          <p className="text-sm text-white/85 truncate leading-snug">{connectedName}</p>
                          {port.port_name && (
                            <p className="text-[10px] text-white/25 truncate leading-tight">{port.port_name}</p>
                          )}
                        </>
                      ) : isMgmt ? (
                        <p className="text-xs text-violet-400/60 truncate">
                          {port.mgmt_ip_address || port.mgmt_network_name
                            ? (port.mgmt_ip_address || port.mgmt_network_name)
                            : `Management${port.port_name ? ` — ${port.port_name}` : ''}`}
                        </p>
                      ) : (
                        <p className="text-xs text-white/15 truncate">{port.port_name || '—'}</p>
                      )}
                    </div>

                    {/* Right metadata — fixed-width columns for vertical alignment */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="w-3 flex justify-center">
                        {port.poe_enabled ? <Zap size={10} className="text-amber-400/60" aria-label="PoE" /> : null}
                      </span>
                      <span className="w-7 text-center text-xs text-white/20 font-mono tabular-nums">
                        {port.speed ?? ''}
                      </span>
                      <span className={`w-9 text-center text-xs font-mono ${typeColor[port.port_type] ?? 'text-white/25'}`}>
                        {port.port_type ? (typeLabel[port.port_type] ?? port.port_type.toUpperCase()) : ''}
                      </span>
                      <span className="w-20 flex justify-center">
                        {isWan
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                              style={{ backgroundColor: colors.wanPortColor + '26', color: colors.wanPortColor + 'cc' }}>WAN</span>
                          : port.connected_vlan_id
                            ? <NetworkBadge vlan={port.connected_vlan_id} color={port.connected_network_color} size="sm" />
                            : null}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </GlassCard>
        )
      }

      case 'vm-guests':
        return (
          <GlassCard>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Hosted VMs</h3>
            <div className="space-y-1.5">
              {device.vm_guests.map((vm: any) => (
                <button
                  key={vm.id}
                  type="button"
                  onClick={() => navigate(`/devices/${vm.id}`)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-glass-border hover:bg-white/[0.06] transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-white truncate">{vm.name}</span>
                    {vm.device_type_name && (
                      <span className="text-[11px] text-white/40 truncate">{vm.device_type_name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {vm.primary_ip && (
                      <span className="text-[11px] font-mono text-white/50">{vm.primary_ip}</span>
                    )}
                    <span className={`status-${vm.status?.replace(/_/g, '-')} text-[11px]`}>{vm.status?.replace(/_/g, ' ')}</span>
                  </div>
                </button>
              ))}
            </div>
          </GlassCard>
        )

      case 'services':
        return (
          <GlassCard>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Services</h3>
            <div className="space-y-3">
              {device.services.map((svc: any, i: number) => (
                <div key={i} className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {svc.name && <Field label="Name" value={svc.name} />}
                  {svc.port && <Field label="Port" value={String(svc.port)} mono />}
                  {svc.url && <Field label="URL" value={svc.url} mono />}
                </div>
              ))}
            </div>
          </GlassCard>
        )


      case 'notes':
        return (
          <GlassCard>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Notes</h3>
            <p className="text-sm text-white/60 whitespace-pre-wrap">{device.notes}</p>
          </GlassCard>
        )

      case 'hardware':
        return (
          <GlassCard>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Hardware</h3>
            {(device.brand || device.model || device.cpu || device.ram || device.gpu) && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {device.brand && <Field label="Brand" value={device.brand} />}
                {device.model && <Field label="Model" value={device.model} />}
                {device.cpu && <Field label="CPU" value={device.cpu} />}
                {device.gpu && <Field label="GPU" value={device.gpu} />}
                {device.ram && <Field label="RAM" value={device.ram} />}
              </div>
            )}
            {device.drives?.length > 0 && (
              <>
                <p className="text-[10px] text-white/30 uppercase tracking-wider mt-4 mb-2">Storage</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {device.drives.map((d: any, i: number) => (
                    <Field
                      key={i}
                      label={d.label || `Drive ${i + 1}`}
                      value={[d.type, d.capacity].filter(Boolean).join(' · ')}
                      mono
                    />
                  ))}
                </div>
              </>
            )}
          </GlassCard>
        )

      case 'software':
        return (
          <GlassCard>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Software & Access</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {device.os && <Field label="OS" value={`${device.os}${device.os_version ? ` ${device.os_version}` : ''}`} />}
              {device.hostname && <Field label="Hostname" value={device.hostname} mono />}
              {device.username && (
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">Username</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-mono text-white">{device.username}</p>
                    <button
                      type="button"
                      aria-label="Copy username"
                      title="Copy username"
                      onClick={() => copyKeyed('username', device.username)}
                      className="text-white/30 hover:text-white/70 transition-colors"
                    >
                      {copiedKey === 'username' ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              )}
              {device.has_password && (
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">Password</p>
                  {showPassword && password ? (
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-mono text-white">{password}</p>
                      <button
                        type="button"
                        aria-label="Copy password"
                        title="Copy password"
                        onClick={() => copyKeyed('password', password)}
                        className="text-white/30 hover:text-white/70 transition-colors"
                      >
                        {copiedKey === 'password' ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={fetchPassword} className="text-xs text-indigo-400 hover:text-indigo-300">
                      Reveal password
                    </button>
                  )}
                </div>
              )}
              {device.ssh_enabled && <Field label="SSH Port" value={String(device.ssh_port ?? 22)} mono />}
            </div>
            {device.ssh_key && (
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">SSH Key</p>
                <p className="text-xs font-mono text-white/60 break-all">{device.ssh_key}</p>
              </div>
            )}
          </GlassCard>
        )


      default:
        return null
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={() => navigate(-1)} className="btn-ghost p-2 flex-shrink-0" aria-label="Back to devices">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <DeviceTypeIcon name={(device as any).device_type_icon ?? HARDWARE_TYPE_ICON[(device as any).hardware_type]} size={32} className="text-white/30 flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{device.name}</h1>
              {device.use && <p className="text-sm text-white/40 mt-0.5 truncate">{device.use}</p>}
              {(() => {
                const hex = colors.statusColor(device.status)
                const StatusIcon = STATUS_ICON[device.status] ?? CheckCircle
                return (
                  <span className="inline-flex items-center gap-1.5 border rounded-lg px-2.5 py-1 mt-1.5 flex-shrink-0"
                    style={{ borderColor: hex + '40', backgroundColor: hex + '15', color: hex }}>
                    <StatusIcon size={11} className="flex-shrink-0" />
                    <span className="text-xs font-medium capitalize">{device.status.replace(/_/g, ' ')}</span>
                  </span>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Centre meta — device type + location */}
        <div className="absolute left-1/3 flex flex-col gap-1.5 items-start pointer-events-none">
        <div className="flex flex-col gap-1.5 items-start pointer-events-auto">
          {((device as any).device_type_category || (device as any).device_type_name || (device as any).hardware_type) && (() => {
            const hex = colors.categoryColor((device as any).device_type_category ?? (device as any).hardware_type)
            return (
              <div className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 border"
                style={{ borderColor: hex + '40', backgroundColor: hex + '15' }}>
                <DeviceTypeIcon name={(device as any).device_type_icon ?? HARDWARE_TYPE_ICON[(device as any).hardware_type]} size={11} style={{ color: hex + '80' }} className="flex-shrink-0" />
                {(device as any).device_type_category && (
                  <span className="text-xs font-medium" style={{ color: hex + '99' }}>{(device as any).device_type_category}</span>
                )}
                {(device as any).device_type_category && (device as any).device_type_name && (
                  <span className="text-xs" style={{ color: hex + '50' }}>›</span>
                )}
                {(device as any).device_type_name
                  ? <span className="text-xs font-medium" style={{ color: hex }}>{(device as any).device_type_name}</span>
                  : !(device as any).device_type_category && (device as any).hardware_type && (
                      <span className="text-xs font-medium" style={{ color: hex }}>{(device as any).hardware_type}</span>
                    )
                }
              </div>
            )
          })()}
          {((device as any).location_path || (device as any).storage_location_path || (device as any).purchase_date) && (() => {
            const locType = (device as any).location_type ?? (device as any).storage_location_type
            const hex = colors.locationColor(locType)
            const LocIcon = LOCATION_TYPE_ICON[locType] ?? MapPin
            return (
              <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 border"
                style={{ borderColor: hex + '40', backgroundColor: hex + '15' }}>
                <LocIcon size={11} style={{ color: hex + '80' }} className="flex-shrink-0" />
                <div className="flex items-center gap-1.5">
                  {(device as any).location_path && (
                    <span className="text-xs font-medium" style={{ color: hex }}>{(device as any).location_path}</span>
                  )}
                  {(device as any).storage_location_path && (
                    <>
                      {(device as any).location_path && <span className="text-xs" style={{ color: hex + '50' }}>·</span>}
                      <span className="text-xs font-medium" style={{ color: hex }}>{(device as any).storage_location_path}</span>
                    </>
                  )}
                  {(device as any).purchase_date && (
                    <>
                      <span className="text-xs" style={{ color: hex + '50' }}>·</span>
                      <span className="text-xs" style={{ color: hex + '80' }}>{(device as any).purchase_date}</span>
                    </>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => setShowHistory(true)} className="btn-ghost flex items-center gap-1.5 text-sm">
            <History size={14} /> History
          </button>
          {canEdit && (<>
            <button type="button" onClick={() => navigate(`/devices/${id}/edit`, { replace: true })} className="btn-ghost flex items-center gap-1.5 text-sm">
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              onClick={() => {
                const cloneData = {
                  name: `Copy of ${device.name}`,
                  use: device.use ?? '',
                  device_type_id: device.device_type_id ? String(device.device_type_id) : '',
                  brand: device.brand ?? '',
                  model: device.model ?? '',
                  cpu: device.cpu ?? '',
                  ram: device.ram ?? '',
                  gpu: device.gpu ?? '',
                  os: device.os ?? '',
                  os_version: device.os_version ?? '',
                  hostname: '',
                  username: device.username ?? '',
                  password: '',
                  ssh_enabled: device.ssh_enabled ?? false,
                  ssh_port: String(device.ssh_port ?? 22),
                  ssh_key: device.ssh_key ?? '',
                  status: device.status ?? 'in_service',
                  location: device.location ?? '',
                  storage_location: device.storage_location ?? '',
                  purchase_date: device.purchase_date ?? '',
                  url: device.url ?? '',
                  service_name: device.service_name ?? '',
                  service_port: device.service_port ? String(device.service_port) : '',
                  hypervisor_device_id: device.hypervisor_device_id ? String(device.hypervisor_device_id) : '',
                  firmware_type: device.firmware_type ?? '',
                  bed_size: device.bed_size ?? '',
                  mcu_board: device.mcu_board ?? '',
                  ha_entity_id: '',
                  wol_enabled: device.wol_enabled ?? false,
                  monitoring_enabled: false,
                  monitor_interval_secs: String(device.monitor_interval_secs ?? 60),
                  notes: device.notes ?? '',
                  drives: (device.drives ?? []).map((d: any) => ({
                    label: d.label ?? '', capacity: d.capacity ?? '', type: d.type ?? '',
                  })),
                  nics: (device.nics ?? []).map((n: any) => ({
                    label: n.label ?? '',
                    nic_type: n.nic_type ?? 'ETH',
                    mac: '',
                    ip_address: '',
                    dns_entry: '',
                    network_id: n.network_id ? String(n.network_id) : '',
                    address_type: n.address_type ?? 'reserved',
                    switch_port: n.switch_port ?? '',
                    poe_enabled: n.poe_enabled ?? false,
                    ssid: n.ssid ?? '',
                    band: n.band ?? '',
                    notes: '',
                  })),
                }
                navigate('/devices/new', { state: { cloneFrom: cloneData } })
              }}
              className="btn-ghost flex items-center gap-1.5 text-sm"
            >
              <CopyPlus size={14} /> Clone
            </button>
            <button
              type="button"
              onClick={() => { if (confirm('Delete this device?')) deleteMutation.mutate() }}
              className="btn-danger flex items-center gap-1.5 text-sm"
              disabled={deleteMutation.isPending}
            >
              <Trash2 size={14} /> {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </>)}
        </div>
      </div>

      {/* Quick Actions bar */}
      <GlassCard padding="sm" className="flex flex-wrap items-center gap-2">
        {device.ssh_enabled && (device.hostname || primaryIp) && (
          <button
            type="button"
            onClick={() => copyToClipboard(
              `ssh ${device.username ? `${device.username}@` : ''}${primaryDns ?? primaryIp}${device.ssh_port !== 22 ? ` -p ${device.ssh_port}` : ''}`,
              setCopiedSsh
            )}
            className="btn-ghost flex items-center gap-1.5 text-sm"
          >
            {copiedSsh ? <Check size={14} className="text-emerald-400" /> : <Terminal size={14} />}
            {copiedSsh ? 'SSH copied!' : 'Copy SSH'}
          </button>
        )}
        {device.wol_enabled && (
          <button type="button" onClick={() => wolMutation.mutate()} className="btn-ghost flex items-center gap-1.5 text-sm">
            <Zap size={14} /> Wake
          </button>
        )}
        {(device.nics ?? []).filter((n: any) => n.is_active !== false && n.ip_address && n.ip_address !== 'DHCP').map((nic: any) => {
          const result = pingResults[nic.ip_address]
          const isPending = pingMutation.isPending && pingMutation.variables === nic.ip_address
          const highlight = pingHighlight[nic.ip_address]
          return (
            <button key={nic.id} type="button"
              onClick={() => pingMutation.mutate(nic.ip_address)}
              disabled={pingMutation.isPending}
              className={`btn-ghost relative flex items-center gap-1.5 text-sm transition-colors duration-700 ${highlight === 'success' ? 'text-emerald-400' : highlight === 'failure' ? 'text-red-400' : ''}`}>
              {(() => { const I = NIC_TYPE_ICON[nic.nic_type?.toUpperCase()] ?? NIC_TYPE_ICON.ETH; return <I size={14} /> })()}
              {isPending ? 'Pinging…' : `Ping ${nic.label || nic.ip_address}`}
              {result && (
                <span className={`absolute top-full left-1/2 -translate-x-1/2 -mt-1 text-[10px] leading-none whitespace-nowrap pointer-events-none transition-opacity duration-700 ${highlight ? 'opacity-80' : 'opacity-0'}`}>
                  {result.status === 'up' ? `${result.latency_ms}ms` : result.status}
                </span>
              )}
            </button>
          )
        })}
        {device.services?.map((svc: any, i: number) => svc.url && (
          <a key={i} href={svc.url} target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-1.5 text-sm">
            <ExternalLink size={14} /> {svc.name || 'Open Web UI'}
          </a>
        ))}
        <button type="button" onClick={() => setShowQrPanel(true)}
          className="btn-ghost flex items-center gap-1.5 text-sm ml-auto">
          <Tag size={14} /> QR Codes
        </button>
      </GlassCard>

      {/* Switch port diagram */}
      {device.switch_ports?.length > 0 && (
        <div className="flex justify-center">
          <SwitchDiagram device={device} wanConfigs={wanConfigsWithStatus} wanColor={colors.wanPortColor} />
        </div>
      )}

      {/* Main content: DnD grid + fixed sidebar */}
      <div className="flex gap-5 items-start">

        {/* Draggable layout — wide row + two flex columns */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* Full-width cards */}
            {wideCards.length > 0 && (
              <SortableContext items={wideCards.map(c => c.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-4">
                  {wideCards.map(card => (
                    <DraggableCard
                      key={card.id}
                      id={card.id}
                      colSpan={2}
                      onToggleColSpan={() => toggleColSpan(card.id)}
                      canEdit={canEdit}
                    >
                      {renderCard(card.id)}
                    </DraggableCard>
                  ))}
                </div>
              </SortableContext>
            )}

            {/* Two flex columns — no row-height coupling, no gaps */}
            {(col0Cards.length > 0 || col1Cards.length > 0) && (
              <div className="flex gap-4 items-start">
                <SortableContext items={col0Cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex-1 flex flex-col gap-4">
                    {col0Cards.flatMap(card => {
                      const draggable = (
                        <DraggableCard
                          key={card.id}
                          id={card.id}
                          colSpan={1}
                          onToggleColSpan={() => toggleColSpan(card.id)}
                          onSwapColumn={() => swapColumn(card.id)}
                          canEdit={canEdit}
                        >
                          {renderCard(card.id)}
                        </DraggableCard>
                      )
                      if (card.id === 'nics' && isWanCapable && wanConfigs.length > 0) {
                        return [draggable, <WanConfigCard key="wan-config" wanConfigs={wanConfigs} />]
                      }
                      return [draggable]
                    })}
                  </div>
                </SortableContext>

                <SortableContext items={col1Cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex-1 flex flex-col gap-4">
                    {col1Cards.map(card => (
                      <DraggableCard
                        key={card.id}
                        id={card.id}
                        colSpan={1}
                        onToggleColSpan={() => toggleColSpan(card.id)}
                        onSwapColumn={() => swapColumn(card.id)}
                        canEdit={canEdit}
                      >
                        {renderCard(card.id)}
                      </DraggableCard>
                    ))}
                  </div>
                </SortableContext>
              </div>
            )}

          </div>
        </DndContext>

        {/* Fixed right sidebar */}
        <div className="w-72 flex-shrink-0 space-y-4">
          {device.pihole_enabled && piholeStatus && (
            <GlassCard className={piholeStatus.reachable === false ? 'border-red-500/20' : ''}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield size={13} className="text-red-400" />
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Pi-hole Instance</h3>
                  {piholeStatus.version && (
                    <span className="text-[10px] text-white/20 font-mono">{piholeStatus.version}</span>
                  )}
                </div>
                {device.url && (
                  <a href={device.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
                    Admin panel <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/40">Status</span>
                  {piholeStatus.reachable === false
                    ? <span className="text-xs text-red-400 text-right leading-snug max-w-[60%]">{piholeStatus.last_error ?? 'Unreachable'}</span>
                    : piholeStatus.url_configured
                      ? <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle size={11} /> Active</span>
                      : <span className="flex items-center gap-1 text-xs text-amber-400"><XCircle size={11} /> No NIC address</span>
                  }
                </div>
                {piholeStatus.poll_host && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Polling</span>
                    <span className="text-xs font-mono text-white/60">{piholeStatus.poll_host}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/40">Password</span>
                  <span className="text-xs text-white/40">{piholeStatus.password_set ? 'Set' : 'Not set'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/40">Last polled</span>
                  <span className="flex items-center gap-1 text-xs text-white/40">
                    <Clock size={10} />
                    {piholeStatus.last_polled
                      ? (() => {
                          const age = Math.floor((Date.now() - new Date(piholeStatus.last_polled).getTime()) / 1000)
                          return age < 60 ? 'Just now' : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`
                        })()
                      : 'Never'}
                  </span>
                </div>
                {piholeStatus.reachable !== false && piholeStatus.blocking_enabled !== null && piholeStatus.blocking_enabled !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Blocking</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${piholeStatus.blocking_enabled ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {piholeStatus.blocking_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          disabled={blockingMutation.isPending}
                          onClick={() => blockingMutation.mutate(!piholeStatus.blocking_enabled)}
                          className={`relative w-7 h-4 rounded-full transition-colors disabled:opacity-40 ${piholeStatus.blocking_enabled ? 'bg-emerald-600' : 'bg-white/15 hover:bg-white/20'}`}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-[#ffffff] shadow transition-all ${piholeStatus.blocking_enabled ? 'left-3.5' : 'left-0.5'}`} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {piholeStatus.reachable !== false && piholeStatus.queries_today != null && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-blue-500/[0.07] border border-blue-500/15 px-3 py-2 text-center">
                        <p className="text-base font-bold text-blue-300 tabular-nums">{piholeStatus.queries_today.toLocaleString()}</p>
                        <p className="text-[10px] text-white/35 mt-0.5">Queries today</p>
                      </div>
                      <div className="rounded-lg bg-red-500/[0.07] border border-red-500/15 px-3 py-2 text-center">
                        <p className="text-base font-bold text-red-300 tabular-nums">{(pihole?.blocked_today ?? 0).toLocaleString()}</p>
                        <p className="text-[10px] text-white/35 mt-0.5">Blocked today</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </GlassCard>
          )}

          {pihole && !device.pihole_enabled && piholeConfigured && (pihole.queries_today > 0 || pihole.blocked_today > 0) && (
            <GlassCard>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">DNS Activity</h3>
                <button
                  type="button"
                  onClick={() => setShowQueryLog((v: boolean) => !v)}
                  className={`text-[10px] px-2 py-1 rounded transition-colors ${showQueryLog ? 'bg-indigo-500/20 text-indigo-300' : 'text-white/30 hover:text-white/60'}`}
                >
                  {showQueryLog ? 'Hide log' : 'Query log'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-lg bg-blue-500/[0.07] border border-blue-500/15 px-3 py-2.5 text-center">
                  <p className="text-lg font-bold text-blue-300 tabular-nums">{(pihole.queries_today ?? 0).toLocaleString()}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">Queries today</p>
                </div>
                <div className="rounded-lg bg-red-500/[0.07] border border-red-500/15 px-3 py-2.5 text-center">
                  <p className="text-lg font-bold text-red-300 tabular-nums">{(pihole.blocked_today ?? 0).toLocaleString()}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">Blocked today</p>
                </div>
              </div>
              {pihole.queries_today > 0 && (
                <div className="space-y-1 mb-3">
                  <div className="flex justify-between text-[10px] text-white/30">
                    <span>Blocked</span>
                    <span>{Math.round((pihole.blocked_today / pihole.queries_today) * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-red-500/50"
                      style={{ width: `${Math.round((pihole.blocked_today / pihole.queries_today) * 100)}%` }} />
                  </div>
                </div>
              )}
              {showQueryLog && (
                <div className="mt-2 border-t border-white/[0.06] pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-white/30 uppercase tracking-wider">Recent queries</span>
                    {queryLogFetching && <span className="text-[10px] text-white/25 animate-pulse">Loading…</span>}
                  </div>
                  {queryLog.length === 0 && !queryLogFetching && (
                    <p className="text-[10px] text-white/25 italic">No recent queries found for this device's IPs</p>
                  )}
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {queryLog.map((q: any, i: number) => {
                      const isBlocked = q.status?.startsWith('BLOCK') || q.status === 'GRAVITY'
                      const isCached = q.status?.startsWith('CACHE')
                      const dot = isBlocked ? 'bg-red-400' : isCached ? 'bg-amber-400/60' : 'bg-emerald-400/60'
                      return (
                        <div key={i} className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-white/[0.02]">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                          <span className="text-[10px] font-mono text-white/70 flex-1 truncate">{q.domain}</span>
                          <span className="text-[10px] text-white/25 flex-shrink-0 tabular-nums">
                            {q.time ? new Date(q.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </GlassCard>
          )}

          <GlassCard padding="sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Monitoring</h3>
              <div className="flex items-center gap-3">
                {device.wol_enabled && canEdit && (
                  <button type="button" onClick={() => wolMutation.mutate()}
                    className="flex items-center gap-1 text-[11px] text-white/40 hover:text-amber-400 transition-colors">
                    <Zap size={11} /> WoL
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={device.monitoring_enabled ? 'Disable monitoring' : 'Enable monitoring'}
                    disabled={monitoringMutation.isPending || ['stock', 'undeployed', 'decommissioned'].includes(device.status)}
                    onClick={() => monitoringMutation.mutate({
                      enabled: !device.monitoring_enabled,
                      interval_secs: device.monitor_interval_secs ?? 60,
                    })}
                    className={`relative w-7 h-4 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${device.monitoring_enabled ? 'bg-indigo-600' : 'bg-white/15 hover:bg-white/20'}`}
                  >
                    <span className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-[#ffffff] shadow-sm transition-transform ${device.monitoring_enabled ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Interval</p>
                {canEdit ? (
                  <select
                    aria-label="Ping interval"
                    value={device.monitor_interval_secs ?? 60}
                    disabled={!device.monitoring_enabled}
                    onChange={(e) => monitoringMutation.mutate({ enabled: true, interval_secs: Number(e.target.value) })}
                    className="glass-input w-full text-sm disabled:opacity-40"
                  >
                    <option value="30" className="bg-surface-overlay">30 seconds</option>
                    <option value="60" className="bg-surface-overlay">1 minute</option>
                    <option value="120" className="bg-surface-overlay">2 minutes</option>
                    <option value="300" className="bg-surface-overlay">5 minutes</option>
                    <option value="600" className="bg-surface-overlay">10 minutes</option>
                  </select>
                ) : (
                  <p className={`text-sm ${device.monitoring_enabled ? 'text-white' : 'text-white/40'}`}>
                    {device.monitor_interval_secs ?? 60}s
                  </p>
                )}
              </div>

              {isWanCapable && wanConfigs.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">WAN Targets</p>
                  <div className="space-y-2">
                    {wanConfigs.map((wc: any) => {
                      const portLabel = wc.port_name ? `Port ${wc.port_number} / ${wc.port_name}` : `Port ${wc.port_number}`
                      const savedIp = wc.wan_ping_target || '1.1.1.1'
                      const editVal = wanPingTargets[wc.id] ?? savedIp
                      return (
                        <div key={wc.id} className={`flex items-center gap-2 ${device.monitoring_enabled ? '' : 'opacity-40'}`}>
                          {canEdit ? (
                            <input
                              type="checkbox"
                              checked={wc.wan_monitoring_enabled !== false}
                              disabled={!device.monitoring_enabled}
                              onChange={() => wanPingMutation.mutate({ portId: wc.switch_port_id, target: savedIp === '1.1.1.1' ? '' : savedIp, enabled: wc.wan_monitoring_enabled === false })}
                              className="rounded border-white/20 bg-white/10 text-indigo-500 disabled:opacity-40"
                            />
                          ) : null}
                          <Globe size={12} className="flex-shrink-0 text-white/30" />
                          {canEdit ? (
                            <input
                              value={editVal}
                              onChange={e => setWanPingTargets(prev => ({ ...prev, [wc.id]: e.target.value }))}
                              onBlur={e => {
                                const val = e.target.value.trim() || '1.1.1.1'
                                if (val !== savedIp) wanPingMutation.mutate({ portId: wc.switch_port_id, target: val === '1.1.1.1' ? '' : val })
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              disabled={!device.monitoring_enabled || wc.wan_monitoring_enabled === false}
                              placeholder="1.1.1.1"
                              className="glass-input text-xs font-mono w-1/2 disabled:opacity-40"
                            />
                          ) : (
                            <span className="text-xs font-mono text-white/50">{savedIp}</span>
                          )}
                          <span className="text-[10px] text-white/25 truncate">{wc.isp_name || portLabel}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {device.nics?.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Monitor NICs</p>
                  <div className="space-y-1.5">
                    {device.nics.filter((nic: any) => nic.is_active !== false).map((nic: any) => {
                      const checked = (device.monitor_nic_ids ?? []).includes(nic.id)
                      return (
                        <label key={nic.id} className={`flex items-center gap-2 ${canEdit && device.monitoring_enabled ? 'cursor-pointer group' : 'cursor-default'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit || !device.monitoring_enabled || monitorNicsMutation.isPending}
                            onChange={() => {
                              const current = device.monitor_nic_ids ?? []
                              const newIds = checked
                                ? current.filter((i: number) => i !== nic.id)
                                : [...current, nic.id]
                              monitorNicsMutation.mutate(newIds)
                            }}
                            className="rounded border-white/20 bg-white/10 text-indigo-500 disabled:opacity-40"
                          />
                          {(() => { const I = NIC_TYPE_ICON[nic.nic_type?.toUpperCase()] ?? NIC_TYPE_ICON.ETH; return <I size={12} className={device.monitoring_enabled ? 'text-white/50' : 'text-white/20'} /> })()}
                          <span className={`text-xs font-mono ${device.monitoring_enabled ? 'text-white/70 group-hover:text-white/90' : 'text-white/30'}`}>
                            {nic.label || nic.nic_type}{nic.ip_address ? ` — ${nic.ip_address}` : ''}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {device.monitoring_enabled && (
                <div className="pt-1 border-t border-glass-border">
                  <MonitoringTargets deviceId={device.id} />
                </div>
              )}
            </div>
          </GlassCard>

          {device.hypervisor_device_id && (
            <GlassCard padding="sm">
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Hosted On</p>
              <button type="button"
                onClick={() => navigate(`/devices/${device.hypervisor_device_id}`)}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                {device.hypervisor_name ?? `Device #${device.hypervisor_device_id}`}
              </button>
            </GlassCard>
          )}

          {(device.firmware_type || device.bed_size || device.mcu_board) && (
            <GlassCard padding="sm">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">3D Printer</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {device.firmware_type && <Field label="Firmware" value={device.firmware_type} />}
                {device.bed_size && <Field label="Bed Size" value={device.bed_size} />}
                {device.mcu_board && <div className="col-span-2"><Field label="MCU Board" value={device.mcu_board} /></div>}
              </div>
            </GlassCard>
          )}

          {device.ha_entity_id && (
            <GlassCard padding="sm">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Home Assistant</h3>
              <Field label="Entity ID" value={device.ha_entity_id} mono />
            </GlassCard>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={resetLayout}
              className="text-[10px] text-white/20 hover:text-white/40 transition-colors w-full text-center py-1"
            >
              Reset layout
            </button>
          )}
        </div>
      </div>

      {/* History drawer */}
      {showHistory && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowHistory(false)} />
          <div className="relative z-10 w-[520px] max-w-full h-full bg-surface border-l border-glass-border flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border flex-shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-white">Device History</h2>
                {auditHistory?.total != null && (
                  <p className="text-xs text-white/40 mt-0.5">{auditHistory.total} entries</p>
                )}
              </div>
              <button type="button" onClick={() => setShowHistory(false)}
                className="text-white/40 hover:text-white/80 transition-colors" aria-label="Close history">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {auditLoading ? (
                <div className="p-5 space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : auditHistory?.entries?.length === 0 ? (
                <p className="text-center py-16 text-white/30 text-sm">No history for this device</p>
              ) : (
                <div className="divide-y divide-glass-border">
                  {(auditHistory?.entries ?? []).map((e: any) => (
                    <div key={e.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded flex-shrink-0 ${
                          e.action === 'create' ? 'bg-emerald-500/15 text-emerald-400' :
                          e.action === 'update' ? 'bg-blue-500/15 text-blue-400' :
                          e.action === 'delete' ? 'bg-red-500/15 text-red-400' :
                          e.action === 'deploy' ? 'bg-amber-500/15 text-amber-400' :
                          'bg-white/10 text-white/50'
                        }`}>{e.action}</span>
                        <span className="text-xs text-white/30 flex-shrink-0">{e.username ?? 'system'}</span>
                        <span className="ml-auto text-[11px] text-white/25 flex-shrink-0">
                          {new Date(e.timestamp).toLocaleString()}
                        </span>
                      </div>
                      {e.changed_fields?.length > 0 && (
                        <p className="text-xs text-white/40 pl-1">
                          Changed: <span className="text-white/60">{e.changed_fields.join(', ')}</span>
                        </p>
                      )}
                      {e.new_values && Object.keys(e.new_values).length > 0 && (
                        <div className="pl-1 space-y-0.5">
                          {Object.entries(e.new_values).map(([k, v]) => (
                            <div key={k} className="flex items-baseline gap-2 text-[11px]">
                              <span className="text-white/30 w-20 shrink-0">{k}</span>
                              {e.old_values?.[k] != null && (
                                <span className="text-red-400/60 line-through truncate max-w-[120px]">{String(e.old_values[k])}</span>
                              )}
                              {e.old_values?.[k] != null && <span className="text-white/20">→</span>}
                              <span className="text-white/70 truncate max-w-[160px]">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {auditHistory?.total > historyLimit && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-glass-border flex-shrink-0">
                <button type="button" disabled={historyPage === 0}
                  onClick={() => setHistoryPage((p: number) => p - 1)}
                  className="btn-ghost text-xs disabled:opacity-30">← Newer</button>
                <span className="text-xs text-white/30">
                  {historyPage * historyLimit + 1}–{Math.min((historyPage + 1) * historyLimit, auditHistory.total)} of {auditHistory.total}
                </span>
                <button type="button"
                  disabled={(historyPage + 1) * historyLimit >= auditHistory.total}
                  onClick={() => setHistoryPage((p: number) => p + 1)}
                  className="btn-ghost text-xs disabled:opacity-30">Older →</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR Codes panel */}
      {showQrPanel && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowQrPanel(false)} />
          <div className="relative z-10 w-[280px] max-w-full h-full bg-surface border-l border-glass-border flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border flex-shrink-0">
              <h2 className="text-sm font-semibold text-white">QR Codes</h2>
              <button type="button" onClick={() => setShowQrPanel(false)}
                className="text-white/40 hover:text-white/80 transition-colors" aria-label="Close QR panel">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">

              {/* MyNet device QR */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider text-center">MyNet Device Link</p>
                <div className="p-4 bg-[#ffffff] rounded-xl">
                  <QRCodeSVG value={mynetUrl} size={160} />
                </div>
                {labelEnabled ? (
                  <a
                    href={`${window.location.origin}/api/qr/devices/${device.id}/label`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors"
                  >
                    <Tag size={11} /> Print label
                  </a>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-amber-400/60 cursor-default" title="Set MyNet URL in Settings to enable label downloads">
                    <Tag size={11} /> Print label (URL not set)
                  </span>
                )}
              </div>

              {/* Service QR codes */}
              {device.services?.filter((s: any) => s.url).map((svc: any, i: number) => (
                <div key={i} className="flex flex-col items-center gap-3 pt-6 border-t border-glass-border">
                  <p className="text-xs font-semibold text-white/50 uppercase tracking-wider text-center">
                    {svc.name || `Service ${i + 1}`}
                  </p>
                  <a href={svc.url} target="_blank" rel="noreferrer" aria-label={`Open ${svc.name || `Service ${i + 1}`}`} className="p-4 bg-[#ffffff] rounded-xl hover:opacity-80 transition-opacity">
                    <QRCodeSVG value={svc.url} size={160} />
                  </a>
                  {labelEnabled ? (
                    <a
                      href={`${window.location.origin}/api/qr/label?url=${encodeURIComponent(svc.url)}&name=${encodeURIComponent(svc.name || `Service ${i + 1}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors"
                    >
                      <Tag size={11} /> Print label
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-400/60 cursor-default" title="Set MyNet URL in Settings to enable label downloads">
                      <Tag size={11} /> Print label (URL not set)
                    </span>
                  )}
                </div>
              ))}

              {/* Empty state */}
              {!device.services?.some((s: any) => s.url) && (
                <p className="text-center text-white/25 text-xs pt-4">No service URLs configured</p>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm text-white ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
