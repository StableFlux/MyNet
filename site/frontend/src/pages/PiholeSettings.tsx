import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wifi, CheckCircle, XCircle, Clock, Loader, ExternalLink, Save, RefreshCw, AlertTriangle, AlertCircle, GitMerge, ArrowLeft, ArrowRight, Trash2, Globe } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  match:           { label: 'Match',              className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle },
  partial:         { label: 'Partial sync',        className: 'text-amber-400  bg-amber-500/10  border-amber-500/20',  icon: AlertTriangle },
  mynet_only:      { label: 'MyNet only',          className: 'text-amber-400  bg-amber-500/10  border-amber-500/20',  icon: AlertTriangle },
  pihole_only:     { label: 'Pi-hole only',        className: 'text-blue-400   bg-blue-500/10   border-blue-500/20',   icon: AlertCircle },
  ip_mismatch:     { label: 'IP mismatch',         className: 'text-red-400    bg-red-500/10    border-red-500/20',    icon: XCircle },
  pihole_conflict: { label: 'Pi-hole conflict',    className: 'text-purple-400 bg-purple-500/10 border-purple-500/20', icon: GitMerge },
  no_ip:           { label: 'No IP in MyNet',      className: 'text-slate-400  bg-slate-500/10  border-slate-500/20',  icon: AlertCircle },
}

