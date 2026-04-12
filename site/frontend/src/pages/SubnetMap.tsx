import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ChevronDown, ExternalLink } from 'lucide-react'
import { NIC_TYPE_ICON } from '../components/DeviceTypeIcon'
import { DEVICE_TYPE_COLORS } from '../theme/colours'
import { useSubnetMapStore } from '../store/subnetMapStore'
import api from '../lib/api'

function StatusPip({ status }: { status: string }) {
  const colors: Record<string, string> = {
    in_service: 'bg-emerald-400',
    undeployed: 'bg-amber-400',
    stock: 'bg-slate-400',
    decommissioned: 'bg-red-400',
  }
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[status] ?? 'bg-white/20'}`} />
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm text-white/70 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

export default function SubnetMap() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { selectedNetworkId, showFree, showDhcp, setSelectedNetworkId, setShowFree, setShowDhcp } = useSubnetMapStore()
  const [expandedIp, setExpandedIp] = useState<string | null>(null)

  const toggleExpand = (ip: string) => setExpandedIp(prev => prev === ip ? null : ip)

  const { data: networks } = useQuery({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
    refetchOnMount: 'always',
  })

  useEffect(() => {
    const paramId = searchParams.get('network') ? Number(searchParams.get('network')) : null
    if (paramId) {
      setSelectedNetworkId(paramId)
    } else if (!selectedNetworkId && networks?.length) {
      setSelectedNetworkId(networks[0].id)
    }
  }, [networks, searchParams])

  const { data: mapData, isLoading, error } = useQuery({
    queryKey: ['subnet-map', selectedNetworkId],
    queryFn: async () => {
      const { data } = await api.get(`/networks/${selectedNetworkId}/subnet-map`)
      return data
    },
    enabled: !!selectedNetworkId,
    refetchOnMount: 'always',
  })

  // Reset expanded state when network changes
  useEffect(() => { setExpandedIp(null) }, [selectedNetworkId])

  const currentNetwork = networks?.find((n: any) => n.id === selectedNetworkId)
  const allEntries: any[] = mapData?.entries ?? []

  const occupied = allEntries.filter(e => e.status === 'occupied')
  const free     = allEntries.filter(e => e.status === 'free')
  const dhcp     = allEntries.filter(e => e.status === 'dhcp')

  const visibleEntries = allEntries.filter(e => {
    if (e.status === 'occupied') return true
    if (e.status === 'free') return showFree
    if (e.status === 'dhcp') return showDhcp
    return true
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Subnet Lists</h1>
        <p className="text-sm text-white/40 mt-0.5">IP address space by network</p>
      </div>

      {/* Network selector */}
      <div className="flex flex-wrap gap-2">
        {(networks ?? []).map((n: any) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setSelectedNetworkId(n.id)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={selectedNetworkId === n.id ? {
              backgroundColor: `${n.color}22`,
              border: `1px solid ${n.color}55`,
              color: n.color,
            } : {
              backgroundColor: 'var(--inline-subtle-bg)',
              border: '1px solid var(--inline-subtle-border)',
              color: 'var(--inline-subtle-text)',
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: n.color }} />
            {n.vlan_id ? `VLAN ${n.vlan_id} — ` : ''}{n.name}
          </button>
        ))}
      </div>

      {!selectedNetworkId && (
        <div className="text-center py-16 text-white/30">
          <p className="text-sm">Select a network above to view its IP space</p>
        </div>
      )}

      {selectedNetworkId && isLoading && (
        <div className="space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card h-12 animate-pulse" />
          ))}
        </div>
      )}

      {selectedNetworkId && !isLoading && error && (
        <div className="glass-card p-4 border border-red-500/30 bg-red-500/10">
          <p className="text-sm text-red-400">Failed to load: {(error as any)?.message ?? 'Unknown error'}</p>
        </div>
      )}

      {selectedNetworkId && !isLoading && !error && (
        <>
          {/* Stats + controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400/70" />
                <span className="text-xs text-white/50">{occupied.length} occupied</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-white/20" />
                <span className="text-xs text-white/50">{free.length} free</span>
              </div>
              {dhcp.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400/50" />
                  <span className="text-xs text-white/50">{dhcp.length} DHCP range</span>
                </div>
              )}
              {mapData?.truncated && (
                <span className="text-xs text-amber-400/80">Showing first 1,024 of {mapData.total_hosts.toLocaleString()} hosts</span>
              )}
              {mapData?.cidr && (
                <span className="text-xs font-mono text-white/30">{mapData.cidr}</span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button type="button"
                onClick={() => setShowFree(!showFree)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  showFree
                    ? 'bg-white/10 border-white/20 text-white/70'
                    : 'bg-transparent border-white/10 text-white/30'
                }`}>
                {showFree ? 'Hide' : 'Show'} free
              </button>
              {dhcp.length > 0 && (
                <button type="button"
                  onClick={() => setShowDhcp(!showDhcp)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    showDhcp
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400/70'
                      : 'bg-transparent border-white/10 text-white/30'
                  }`}>
                  {showDhcp ? 'Hide' : 'Show'} DHCP range
                </button>
              )}
            </div>
          </div>

          {allEntries.length === 0 ? (
            <div className="text-center py-16 text-white/30">
              <p className="text-sm">No data — make sure this network has a CIDR configured</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {visibleEntries.map((entry) => {

                /* ── Occupied ── */
                if (entry.status === 'occupied') {
                  const color = entry.device_type_color ?? DEVICE_TYPE_COLORS[entry.category] ?? '#6366f1'
                  const isDhcpAssigned = entry.address_type === 'dhcp'
                  const isInactive = entry.is_active === false
                  const switchLabel = [entry.switch_device_name, entry.switch_port_label].filter(Boolean).join(' / ')
                  const isExpanded = expandedIp === entry.ip
                  const NicIcon = NIC_TYPE_ICON[(entry.nic_type ?? '').toUpperCase()] ?? NIC_TYPE_ICON.ETH

                  return (
                    <div
                      key={entry.ip}
                      className={`rounded-lg border overflow-hidden transition-all ${isInactive ? 'opacity-50' : ''}`}
                      style={{ backgroundColor: `${color}0d`, borderColor: `${color}33` }}
                    >
                      {/* Row header — always visible */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(entry.ip)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left group"
                      >
                        <StatusPip status={entry.device_status ?? 'in_service'} />

                        <span className="font-mono text-sm text-white/75 w-28 flex-shrink-0 group-hover:text-white/90 transition-colors truncate">
                          {entry.ip}
                        </span>

                        <span className="flex-1 text-sm font-medium text-white/85 group-hover:text-white transition-colors truncate">
                          {entry.device_name}
                        </span>

                        {isDhcpAssigned && (
                          <span className="text-[9px] px-1.5 py-px rounded bg-amber-500/15 text-amber-400/80 border border-amber-500/25 flex-shrink-0 hidden sm:inline">DHCP</span>
                        )}

                        {entry.category && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 hidden sm:inline"
                            style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}>
                            {entry.category}
                          </span>
                        )}

                        <ChevronDown
                          size={14}
                          className={`text-white/25 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {/* Expanded drawer */}
                      {isExpanded && (
                        <div className="px-4 pt-2 pb-3 border-t"
                          style={{ borderColor: `${color}22`, backgroundColor: `${color}08` }}>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                            {(entry.nic_type || entry.nic_label) && (
                              <div>
                                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">NIC</p>
                                <div className="flex items-center gap-1.5">
                                  <NicIcon size={12} className="text-white/40 flex-shrink-0" />
                                  <span className="text-sm text-white/70 font-mono truncate">
                                    {entry.nic_label || entry.nic_type}
                                  </span>
                                </div>
                              </div>
                            )}
                            {entry.mac && <DetailField label="MAC" value={entry.mac} mono />}
                            {entry.dns_entry && <DetailField label="DNS" value={entry.dns_entry} mono />}
                            {(entry.brand || entry.model) && (
                              <DetailField label="Brand / Model" value={[entry.brand, entry.model].filter(Boolean).join(' ')} />
                            )}
                            {switchLabel && <DetailField label="Switch Port" value={switchLabel} mono />}
                            {entry.location && <DetailField label="Location" value={entry.location} />}
                            {isDhcpAssigned && (
                              <div>
                                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Address</p>
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80 border border-amber-500/25 font-mono">DHCP assigned</span>
                              </div>
                            )}
                            {isInactive && (
                              <div>
                                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">NIC state</p>
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-white/10">Disabled</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-3 pt-2.5 border-t flex items-center gap-3" style={{ borderColor: `${color}18` }}>
                            <button
                              type="button"
                              onClick={() => navigate(`/devices/${entry.device_id}`)}
                              className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                            >
                              <ExternalLink size={11} />
                              View device
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }

                /* ── Gateway ── */
                if (entry.status === 'gateway') {
                  return (
                    <div key={entry.ip}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.06]">
                      <span className="font-mono text-sm text-sky-300/70 w-28 flex-shrink-0">{entry.ip}</span>
                      <span className="text-xs text-sky-400/60 font-medium">Gateway</span>
                    </div>
                  )
                }

                /* ── DHCP range ── */
                if (entry.status === 'dhcp') {
                  return (
                    <div key={entry.ip}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-amber-500/10 bg-amber-500/[0.04]">
                      <span className="font-mono text-sm text-white/30 w-28 flex-shrink-0">{entry.ip}</span>
                      <span className="text-xs text-amber-500/50">DHCP range</span>
                    </div>
                  )
                }

                /* ── Free ── */
                return (
                  <button
                    type="button"
                    key={entry.ip}
                    onClick={() => navigate(`/devices/new?ip=${entry.ip}&network=${selectedNetworkId}`)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition-colors group text-left"
                  >
                    <span className="font-mono text-sm text-white/25 group-hover:text-white/50 transition-colors w-28 flex-shrink-0">
                      {entry.ip}
                    </span>
                    <span className="text-xs text-white/20 group-hover:text-white/45 transition-colors flex items-center gap-1">
                      <Plus size={10} /> Available
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
