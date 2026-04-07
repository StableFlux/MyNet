import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine, RefreshCw, Plus, ExternalLink, CheckCircle2, AlertCircle, ChevronLeft, HelpCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { GlassCard } from '../components/GlassCard'
import { useNetworkScanStore } from '../store/networkScanStore'
import api from '../lib/api'

interface NetworkOption {
  id: number
  name: string
  cidr: string | null
  vlan_id: number | null
  color: string
}

interface ScanHost {
  ip: string
  hostname: string | null
  mac: string | null
  manufacturer: string | null
  network_id: number | null
  network_name: string | null
  vlan_id: number | null
  known: boolean
  dhcp_lease: boolean
  device_id?: number
  device_name?: string
  nic_label?: string
  role?: string  // e.g. "Gateway", "DNS Server" — set when known via network config, no device_id
}

interface ScanResult {
  hosts: ScanHost[]
  total: number
  unknown: number
}

function hostCount(cidr: string): number {
  try {
    const prefix = parseInt(cidr.split('/')[1], 10)
    if (prefix >= 31) return 1
    return Math.pow(2, 32 - prefix) - 2
  } catch {
    return 0
  }
}

export default function NetworkScan() {
  const navigate = useNavigate()
  const { result, selectedIds, filter, setResult, setSelectedIds, setFilter } = useNetworkScanStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: allNetworks } = useQuery<NetworkOption[]>({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
  })

  const networks = (allNetworks ?? []).filter((n) => n.cidr)

  useEffect(() => {
    if (networks.length && selectedIds.size === 0) {
      setSelectedIds(new Set(networks.map((n) => n.id)))
    }
  }, [networks.length])

  const allSelected = networks.length > 0 && selectedIds.size === networks.length

  function toggleNetwork(id: number) {
    const next = new Set(selectedIds)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelectedIds(next)
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set<number>() : new Set(networks.map((n) => n.id)))
  }

  const selectedNetworks = networks.filter((n) => selectedIds.has(n.id))
  const totalHosts = selectedNetworks.reduce((sum, n) => sum + (n.cidr ? hostCount(n.cidr) : 0), 0)

  async function runScan() {
    if (selectedIds.size === 0) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      selectedIds.forEach((id) => params.append('network_ids', String(id)))
      const { data } = await api.get(`/scan?${params.toString()}`)
      setResult(data)
      const unrecognised = data.hosts.filter((h: ScanHost) => !h.known && !h.dhcp_lease).length
      const dhcp = data.hosts.filter((h: ScanHost) => h.dhcp_lease).length
      setFilter(unrecognised > 0 ? 'unknown' : dhcp > 0 ? 'dhcp' : 'all')
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Scan failed. Check that the server has CAP_NET_RAW / runs as root.')
    } finally {
      setLoading(false)
    }
  }

  const displayed = result?.hosts.filter((h) => {
    if (filter === 'unknown') return !h.known && !h.dhcp_lease
    if (filter === 'dhcp') return h.dhcp_lease
    if (filter === 'known') return h.known
    return true
  }) ?? []

  const unknownCount = result?.hosts.filter((h) => !h.known && !h.dhcp_lease).length ?? 0
  const dhcpCount = result?.hosts.filter((h) => h.dhcp_lease).length ?? 0

  function addDeviceUrl(h: ScanHost) {
    const params = new URLSearchParams()
    if (h.ip) params.set('ip', h.ip)
    if (h.mac) params.set('mac', h.mac)
    if (h.hostname) params.set('hostname', h.hostname)
    if (h.network_id) params.set('network', String(h.network_id))
    return `/devices/new?${params.toString()}`
  }

  // Find color for a result row's network
  const networkColorMap = Object.fromEntries(networks.map((n) => [n.id, n.color]))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="btn-ghost flex items-center gap-1.5 text-sm"
        >
          <ChevronLeft size={14} />
          Settings
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Network Scan</h1>
          <p className="text-xs text-white/40 mt-0.5">Discover devices on your subnets. Results are read-only — nothing is added automatically.</p>
        </div>
        <button
          type="button"
          onClick={runScan}
          disabled={loading || selectedIds.size === 0}
          className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading
            ? <><RefreshCw size={14} className="animate-spin" /> Scanning…</>
            : <><ScanLine size={14} /> {result ? 'Re-scan' : 'Scan Now'}</>
          }
        </button>
      </div>

      {/* Network selection */}
      <GlassCard className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">Networks to Scan</p>
            <p className="text-xs text-white/40 mt-0.5">
              {selectedIds.size === 0
                ? 'No networks selected'
                : allSelected
                  ? `All ${networks.length} network${networks.length !== 1 ? 's' : ''} selected`
                  : `${selectedIds.size} of ${networks.length} selected`
              }
              {totalHosts > 0 && (
                <span className="ml-2 text-white/25">· ~{totalHosts.toLocaleString()} addresses</span>
              )}
            </p>
          </div>
          {networks.length > 1 && (
            <button type="button" onClick={toggleAll} className="btn-ghost text-xs flex-shrink-0">
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>

        {networks.length === 0 ? (
          <p className="text-xs text-white/30 italic">No networks with a defined CIDR. Add a CIDR to a network to enable scanning.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {networks.map((n) => {
              const active = selectedIds.has(n.id)
              const color = n.color ?? '#6366f1'
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => toggleNetwork(n.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all"
                  style={active ? {
                    backgroundColor: `${color}18`,
                    borderColor: `${color}55`,
                  } : {
                    backgroundColor: 'var(--inline-inactive-bg)',
                    borderColor: 'var(--inline-inactive-border)',
                  }}
                >
                  {/* Color dot */}
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0 transition-all"
                    style={{ backgroundColor: active ? color : 'var(--inline-subtle-text)' }}
                  />

                  {/* Name + meta */}
                  <span className="flex-1 min-w-0">
                    <span
                      className="block text-xs font-semibold leading-tight truncate transition-colors"
                      style={{ color: active ? color : 'var(--inline-subtle-text)' }}
                    >
                      {n.name}
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5">
                      {n.cidr && (
                        <span className="font-mono text-[10px] leading-none" style={{ color: 'var(--inline-inactive-text)' }}>
                          {n.cidr}
                        </span>
                      )}
                      {n.vlan_id && (
                        <span
                          className="text-[10px] leading-none font-medium px-1 py-0.5 rounded"
                          style={active ? {
                            color: color,
                            backgroundColor: `${color}20`,
                          } : {
                            color: 'var(--inline-inactive-text)',
                            backgroundColor: 'var(--inline-inactive-bg)',
                          }}
                        >
                          VLAN {n.vlan_id}
                        </span>
                      )}
                    </span>
                  </span>

                  {/* Host count */}
                  {n.cidr && (
                    <span className="text-[10px] flex-shrink-0 font-mono leading-none" style={{ color: 'var(--inline-inactive-text)' }}>
                      {hostCount(n.cidr).toLocaleString()}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </GlassCard>

      {/* Error */}
      {error && (
        <GlassCard className="border-red-500/30 flex items-start gap-3">
          <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </GlassCard>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <GlassCard className="py-14 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/15 flex items-center justify-center">
            <ScanLine size={28} className="text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">No scan results yet</p>
            <p className="text-xs text-white/40 mt-1">
              {selectedIds.size === 0
                ? 'Select at least one network above, then click Scan Now.'
                : 'Click Scan Now to ping-sweep the selected subnet(s).'}
            </p>
          </div>
        </GlassCard>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <span className="text-white font-semibold text-sm">{result.total}</span>
              {' '}host{result.total !== 1 ? 's' : ''} found
              {unknownCount > 0 && <>
                <span className="text-white/20">·</span>
                <span className="text-amber-400 font-semibold">{unknownCount}</span> unrecognised
              </>}
              {dhcpCount > 0 && <>
                <span className="text-white/20">·</span>
                <span className="text-sky-400 font-semibold">{dhcpCount}</span> DHCP
              </>}
            </div>
            <div className="flex gap-1 ml-auto">
              {([
                { key: 'all', label: 'All' },
                { key: 'unknown', label: 'Unrecognised' },
                { key: 'dhcp', label: 'DHCP' },
                { key: 'known', label: 'Known' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                    filter === key ? 'bg-indigo-600 text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <GlassCard className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-glass-border text-xs text-white/40 uppercase tracking-widest">
                  <th className="text-left px-4 py-3 font-medium w-8"></th>
                  <th className="text-left px-4 py-3 font-medium">IP Address</th>
                  <th className="text-left px-4 py-3 font-medium">Hostname</th>
                  <th className="text-left px-4 py-3 font-medium">MAC Address</th>
                  <th className="text-left px-4 py-3 font-medium">Manufacturer</th>
                  <th className="text-left px-4 py-3 font-medium">Network / VLAN</th>
                  <th className="text-left px-4 py-3 font-medium">Device</th>
                  <th className="px-4 py-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/50">
                {displayed.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-xs text-white/30">
                      No hosts match this filter.
                    </td>
                  </tr>
                )}
                {displayed.map((h) => {
                  const netColor = h.network_id ? networkColorMap[h.network_id] : undefined
                  return (
                    <tr key={h.ip} className="hover:bg-white/[0.03] transition-colors">
                      {/* Status */}
                      <td className="px-4 py-3">
                        {h.known
                          ? <span title="Known"><CheckCircle2 size={14} className="text-emerald-400" /></span>
                          : h.dhcp_lease
                            ? <span title="DHCP lease — not in database"><HelpCircle size={14} className="text-sky-400" /></span>
                            : <span title="Unrecognised device"><AlertCircle size={14} className="text-amber-400" /></span>
                        }
                      </td>

                      {/* IP */}
                      <td className="px-4 py-3 font-mono text-xs text-white/90 whitespace-nowrap">{h.ip}</td>

                      {/* Hostname */}
                      <td className="px-4 py-3 text-xs text-white/60 max-w-[180px] truncate">
                        {h.hostname ?? <span className="text-white/20">—</span>}
                      </td>

                      {/* MAC */}
                      <td className="px-4 py-3 font-mono text-xs text-white/60 whitespace-nowrap">
                        {h.mac ?? <span className="text-white/20">—</span>}
                      </td>

                      {/* Manufacturer */}
                      <td className="px-4 py-3 text-xs text-white/60 max-w-[140px] truncate">
                        {h.manufacturer ?? <span className="text-white/20">—</span>}
                      </td>

                      {/* Network / VLAN */}
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {h.network_name ? (
                          <span className="flex items-center gap-1.5">
                            {netColor && (
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: netColor }} />
                            )}
                            <span className="text-white/80">{h.network_name}</span>
                            {h.vlan_id && (
                              <span
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{
                                  color: netColor ?? 'rgba(255,255,255,0.4)',
                                  backgroundColor: netColor ? `${netColor}20` : 'rgba(255,255,255,0.06)',
                                }}
                              >
                                VLAN {h.vlan_id}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>

                      {/* Device (if known) */}
                      <td className="px-4 py-3 text-xs">
                        {h.device_id ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/devices/${h.device_id}`)}
                            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            {h.device_name}
                            <ExternalLink size={11} />
                          </button>
                        ) : h.role ? (
                          <span className="text-emerald-400/80 font-medium">{h.role}</span>
                        ) : h.dhcp_lease ? (
                          <span className="text-sky-400/70 font-medium">DHCP lease</span>
                        ) : (
                          <span className="text-amber-400/70 font-medium">Unrecognised</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-right">
                        {!h.known && (
                          <button
                            type="button"
                            onClick={() => navigate(addDeviceUrl(h))}
                            className="btn-ghost text-xs flex items-center gap-1 py-1 px-2 ml-auto"
                            title="Add as new device"
                          >
                            <Plus size={12} />
                            Add
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
