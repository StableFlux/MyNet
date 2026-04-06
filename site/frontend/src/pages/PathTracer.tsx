import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { GitBranch, AlertTriangle, ArrowRight, ArrowLeft, ArrowDown, MapPin, Wifi } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { NetworkBadge } from '../components/NetworkBadge'
import { DeviceTypeIcon, HARDWARE_TYPE_ICON } from '../components/DeviceTypeIcon'
import api from '../lib/api'

const HOPS_PER_ROW = 5

const CONNECTION_LABELS: Record<string, string> = {
  uplink: 'Uplink',
  access: 'Access',
  vm: 'Virtual',
  wifi: 'WiFi',
}

const CONNECTION_COLORS: Record<string, string> = {
  uplink: 'text-indigo-400 border-indigo-500/20',
  access: 'text-emerald-400 border-emerald-500/20',
  vm: 'text-purple-400 border-purple-500/20',
  wifi: 'text-sky-400 border-sky-500/20',
}

function PortPill({ label, connType, color }: { label: string; connType: string; color?: string | null }) {
  const typeLabel = CONNECTION_LABELS[connType] ?? connType
  if (color) {
    return (
      <div className="px-2 py-1 rounded-lg border text-center whitespace-nowrap flex-shrink-0"
        style={{ color, borderColor: `${color}44`, backgroundColor: `${color}12` }}>
        <div className="text-[11px] font-mono font-medium leading-tight">{label}</div>
        <div className="text-[9px] leading-tight mt-0.5" style={{ opacity: 0.6 }}>{typeLabel}</div>
      </div>
    )
  }
  const colorClass = CONNECTION_COLORS[connType] ?? 'text-white/40 border-white/10'
  return (
    <div className={`px-2 py-1 rounded-lg border bg-white/[0.03] text-center whitespace-nowrap flex-shrink-0 ${colorClass}`}>
      <div className="text-[11px] font-mono font-medium leading-tight">{label}</div>
      <div className="text-[9px] opacity-60 leading-tight mt-0.5">{typeLabel}</div>
    </div>
  )
}

