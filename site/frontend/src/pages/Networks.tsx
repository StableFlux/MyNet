import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Map, Pencil, Trash2, Wifi, EyeOff, ChevronDown } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'

function InfoItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-white/30 mb-0.5">{label}</p>
      <p className={`text-xs text-white/70 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

export default function Networks() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'
  const [expandedNetwork, setExpandedNetwork] = React.useState<number | null>(null)
  const toggleNetwork = (id: number) => setExpandedNetwork(prev => prev === id ? null : id)

  const { data: networks, isLoading } = useQuery({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/networks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['networks'] })
      qc.invalidateQueries({ queryKey: ['subnet-map'] })
    },
    onError: (err: any) => alert(`Delete failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Networks</h1>
          <p className="text-sm text-white/40 mt-0.5">{networks?.length ?? 0} configured</p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => navigate('/networks/new')} className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Add Network
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glass-card h-32 animate-pulse" />
        ))}</div>
      ) : !networks?.length ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-sm">No networks configured yet.</p>
          <p className="text-xs mt-1">Create a network to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(networks ?? []).map((n: any) => {
            const ssids: any[] = Array.isArray(n.ssids) ? n.ssids : []
            const dnsServers: string[] = [
              ...(n.dns_primary ? [n.dns_primary] : []),
              ...(n.dns_secondary ? [n.dns_secondary] : []),
              ...(Array.isArray(n.dns_extra) ? n.dns_extra : []),
            ]
            const isExpanded = expandedNetwork === n.id

            return (
              <div
                key={n.id}
                className="glass-card overflow-hidden flex"
                style={{
                  borderTopColor: n.color ? n.color + '66' : undefined,
                  background: n.color
                    ? `linear-gradient(160deg, color-mix(in srgb, ${n.color} 10%, var(--card-base-mid)) 0%, var(--card-base-deep) 55%)`
                    : undefined,
                  boxShadow: n.color
                    ? `0 -1px 0 ${n.color}33 inset, var(--card-shadow)`
                    : undefined,
                }}
              >
              <div className="flex-1 min-w-0 p-5 space-y-3">
                {/* Header row */}
                <div className="flex items-start gap-3">
                  <div
                    className="accent-bar w-1 rounded-full flex-shrink-0 self-stretch"
                    style={{ '--accent': n.color } as React.CSSProperties}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">{n.name}</p>
                      {n.vlan_id && (
                        <span
                          className="accent-badge text-[10px] font-mono px-1.5 py-0.5 rounded"
                          style={{ '--accent': n.color, '--accent-muted': `${n.color}22`, '--accent-subtle': `${n.color}55` } as React.CSSProperties}
                        >
                          VLAN {n.vlan_id}
                        </span>
                      )}
                      {n.purpose && (
                        <span className="hidden md:inline text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">{n.purpose}</span>
                      )}
                    </div>
                    {n.purpose && (
                      <span className="md:hidden text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded mt-0.5 inline-block">{n.purpose}</span>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/subnet-map?network=${n.id}`)}
                      className="btn-ghost p-1.5"
                      aria-label={`View subnet map for ${n.name}`}
                    ><Map size={13} /></button>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => navigate(`/networks/${n.id}/edit`)}
                          className="btn-ghost p-1.5"
                          aria-label={`Edit ${n.name}`}
                        ><Pencil size={13} /></button>
                        <button
                          type="button"
                          onClick={() => { if (confirm(`Delete ${n.name}?`)) deleteMutation.mutate(n.id) }}
                          className="btn-danger p-1.5"
                          aria-label={`Delete ${n.name}`}
                        ><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </div>

                {/* Info grid */}
                <div className={`grid grid-cols-2 gap-x-4 gap-y-3 pl-4 ${!isExpanded ? 'hidden md:grid' : ''}`}>
                  {/* IP */}
                  {n.cidr && <InfoItem label="CIDR" value={n.cidr} mono />}
                  {n.gateway && <InfoItem label="Gateway" value={n.gateway} mono />}

                  {/* DHCP */}
                  {(n.dhcp_range_start || n.dhcp_range_end) && (
                    <InfoItem
                      label="DHCP Range"
                      value={`${n.dhcp_range_start ?? '?'} – ${n.dhcp_range_end ?? '?'}`}
                      mono
                    />
                  )}

                  {/* DNS */}
                  {n.dns_auto ? (
                    <InfoItem label="DNS" value="Auto" />
                  ) : dnsServers.length > 0 ? (
                    <div>
                      <p className="text-[10px] text-white/30 mb-0.5">DNS</p>
                      {dnsServers.map((s, i) => (
                        <p key={i} className="text-xs text-white/70 font-mono">{s}</p>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* SSIDs */}
                {ssids.length > 0 && (
                  <div className={`pl-4 space-y-1.5 ${!isExpanded ? 'hidden md:block' : ''}`}>
                    <p className="text-[10px] text-white/30 flex items-center gap-1.5">
                      <Wifi size={10} /> Wireless SSIDs
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {ssids.map((s: any, i: number) => {
                        const name = typeof s === 'string' ? s : (s.ssid ?? '')
                        const password = typeof s === 'object' ? (s.password ?? '') : ''
                        const hidden = typeof s === 'object' ? !!s.hidden : false
                        const bands: string[] = typeof s === 'object'
                          ? (Array.isArray(s.bands) ? s.bands : (s.band ? [s.band] : []))
                          : []
                        const security: string = typeof s === 'object' ? (s.security ?? '') : ''

                        return (
                          <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-glass-border">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {hidden && <EyeOff size={10} className="text-white/30 flex-shrink-0" />}
                              <span className="text-xs font-medium text-white/80 truncate">{name || '—'}</span>
                            </div>
                            {password && (
                              <span className="text-xs font-mono text-white/50">{password}</span>
                            )}
                            {bands.length > 0 && (
                              <span className="text-[10px] text-white/40">{bands.join(' + ')}</span>
                            )}
                            {security && (
                              <span className="text-[10px] text-white/40">{security}</span>
                            )}
                            {!password && (
                              <span className="text-[10px] text-white/25 italic">open</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>{/* end main content */}
              {/* Mobile expand strip */}
              <button
                type="button"
                onClick={() => toggleNetwork(n.id)}
                className="md:hidden flex items-center justify-center w-8 flex-shrink-0 border-l border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                <ChevronDown size={13} className={`text-white/40 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
