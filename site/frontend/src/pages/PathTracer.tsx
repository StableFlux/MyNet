import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { GitBranch, AlertTriangle, ArrowDown, MapPin, Wifi } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { NetworkBadge } from '../components/NetworkBadge'
import { DeviceTypeIcon, HARDWARE_TYPE_ICON } from '../components/DeviceTypeIcon'
import api from '../lib/api'

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
  const [error, setError] = useState<string | null>(null)

  const { data: devices } = useQuery({
    queryKey: ['devices', 'all'],
    queryFn: async () => { const { data } = await api.get('/devices'); return data },
  })

  const handleTrace = async () => {
    if (!sourceId || !targetId) return
    setLoading(true)
    setError(null)
    setTrace(null)
    try {
      const { data } = await api.get(`/topology/path?source_id=${sourceId}&target_id=${targetId}`)
      setTrace(data)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Request failed')
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Path Tracer</h1>
        <p className="text-sm text-white/40 mt-0.5">Trace the network path between two devices</p>
      </div>

      <GlassCard>
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-white/40 mb-1.5">Source device</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} title="Source device" className="glass-input w-full">
              <option value="" className="bg-surface-overlay">Select source…</option>
              {deviceOptions.map((d: any) => (
                <option key={`${d.value}-${d.ip ?? d.label}`} value={d.value} className="bg-surface-overlay">
                  {d.label}{d.ip ? ` (${d.ip})` : ''}
                </option>
              ))}
            </select>
          </div>

          <ArrowDown size={16} className="text-white/20 mb-2.5 sm:rotate-[-90deg]" />

          <div>
            <label className="block text-xs text-white/40 mb-1.5">Destination device</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} title="Destination device" className="glass-input w-full">
              <option value="" className="bg-surface-overlay">Select destination…</option>
              {deviceOptions.map((d: any) => (
                <option key={`${d.value}-${d.ip ?? d.label}`} value={d.value} className="bg-surface-overlay">
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

      {error && (
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 text-red-400">
            <AlertTriangle size={18} />
            <div>
              <p className="text-sm font-medium">Trace failed</p>
              <p className="text-xs text-white/40 mt-0.5 font-mono">{error}</p>
            </div>
          </div>
        </div>
      )}

      {!trace && !error && (
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
            <div className="glass-card p-4 space-y-0"
              style={{ background: 'linear-gradient(160deg, var(--card-base-deepest) 0%, var(--card-base-deepest) 100%)' }}>
              {/* Header */}
              <div className="flex items-center gap-4 flex-wrap mb-4">
                <p className="text-xs text-white/40">{hops.length} hops</p>
                {trace?.has_imprecise_wifi && (
                  <div className="flex items-center gap-1.5 text-xs text-sky-400/80">
                    <Wifi size={13} />
                    <span>Wireless hops are a best estimate — the actual AP may differ</span>
                  </div>
                )}
              </div>

              {/* Vertical hop list */}
              {hops.map((hop: any, idx: number) => {
                const isLast = idx === hops.length - 1
                // Connection metadata is stored on the arriving hop
                const connMeta = !isLast ? hops[idx + 1] : null
                const connType = connMeta?.connection_type ?? ''

                return (
                  <React.Fragment key={hop.device_id}>
                    {/* ── Hop card ── */}
                    <button
                      type="button"
                      onClick={() => navigate(`/devices/${hop.device_id}`)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-glass-border
                                 bg-white/[0.03] hover:bg-white/[0.06] transition-colors group text-left"
                      style={hop.current_vlan_color ? {
                        borderTopColor: `${hop.current_vlan_color}55`,
                        background: `linear-gradient(160deg, color-mix(in srgb, ${hop.current_vlan_color} 8%, var(--card-base-mid)) 0%, var(--card-base-deep) 60%)`,
                      } : undefined}
                    >
                      {/* Hop number */}
                      <span className="text-[10px] font-bold text-white/20 group-hover:text-white/40 transition-colors w-4 flex-shrink-0 text-right">
                        {idx + 1}
                      </span>

                      {/* Device icon */}
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                        <DeviceTypeIcon
                          name={hop.device_type_icon ?? HARDWARE_TYPE_ICON[hop.hardware_type]}
                          size={15}
                          className="text-white/50"
                        />
                      </div>

                      {/* Name + type + location */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white leading-tight truncate">
                          {hop.device_name}
                        </p>
                        <p className="text-[11px] text-white/30 mt-0.5 truncate">
                          {[hop.device_type ?? hop.hardware_type, hop.location].filter(Boolean).join(' · ')}
                        </p>
                      </div>

                      {/* VLAN badge */}
                      {hop.current_vlan != null && (
                        <NetworkBadge vlan={hop.current_vlan} color={hop.current_vlan_color} />
                      )}
                    </button>

                    {/* ── Vertical connector to next hop ── */}
                    {connMeta && (
                      <div className="flex flex-col items-center py-1 gap-1">
                        {/* Exit port (leaving previous hop) */}
                        {connMeta.exit_port && (
                          <PortPill label={connMeta.exit_port} connType={connType} color={connMeta.conn_color} />
                        )}
                        {connType === 'wifi' && !connMeta.exit_port && (
                          <Wifi size={14} style={{ color: connMeta.conn_color ?? '#38bdf8' }} />
                        )}

                        {/* Line + arrow */}
                        <div className="flex flex-col items-center gap-0.5">
                          {connType === 'wifi'
                            ? <div className="w-px h-3 border-l border-dashed border-white/20" />
                            : <div className="w-px h-3 bg-white/10" />}

                          {connMeta.is_vlan_boundary ? (
                            <div className="flex items-center gap-1 text-[9px] text-orange-400 whitespace-nowrap py-0.5">
                              <AlertTriangle size={8} /> VLAN boundary
                            </div>
                          ) : null}

                          <ArrowDown size={10} className="text-white/20" />

                          {connType === 'wifi'
                            ? <div className="w-px h-3 border-l border-dashed border-white/20" />
                            : <div className="w-px h-3 bg-white/10" />}
                        </div>

                        {/* Entry port (arriving at next hop) */}
                        {connMeta.entry_port && (
                          <PortPill label={connMeta.entry_port} connType={connType} color={connMeta.conn_color} />
                        )}
                        {connType === 'wifi' && !connMeta.entry_port && (
                          <Wifi size={14} style={{ color: connMeta.conn_color ?? '#38bdf8' }} />
                        )}
                      </div>
                    )}
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
