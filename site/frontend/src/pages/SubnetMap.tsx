import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Wifi, Cable, Server } from 'lucide-react'
import { DEVICE_TYPE_COLORS } from '../theme/colours'
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

export default function SubnetMap() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [selectedNetworkId, setSelectedNetworkId] = useState<number | null>(
    searchParams.get('network') ? Number(searchParams.get('network')) : null
  )
  const [showFree, setShowFree] = useState(true)
  const [showDhcp, setShowDhcp] = useState(true)

  const { data: networks } = useQuery({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!selectedNetworkId && networks?.length) {
      setSelectedNetworkId(networks[0].id)
    }
  }, [networks])

  const { data: mapData, isLoading, error } = useQuery({
    queryKey: ['subnet-map', selectedNetworkId],
    queryFn: async () => {
      const { data } = await api.get(`/networks/${selectedNetworkId}/subnet-map`)
      return data
    },
    enabled: !!selectedNetworkId,
    refetchOnMount: 'always',
  })

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
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.5)',
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
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card h-14 animate-pulse" />
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
            {/* Stats */}
            <div className="flex items-center gap-3">
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
              {mapData?.cidr && (
                <span className="text-xs font-mono text-white/30">{mapData.cidr}</span>
              )}
            </div>

            {/* Toggles */}
            <div className="ml-auto flex items-center gap-2">
              <button type="button"
                onClick={() => setShowFree(v => !v)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  showFree
                    ? 'bg-white/10 border-white/20 text-white/70'
                    : 'bg-transparent border-white/10 text-white/30'
                }`}>
                {showFree ? 'Hide' : 'Show'} free
              </button>
              {dhcp.length > 0 && (
                <button type="button"
                  onClick={() => setShowDhcp(v => !v)}
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
            <>
            {/* Column header */}
            <div className="grid items-center px-4 pb-1"
              style={{ gridTemplateColumns: '9rem 16rem 5rem 11rem 13rem 1fr 9rem 9rem 8rem' }}>
              {['IP', 'Name', 'NIC', 'MAC', 'DNS', 'Brand / Model', 'Switch Port', 'Location', 'Type'].map(h => (
                <span key={h} className="text-[10px] uppercase tracking-wider text-white/20 font-medium">{h}</span>
              ))}
            </div>

            <div className="space-y-0.5">
              {visibleEntries.map((entry) => {
                const gridStyle = { gridTemplateColumns: '9rem 16rem 5rem 11rem 13rem 1fr 9rem 9rem 8rem' }
                const gridClass = "w-full grid items-center px-4 py-1 rounded-lg border transition-all text-left group"

                if (entry.status === 'occupied') {
                  const color = entry.device_type_color ?? DEVICE_TYPE_COLORS[entry.category] ?? '#6366f1'
                  const isDhcpAssigned = entry.address_type === 'dhcp'
                  const isInactive = entry.is_active === false
                  const switchLabel = [entry.switch_device_name, entry.switch_port_label].filter(Boolean).join(' / ')
                  return (
                    <button
                      type="button"
                      key={entry.ip}
                      onClick={() => navigate(`/devices/${entry.device_id}`)}
                      className={`${gridClass} ${isInactive ? 'opacity-40' : ''}`}
                      style={{ ...gridStyle, backgroundColor: isInactive ? 'rgba(255,255,255,0.02)' : `${color}0d`, borderColor: isInactive ? 'rgba(255,255,255,0.06)' : `${color}33` }}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className={`font-mono text-sm transition-colors truncate ${isInactive ? 'text-white/40' : 'text-white/80 group-hover:text-white'}`}>
                          {entry.ip}
                        </span>
                        {isDhcpAssigned && (
                          <span className="text-[9px] px-1 py-px rounded bg-amber-500/15 text-amber-400/70 border border-amber-500/20 flex-shrink-0">DHCP</span>
                        )}
                        {isInactive && (
                          <span className="text-[9px] px-1 py-px rounded bg-white/5 text-white/30 border border-white/10 flex-shrink-0">disabled</span>
                        )}
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusPip status={entry.device_status ?? 'in_service'} />
                        <span className="text-sm font-medium text-white/90 truncate group-hover:text-white transition-colors">
                          {entry.device_name}
                        </span>
                      </div>
                      <span className="flex items-center gap-1 text-white/25 group-hover:text-white/45 transition-colors">
                        {entry.nic_type === 'WIFI' ? <Wifi size={12} /> : entry.nic_type === 'VIRT' ? <Server size={12} /> : <Cable size={12} />}
                        <span className="font-mono text-xs truncate">{entry.nic_label ?? ''}</span>
                      </span>
                      <span className="font-mono text-xs text-white/20 truncate group-hover:text-white/40 transition-colors">
                        {entry.mac ?? ''}
                      </span>
                      <span className="font-mono text-xs text-white/35 truncate group-hover:text-white/55 transition-colors">
                        {entry.dns_entry ?? ''}
                      </span>
                      <span className="text-xs text-white/30 truncate">
                        {[entry.brand, entry.model].filter(Boolean).join(' ')}
                      </span>
                      <span className="font-mono text-xs text-white/25 truncate">
                        {switchLabel}
                      </span>
                      <span className="text-xs text-white/25 truncate">
                        {entry.location ?? ''}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full truncate"
                        style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}>
                        {entry.category ?? ''}
                      </span>
                    </button>
                  )
                }

                if (entry.status === 'gateway') {
                  return (
                    <div key={entry.ip}
                      className={`${gridClass} border-sky-500/20 bg-sky-500/[0.06]`}
                      style={gridStyle}>
                      <span className="font-mono text-sm text-sky-300/70">{entry.ip}</span>
                      <span className="text-xs text-sky-400/60 font-medium col-span-8">Gateway</span>
                    </div>
                  )
                }

                if (entry.status === 'dhcp') {
                  return (
                    <div key={entry.ip}
                      className={`${gridClass} border-amber-500/10 bg-amber-500/[0.04]`}
                      style={gridStyle}>
                      <span className="font-mono text-sm text-white/30">{entry.ip}</span>
                      <span className="text-xs text-amber-500/50 col-span-8">DHCP range</span>
                    </div>
                  )
                }

                // free
                return (
                  <button
                    type="button"
                    key={entry.ip}
                    onClick={() => navigate(`/devices/new?ip=${entry.ip}&network=${selectedNetworkId}`)}
                    className={`${gridClass} border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10`}
                    style={gridStyle}
                  >
                    <span className="font-mono text-sm text-white/25 group-hover:text-white/50 transition-colors">
                      {entry.ip}
                    </span>
                    <span className="text-xs text-white/15 group-hover:text-white/40 transition-colors flex items-center gap-1">
                      <Plus size={10} /> Available
                    </span>
                  </button>
                )
              })}
            </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