export default function PiholeSettings() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

  const { data: sysData } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })

  const { data: dnsComparison, isLoading: dnsLoading, refetch: refetchDns } = useQuery({
    queryKey: ['pihole-dns-comparison'],
    queryFn: async () => { const { data } = await api.get('/pihole/dns-comparison'); return data },
    enabled: false,
  })

  const dnsMutation = useMutation({
    mutationFn: ({ action, hostname, ip, nicId }: { action: string; hostname: string; ip?: string; nicId?: number }) => {
      if (action === 'push')            return api.post('/pihole/dns/push-to-pihole',   { hostname, ip })
      if (action === 'update-pihole')   return api.post('/pihole/dns/update-pihole-ip', { hostname, ip })
      if (action === 'remove')          return api.delete('/pihole/dns/remove-from-pihole', { data: { hostname } })
      if (action === 'update-mynet-ip') return api.post('/pihole/dns/update-mynet-ip',  { hostname, ip })
      if (action === 'set-mynet-dns')   return api.post('/pihole/dns/set-mynet-dns',    { nic_id: nicId, hostname })
      return Promise.reject(new Error('Unknown action'))
    },
    onSuccess: () => refetchDns(),
    onError: (err: any) => alert(`DNS action failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const { data: piholeStatus, refetch: refetchPiholeStatus } = useQuery({
    queryKey: ['pihole-status'],
    queryFn: async () => { const { data } = await api.get('/pihole/status'); return data },
    refetchInterval: 60_000,
  })

  const pollNowMutation = useMutation({
    mutationFn: () => api.post('/pihole/poll-now'),
    onSuccess: () => refetchPiholeStatus(),
    onError: (err: any) => alert(`Poll failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const [piholeInterval, setPiholeInterval] = useState(300)
  const [dnsDomain, setDnsDomain] = useState('')
  const [hoveredDupIp, setHoveredDupIp] = useState<string | null>(null)
  const [applyTotal, setApplyTotal] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (sysData) {
      setPiholeInterval(sysData.pihole_poll_interval_secs ?? 300)
      setDnsDomain(sysData.dns_domain ?? '')
    }
  }, [sysData])

  const intervalDirty = sysData && piholeInterval !== (sysData.pihole_poll_interval_secs ?? 300)
  const domainDirty   = sysData && dnsDomain !== (sysData.dns_domain ?? '')

  const saveIntervalMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch('/system-settings', { pihole_poll_interval_secs: piholeInterval })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-settings'] }),
    onError: (err: any) => alert(`Failed to save interval: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  const saveDomainMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch('/system-settings', { dns_domain: dnsDomain })
      return data
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['system-settings'] }); setApplyTotal(null) },
    onError: (err: any) => alert(`Failed to save domain: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  async function handleApplyAll() {
    if (!dnsDomain) return
    setApplying(true)
    setApplyTotal(null)
    try {
      const [r1, r2] = await Promise.all([
        api.post('/pihole/dns/apply-domain-to-piholes', { domain: dnsDomain }),
        api.post('/pihole/dns/apply-domain-to-mynet',   { domain: dnsDomain }),
      ])
      setApplyTotal((r1.data.updated ?? 0) + (r2.data.updated ?? 0))
      qc.invalidateQueries({ queryKey: ['subnet-map'] })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Pi-hole Integration</h1>
        <p className="text-sm text-white/40 mt-0.5">DNS filtering stats and device query history.</p>
      </div>

      {/* Configuration */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:w-2/3">

        {/* Polling */}
        <GlassCard className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-600/20 flex items-center justify-center flex-shrink-0">
              <Wifi size={16} className="text-red-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Pi-hole Polling</p>
              <p className="text-xs text-white/40 mt-0.5">
                Pi-hole instances are configured as devices. Enable the <strong className="text-white/60">Pi-hole Instance</strong> toggle
                on a device and set its password. MyNet polls automatically via the device's NIC address.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 mt-auto">
            <p className="text-xs text-white/40">Poll interval</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={60}
                max={3600}
                value={piholeInterval}
                onChange={(e) => setPiholeInterval(Number(e.target.value))}
                className="glass-input text-sm w-24 text-center"
              />
              <span className="text-xs text-white/30">seconds</span>
            </div>
          </div>
          {intervalDirty && canEdit && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => saveIntervalMutation.mutate()}
                disabled={saveIntervalMutation.isPending}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                <Save size={14} />
                {saveIntervalMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </GlassCard>

        {/* DNS Domain Suffix */}
        <GlassCard className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
              <Globe size={16} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">DNS Domain Suffix</p>
              <p className="text-xs text-white/40 mt-0.5">
                Local domain suffix appended to DNS hostnames (e.g. <span className="font-mono text-white/60">.local</span>).
                Save to use as a shortcut when entering device DNS entries.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-auto">
            <input
              type="text"
              value={dnsDomain}
              onChange={(e) => { setDnsDomain(e.target.value); setApplyTotal(null) }}
              placeholder=".local"
              className="glass-input text-sm font-mono flex-1"
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => saveDomainMutation.mutate()}
                disabled={saveDomainMutation.isPending || !domainDirty}
                title="Save suffix"
                className="btn-primary flex items-center justify-center gap-1.5 text-sm w-32 flex-shrink-0 disabled:opacity-40"
              >
                <Save size={14} />
                {saveDomainMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={handleApplyAll}
                disabled={applying || !dnsDomain || !!domainDirty}
                title={domainDirty ? 'Save the suffix first' : 'Apply suffix to all MyNet and Pi-hole DNS entries'}
                className="btn-ghost flex items-center justify-center gap-1.5 text-sm w-32 flex-shrink-0 disabled:opacity-40"
              >
                {applying ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                <span className="whitespace-nowrap">{applying ? 'Applying…' : 'Apply to All'}</span>
              </button>
            )}
          </div>
          {applyTotal !== null && (
            <p className="text-xs text-emerald-400">{applyTotal} {applyTotal === 1 ? 'entry' : 'entries'} updated</p>
          )}
        </GlassCard>

        </div>{/* end grid */}
      </div>

      {/* Instances */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Instances</h2>
        <GlassCard className="space-y-2">
        {piholeStatus && piholeStatus.length === 0 && (
          <p className="text-xs text-white/30 italic">No Pi-hole devices configured. Enable the Pi-hole toggle on a device to get started.</p>
        )}
        {piholeStatus && piholeStatus.length > 0 && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {piholeStatus.map((ph: any) => {
              const ok = ph.url_configured
              const unreachable = ph.reachable === false
              const lastPolled = ph.last_polled ? new Date(ph.last_polled) : null
              const age = lastPolled ? Math.floor((Date.now() - lastPolled.getTime()) / 1000) : null
              const ageStr = age === null ? 'Never polled'
                : age < 60 ? 'Just now'
                : age < 3600 ? `${Math.floor(age / 60)}m ago`
                : `${Math.floor(age / 3600)}h ago`
              return (
                <div key={ph.device_id} className={`p-3 rounded-lg border ${unreachable ? 'bg-red-500/[0.05] border-red-500/20' : 'bg-white/[0.03] border-white/[0.06]'}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {unreachable
                        ? <XCircle size={14} className="text-red-400" />
                        : ok
                          ? <CheckCircle size={14} className="text-emerald-400" />
                          : <XCircle size={14} className="text-amber-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{ph.device_name}</p>
                        {ph.version && (
                          <span className="text-[10px] text-white/20 font-mono flex-shrink-0">{ph.version}</span>
                        )}
                        {ph.url && (
                          <a href={ph.url} target="_blank" rel="noopener noreferrer"
                            className="flex-shrink-0 text-white/25 hover:text-indigo-400 transition-colors">
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      <p className="text-xs text-white/40 truncate">{ph.poll_host ? `Polling: ${ph.poll_host}` : 'No NIC address available'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {unreachable && (
                        <p className="text-xs text-red-400 font-medium">{ph.last_error ?? 'Unreachable'}</p>
                      )}
                      {!unreachable && !ok && (
                        <p className="text-xs text-amber-400">No NIC address</p>
                      )}
                      <div className="flex items-center gap-2 text-[11px] text-white/30">
                        {!ph.password_set && <span className="text-amber-400/70">No password</span>}
                        {ok && lastPolled && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {ageStr}
                          </span>
                        )}
                        {!unreachable && ph.queries_today != null && (
                          <span>{ph.queries_today.toLocaleString()} queries</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!unreachable && ph.blocking_enabled !== null && ph.blocking_enabled !== undefined && (
                    <div className="mt-2 pt-2 border-t border-white/[0.05] flex items-center justify-between">
                      <span className="text-xs text-white/30">Blocking</span>
                      <span className={`text-xs font-medium ${ph.blocking_enabled ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {ph.blocking_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={pollNowMutation.isPending}
              onClick={() => pollNowMutation.mutate()}
              className="text-xs text-white/30 hover:text-white/60 transition-colors flex items-center gap-1.5 disabled:opacity-40 mt-1"
            >
              {pollNowMutation.isPending ? <><Loader size={11} className="animate-spin" /> Polling…</> : 'Poll now'}
            </button>
          )}
          </>
        )}
        </GlassCard>
      </div>
      {/* DNS Comparison */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">DNS Record Comparison</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Cross-references Pi-hole custom DNS records against MyNet device DNS entries. Read-only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetchDns()}
            disabled={dnsLoading}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <RefreshCw size={13} className={dnsLoading ? 'animate-spin' : ''} />
            {dnsLoading ? 'Fetching…' : 'Fetch comparison'}
          </button>
        </div>

        {dnsComparison && (
          <GlassCard className="p-0 overflow-hidden">
            {dnsComparison.length === 0 ? (
              <p className="text-xs text-white/30 italic p-4">No DNS entries found in Pi-hole or MyNet.</p>
            ) : (
              <>
                {/* Summary bar */}
                <div className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.06] flex-wrap">
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                    const count = dnsComparison.filter((r: any) => r.status === key).length
                    if (count === 0) return null
                    const Icon = cfg.icon
                    return (
                      <div key={key} className="flex items-center gap-1.5">
                        <Icon size={11} className={cfg.className.split(' ')[0]} />
                        <span className="text-xs text-white/50">{count} {cfg.label}</span>
                      </div>
                    )
                  })}
                  {(() => {
                    const ipCount: Record<string, number> = {}
                    for (const r of dnsComparison) {
                      const ips = new Set<string>([...(r.mynet_ip ? [r.mynet_ip] : []), ...r.pihole_entries.map((e: any) => e.ip)])
                      for (const ip of ips) ipCount[ip] = (ipCount[ip] ?? 0) + 1
                    }
                    const dupIps = new Set(Object.entries(ipCount).filter(([, n]) => n > 1).map(([ip]) => ip))
                    const dupCount = dnsComparison.filter((r: any) => {
                      const ips = [...(r.mynet_ip ? [r.mynet_ip] : []), ...r.pihole_entries.map((e: any) => e.ip)]
                      return ips.some((ip: string) => dupIps.has(ip))
                    }).length
                    if (dupCount === 0) return null
                    return (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-yellow-400" />
                        <span className="text-xs text-white/50">{dupCount} duplicate IP</span>
                      </div>
                    )
                  })()}
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="text-left px-4 py-2 text-white/30 font-medium">Hostname</th>
                        <th className="text-left px-4 py-2 text-white/30 font-medium">MyNet device</th>
                        <th className="text-left px-4 py-2 text-white/30 font-medium">MyNet IP</th>
                        {/* One column per Pi-hole */}
                        {Array.from(new Set(dnsComparison.flatMap((r: any) => r.pihole_entries.map((e: any) => e.pihole_device_name)))).map((name: any) => (
                          <th key={name} className="text-left px-4 py-2 text-white/30 font-medium">{name}</th>
                        ))}
                        <th className="text-left px-4 py-2 text-white/30 font-medium">Status</th>
                        <th className="px-4 py-2 text-white/30 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const piholeNames: string[] = Array.from(new Set(
                          dnsComparison.flatMap((r: any) => r.pihole_entries.map((e: any) => e.pihole_device_name))
                        ))
                        const pending = dnsMutation.isPending

                        // Find IPs that appear against more than one hostname
                        const ipHostnames: Record<string, string[]> = {}
                        for (const r of dnsComparison) {
                          const ips = new Set<string>()
                          if (r.mynet_ip) ips.add(r.mynet_ip)
                          for (const e of r.pihole_entries) ips.add(e.ip)
                          for (const ip of ips) {
                            if (!ipHostnames[ip]) ipHostnames[ip] = []
                            if (!ipHostnames[ip].includes(r.hostname)) ipHostnames[ip].push(r.hostname)
                          }
                        }
                        const duplicateIps = new Set(Object.entries(ipHostnames).filter(([, hs]) => hs.length > 1).map(([ip]) => ip))

                        return dnsComparison.map((row: any) => {
                          const cfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.match
                          const Icon = cfg.icon
                          const piIpByName: Record<string, string> = {}
                          for (const e of row.pihole_entries) piIpByName[e.pihole_device_name] = e.ip
                          const piIp = row.pihole_entries[0]?.ip
                          const rowIps = new Set<string>([
                            ...(row.mynet_ip ? [row.mynet_ip] : []),
                            ...row.pihole_entries.map((e: any) => e.ip),
                          ])
                          const isDuplicate = [...rowIps].some(ip => duplicateIps.has(ip))

                          const btn = (label: string, BtnIcon: React.ElementType, action: string, ip?: string, nicId?: number, style = 'default') => (
                            <button
                              key={action}
                              type="button"
                              disabled={pending}
                              onClick={() => dnsMutation.mutate({ action, hostname: row.hostname, ip, nicId })}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors disabled:opacity-40 border ${
                                style === 'danger'
                                  ? 'text-red-400 border-red-500/20 hover:bg-red-500/10'
                                  : style === 'blue'
                                  ? 'text-blue-400 border-blue-500/20 hover:bg-blue-500/10'
                                  : 'text-white/50 border-white/10 hover:bg-white/5'
                              }`}
                            >
                              <BtnIcon size={10} />
                              {label}
                            </button>
                          )

                          const actions: React.ReactNode[] = []
                          if (!canEdit) { /* viewer — no actions */ } else
                          if (row.status === 'partial') {
                            actions.push(btn('Sync to all Pi-holes', ArrowRight, 'update-pihole', row.mynet_ip, undefined, 'blue'))
                          } else if (row.status === 'mynet_only') {
                            actions.push(btn('Add to Pi-hole', ArrowRight, 'push', row.mynet_ip, undefined, 'blue'))
                          } else if (row.status === 'pihole_only') {
                            if (row.mynet_nic_id) {
                              actions.push(btn(`Add to ${row.mynet_nic_device_name}`, ArrowLeft, 'set-mynet-dns', undefined, row.mynet_nic_id, 'blue'))
                            }
                            actions.push(btn('Remove from Pi-hole', Trash2, 'remove', undefined, undefined, 'danger'))
                          } else if (row.status === 'ip_mismatch') {
                            actions.push(btn('Use MyNet IP', ArrowLeft, 'update-pihole', row.mynet_ip))
                            actions.push(btn('Use Pi-hole IP', ArrowRight, 'update-mynet-ip', piIp))
                          } else if (row.status === 'pihole_conflict') {
                            if (row.mynet_ip) {
                              actions.push(btn('Sync all Pi-holes to MyNet', ArrowLeft, 'update-pihole', row.mynet_ip))
                            } else {
                              actions.push(btn('Remove from all Pi-holes', Trash2, 'remove', undefined, undefined, 'danger'))
                            }
                          } else if (row.status === 'no_ip' && row.mynet_device_id) {
                            actions.push(
                              <button
                                key="goto-device"
                                type="button"
                                onClick={() => navigate(`/devices/${row.mynet_device_id}`)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors border text-white/50 border-white/10 hover:bg-white/5"
                              >
                                <ExternalLink size={10} />
                                Set IP on device
                              </button>
                            )
                          }

                          return (
                            <tr
                              key={row.hostname}
                              className={`border-b border-white/[0.04] transition-colors ${
                                isDuplicate && hoveredDupIp && [...rowIps].some(ip => ip === hoveredDupIp)
                                  ? 'bg-yellow-500/[0.12]'
                                  : isDuplicate
                                  ? 'bg-yellow-500/[0.04] hover:bg-yellow-500/[0.08]'
                                  : 'hover:bg-white/[0.02]'
                              }`}
                              onMouseEnter={() => isDuplicate && setHoveredDupIp([...rowIps].find(ip => duplicateIps.has(ip)) ?? null)}
                              onMouseLeave={() => setHoveredDupIp(null)}
                            >
                              <td className="px-4 py-2.5 font-mono text-white/70">{row.hostname}</td>
                              <td className="px-4 py-2.5">
                                {row.mynet_device_name ? (
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/devices/${row.mynet_device_id}`)}
                                    className="text-indigo-400 hover:text-indigo-300 transition-colors"
                                  >
                                    {row.mynet_device_name}
                                  </button>
                                ) : (
                                  <span className="text-white/20">—</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-white/50">
                                {row.mynet_ip || <span className="text-white/20">—</span>}
                              </td>
                              {piholeNames.map((name: string) => (
                                <td key={name} className="px-4 py-2.5 font-mono text-white/50">
                                  {piIpByName[name] || <span className="text-white/20">—</span>}
                                </td>
                              ))}
                              <td className="px-4 py-2.5">
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${cfg.className}`}>
                                    <Icon size={10} />
                                    {cfg.label}
                                  </span>
                                  {isDuplicate && (() => {
                                    const dupIp = [...rowIps].find(ip => duplicateIps.has(ip))
                                    const conflicts = dupIp
                                      ? (ipHostnames[dupIp] ?? []).filter(h => h !== row.hostname)
                                      : []
                                    const tip = conflicts.length
                                      ? `Same IP as: ${conflicts.join(', ')}`
                                      : 'IP used by multiple hostnames'
                                    return (
                                      <span
                                        title={tip}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium text-yellow-400 bg-yellow-500/10 border-yellow-500/20 cursor-help"
                                      >
                                        Duplicate IP
                                      </span>
                                    )
                                  })()}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {actions.length > 0 ? actions : <span className="text-white/15 text-[10px]">—</span>}
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </GlassCard>
        )}
      </div>
    </div>
  )
}