export default function PathTracer() {
  const navigate = useNavigate()
  const [sourceId, setSourceId] = useState<string>('')
  const [targetId, setTargetId] = useState<string>('')
  const [trace, setTrace] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const { data: devices } = useQuery({
    queryKey: ['devices', 'all'],
    queryFn: async () => { const { data } = await api.get('/devices'); return data },
  })

  const handleTrace = async () => {
    if (!sourceId || !targetId) return
    setLoading(true)
    try {
      const { data } = await api.get(`/topology/path?source_id=${sourceId}&target_id=${targetId}`)
      setTrace(data)
    } finally {
      setLoading(false)
    }
  }

  const deviceOptions = (devices ?? [])
    .filter((d: any) =>
      d.status === 'in_service' &&
      d.nics?.some((n: any) => n.is_active !== false)
    )
    .flatMap((d: any) => {
      const activeNics = (d.nics ?? []).filter((n: any) => n.is_active !== false && n.ip_address)
      if (activeNics.length === 0) {
        return [{ value: String(d.id), label: d.name, ip: undefined }]
      }
      if (activeNics.length === 1) {
        return [{ value: String(d.id), label: d.name, ip: activeNics[0].ip_address }]
      }
      return activeNics.map((n: any) => ({
        value: String(d.id),
        label: `${d.name}${n.label ? ` — ${n.label}` : ''}`,
        ip: n.ip_address,
      }))
    })

  const hops: any[] = trace?.hops ?? []

  // Split hops into rows of up to HOPS_PER_ROW
  const rows: any[][] = []
  for (let i = 0; i < hops.length; i += HOPS_PER_ROW) {
    rows.push(hops.slice(i, i + HOPS_PER_ROW))
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Path Tracer</h1>
        <p className="text-sm text-white/40 mt-0.5">Trace the network path between two devices</p>
      </div>

      <GlassCard>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-white/40 mb-1.5">Source device</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} title="Source device" className="glass-input w-full">
              <option value="" className="bg-surface-overlay">Select source…</option>
              {deviceOptions.map((d: any) => (
                <option key={d.value} value={d.value} className="bg-surface-overlay">
                  {d.label}{d.ip ? ` (${d.ip})` : ''}
                </option>
              ))}
            </select>
          </div>

          <ArrowRight size={16} className="text-white/20 mb-2.5" />

          <div>
            <label className="block text-xs text-white/40 mb-1.5">Destination device</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} title="Destination device" className="glass-input w-full">
              <option value="" className="bg-surface-overlay">Select destination…</option>
              {deviceOptions.map((d: any) => (
                <option key={d.value} value={d.value} className="bg-surface-overlay">
                  {d.label}{d.ip ? ` (${d.ip})` : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleTrace}
            disabled={!sourceId || !targetId || loading}
            className="btn-primary flex items-center gap-2 flex-shrink-0"
          >
            <GitBranch size={15} />
            {loading ? 'Tracing…' : 'Trace'}
          </button>
        </div>
      </GlassCard>

      {!trace && (
        <div className="text-center py-16 text-white/30">
          <GitBranch size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a source and destination, then click Trace</p>
        </div>
      )}

      {trace && (
        <>
          {!trace.found ? (
            <div className="glass-card p-5">
              <div className="flex items-center gap-3 text-amber-400">
                <AlertTriangle size={18} />
                <div>
                  <p className="text-sm font-medium">Path not found</p>
                  <p className="text-xs text-white/40 mt-0.5">No path exists between these devices</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card p-5 space-y-4" style={{ background: 'linear-gradient(160deg, var(--card-base-deepest) 0%, var(--card-base-deepest) 100%)' }}>
              <div className="flex items-center gap-4 flex-wrap">
                <p className="text-xs text-white/40">{hops.length} hops</p>
                {hops.some((h: any) => h.connection_type === 'wifi') && (
                  <div className="flex items-center gap-1.5 text-xs text-sky-400/80">
                    <Wifi size={13} />
                    <span>Wireless hops are a best estimate — the actual AP may differ</span>
                  </div>
                )}
              </div>

              {rows.map((row, rowIndex) => {
                // Odd rows run right-to-left
                const isReversed = rowIndex % 2 === 1
                // For display, reverse the hop order so the snake flows correctly
                const displayedHops = isReversed ? [...row].reverse() : row
                const nextRowFirstHop = rowIndex < rows.length - 1 ? rows[rowIndex + 1][0] : null
                // Vertical connector sits under the edge card that is last in sequence:
                // L→R rows: last in sequence is rightmost → connector on right
                // R→L rows: last in sequence is leftmost  → connector on left
                const vertOnRight = !isReversed

                return (
                  <React.Fragment key={rowIndex}>
                    {/* ── Horizontal row ── */}
                    <div className={`flex items-stretch w-full ${isReversed ? 'justify-end' : ''}`}>
                      {displayedHops.map((hop: any, colIndex: number) => {
                        const isLast = colIndex === displayedHops.length - 1
                        // Original position in full hops array
                        const origIdx = rowIndex * HOPS_PER_ROW + (isReversed ? row.length - 1 - colIndex : colIndex)

                        // Connector metadata comes from the "arriving" hop:
                        //   L→R: the right-hand card (colIndex + 1) is the arriving hop
                        //   R→L: the left-hand card (colIndex)      is the arriving hop
                        //         because flow runs right→left, so the left card arrives from the right
                        const connMeta = isLast ? null : (isReversed ? displayedHops[colIndex] : displayedHops[colIndex + 1])
                        const connType = connMeta?.connection_type ?? ''

                        return (
                          <React.Fragment key={hop.device_id}>
                            {/* Hop card — fixed width, flush to edges on first/last */}
                            <button
                              type="button"
                              onClick={() => navigate(`/devices/${hop.device_id}`)}
                              className="w-36 flex-shrink-0 flex flex-col items-center gap-2 py-3 px-3 rounded-xl
                                         border border-glass-border bg-white/[0.03] hover:bg-white/[0.06]
                                         transition-colors group overflow-hidden"
                              style={hop.current_vlan_color ? {
                                borderTopColor: `${hop.current_vlan_color}55`,
                                background: `linear-gradient(160deg, color-mix(in srgb, ${hop.current_vlan_color} 8%, var(--card-base-mid)) 0%, var(--card-base-deep) 60%)`,
                              } : undefined}
                            >
                              <div className="self-start text-[10px] font-bold text-white/20
                                              group-hover:text-white/40 transition-colors">
                                #{origIdx + 1}
                              </div>
                              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                                <DeviceTypeIcon name={hop.device_type_icon ?? HARDWARE_TYPE_ICON[hop.hardware_type]} size={15} className="text-white/50" />
                              </div>
                              <div className="text-center w-full">
                                <p className="text-xs font-semibold text-white leading-tight line-clamp-2">
                                  {hop.device_name}
                                </p>
                                {(hop.device_type || hop.hardware_type) && (
                                  <p className="text-[10px] text-white/30 mt-0.5 truncate">{hop.device_type ?? hop.hardware_type}</p>
                                )}
                              </div>
                              {hop.location && (
                                <div className="flex items-center gap-1 text-[10px] text-white/20">
                                  <MapPin size={8} />
                                  <span className="truncate max-w-[7rem]">{hop.location}</span>
                                </div>
                              )}
                              {hop.current_vlan != null && <NetworkBadge vlan={hop.current_vlan} color={hop.current_vlan_color} />}
                            </button>

                            {/* Horizontal connector — flex-1 spreads space evenly between cards */}
                            {!isLast && connMeta && (() => {
                              // L→R: left pill = exit from sending card, right pill = entry to receiving card
                              // R→L: reversed — left card is arriving, right card is sending
                              const leftPort  = isReversed ? connMeta.entry_port : connMeta.exit_port
                              const rightPort = isReversed ? connMeta.exit_port  : connMeta.entry_port
                              return (
                                <div className="flex-1 relative flex items-center min-w-[80px]">
                                  {connMeta.is_vlan_boundary && (
                                    <div className="absolute bottom-1/2 left-0 right-0 flex justify-center mb-6 pointer-events-none">
                                      <div className="flex items-center gap-1 text-[9px] text-orange-400 whitespace-nowrap">
                                        <AlertTriangle size={8} /> VLAN boundary
                                      </div>
                                    </div>
                                  )}
                                  <div className="flex items-center w-full gap-1 px-2">
                                    {leftPort
                                      ? <PortPill label={leftPort} connType={connType} color={connMeta.conn_color} />
                                      : connType === 'wifi' && <Wifi size={26} className="flex-shrink-0" style={{ color: connMeta.conn_color ?? '#38bdf8' }} />}
                                    {connType === 'wifi'
                                      ? <div className="flex-1 border-t border-dashed border-white/20" />
                                      : <div className="flex-1 h-px bg-white/10" />}
                                    {isReversed  && <ArrowLeft  size={10} className="text-white/20 flex-shrink-0" />}
                                    {!isReversed && <ArrowRight size={10} className="text-white/20 flex-shrink-0" />}
                                    {connType === 'wifi'
                                      ? <div className="flex-1 border-t border-dashed border-white/20" />
                                      : <div className="flex-1 h-px bg-white/10" />}
                                    {rightPort
                                      ? <PortPill label={rightPort} connType={connType} color={connMeta.conn_color} />
                                      : connType === 'wifi' && <Wifi size={26} className="flex-shrink-0" style={{ color: connMeta.conn_color ?? '#38bdf8' }} />}
                                  </div>
                                </div>
                              )
                            })()}
                          </React.Fragment>
                        )
                      })}
                    </div>

                    {/* ── Vertical connector to next row ── */}
                    {nextRowFirstHop && (() => {
                      const vConnType = nextRowFirstHop.connection_type ?? ''
                      return (
                        <div className={`flex ${vertOnRight ? 'justify-end' : 'justify-start'}`}>
                          <div className="w-36 flex flex-col items-center py-2 gap-0">
                            {/* Exit pill — flush to the card above */}
                            {nextRowFirstHop.exit_port
                              ? <PortPill label={nextRowFirstHop.exit_port} connType={vConnType} color={nextRowFirstHop.conn_color} />
                              : vConnType === 'wifi' && <Wifi size={26} style={{ color: nextRowFirstHop.conn_color ?? '#38bdf8' }} />}
                            {vConnType === 'wifi'
                              ? <div className="border-l border-dashed border-white/20 flex-1 min-h-3" />
                              : <div className="w-px flex-1 min-h-3 bg-white/10" />}
                            {/* VLAN boundary or plain arrow in the middle */}
                            {nextRowFirstHop.is_vlan_boundary ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-[9px] text-orange-400 whitespace-nowrap">
                                  <AlertTriangle size={8} /> VLAN boundary
                                </div>
                                <ArrowDown size={10} className="text-white/20" />
                              </div>
                            ) : (
                              <ArrowDown size={10} className="text-white/20" />
                            )}
                            {vConnType === 'wifi'
                              ? <div className="border-l border-dashed border-white/20 flex-1 min-h-3" />
                              : <div className="w-px flex-1 min-h-3 bg-white/10" />}
                            {/* Entry pill — flush to the card below */}
                            {nextRowFirstHop.entry_port
                              ? <PortPill label={nextRowFirstHop.entry_port} connType={vConnType} color={nextRowFirstHop.conn_color} />
                              : vConnType === 'wifi' && <Wifi size={26} style={{ color: nextRowFirstHop.conn_color ?? '#38bdf8' }} />}
                          </div>
                        </div>
                      )
                    })()}
                  </React.Fragment>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
