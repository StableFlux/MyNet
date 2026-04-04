import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Check, Trash2, Zap, ChevronDown, ChevronUp, ArrowUp, ArrowDown, ShieldAlert } from 'lucide-react'
import api from '../lib/api'

export interface PortDraft {
  id?: number
  port_number: number
  port_name: string
  port_type: 'eth' | 'sfp' | 'sfp+' | 'dac' | 'qsfp'
  poe_enabled: boolean
  poe_budget_w: string
  speed: string
  notes: string
  connected_device_name?: string | null
  connected_nic_label?: string | null
  is_management: boolean
  mgmt_network_id: number | null
  mgmt_ip_address: string
  is_downlink?: boolean
}

const PORT_TYPES: { value: PortDraft['port_type']; label: string; color: string }[] = [
  { value: 'eth',  label: 'ETH',  color: 'bg-blue-500/15 text-blue-300' },
  { value: 'dac',  label: 'DAC',  color: 'bg-amber-500/15 text-amber-300' },
  { value: 'sfp',  label: 'SFP',  color: 'bg-indigo-500/15 text-indigo-300' },
  { value: 'sfp+', label: 'SFP+', color: 'bg-purple-500/15 text-purple-300' },
  { value: 'qsfp', label: 'QSFP', color: 'bg-emerald-500/15 text-emerald-300' },
]
const TYPE_COLOR: Record<string, string> = Object.fromEntries(PORT_TYPES.map((t) => [t.value, t.color]))
const TYPE_LABEL: Record<string, string> = Object.fromEntries(PORT_TYPES.map((t) => [t.value, t.label]))

const SPEEDS_BY_TYPE: Record<string, string[]> = {
  eth:    ['10M', '100M', '1G', '2.5G', '5G', '10G'],
  dac:    ['10G', '25G', '40G', '100G', '400G'],
  sfp:    ['100M', '1G'],
  'sfp+': ['10G', '25G'],
  qsfp:   ['40G', '100G', '200G', '400G', '800G'],
}

function speedsFor(type: string): string[] {
  return SPEEDS_BY_TYPE[type] ?? ['10M', '100M', '1G', '2.5G', '5G', '10G']
}

function portLabel(p: PortDraft): string {
  return p.port_name ? `Port ${p.port_number} / ${p.port_name}` : `Port ${p.port_number}`
}

function makePort(n: number, type: PortDraft['port_type'], speed: string, poe: boolean): PortDraft {
  return { port_number: n, port_name: '', port_type: type, poe_enabled: poe, poe_budget_w: '', speed, notes: '', is_management: false, mgmt_network_id: null, mgmt_ip_address: '' }
}

interface Props {
  deviceId: number
  uplinkPortId?: number | null
  portDisplayRows?: string
  portNumbering?: string
  onPortDisplayRowsChange?: (v: string) => void
  onPortNumberingChange?: (v: string) => void
}

export function SwitchPortsForm({ deviceId, uplinkPortId, portDisplayRows = '2', portNumbering = 'alternating', onPortDisplayRowsChange, onPortNumberingChange }: Props) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  // Default config state
  const [portCount, setPortCount] = useState('')
  const [defaultType, setDefaultType] = useState<PortDraft['port_type']>('eth')
  const [defaultSpeed, setDefaultSpeed] = useState('1G')
  const [defaultPoe, setDefaultPoe] = useState(false)

  const { data: ports = [], isLoading } = useQuery<PortDraft[]>({
    queryKey: ['switch-ports', deviceId],
    queryFn: async () => {
      const { data } = await api.get(`/switch-ports/device/${deviceId}`)
      return data.map((p: any) => ({
        ...p,
        poe_budget_w: p.poe_budget_w != null ? String(p.poe_budget_w) : '',
        speed: p.speed ?? '',
        port_name: p.port_name ?? '',
        notes: p.notes ?? '',
        is_management: p.is_management ?? false,
        mgmt_network_id: p.mgmt_network_id ?? null,
        mgmt_ip_address: p.mgmt_ip_address ?? '',
      }))
    },
  })

  const { data: networks = [] } = useQuery<any[]>({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
  })

useEffect(() => {
    if (ports.length > 0 && portCount === '') setPortCount(String(ports.length))
  }, [ports.length])

  const saveMutation = useMutation({
    mutationFn: async (updated: PortDraft[]) => {
      const payload = updated.map((p) => ({
        port_number: p.port_number,
        port_name: p.port_name || null,
        port_type: p.port_type,
        poe_enabled: p.poe_enabled,
        poe_budget_w: p.poe_budget_w ? Number(p.poe_budget_w) : null,
        speed: p.speed || null,
        notes: p.notes || null,
        is_management: p.is_management,
        mgmt_network_id: p.mgmt_network_id || null,
        mgmt_ip_address: p.mgmt_ip_address || null,
      }))
      const { data } = await api.post(`/switch-ports/device/${deviceId}/bulk`, { ports: payload })
      return data
    },
    onMutate: async (updated) => {
      await qc.cancelQueries({ queryKey: ['switch-ports', deviceId] })
      const previous = qc.getQueryData(['switch-ports', deviceId])
      qc.setQueryData(['switch-ports', deviceId], updated)
      return { previous }
    },
    onError: (_e, _u, ctx: any) => qc.setQueryData(['switch-ports', deviceId], ctx?.previous),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['switch-ports', deviceId] })
      qc.invalidateQueries({ queryKey: ['switch-devices'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (portId: number) => { await api.delete(`/switch-ports/${portId}`) },
    onMutate: async (portId) => {
      await qc.cancelQueries({ queryKey: ['switch-ports', deviceId] })
      const previous = qc.getQueryData(['switch-ports', deviceId])
      qc.setQueryData(['switch-ports', deviceId], (old: PortDraft[] = []) => old.filter((p) => p.id !== portId))
      return { previous }
    },
    onError: (_e, _id, ctx: any) => qc.setQueryData(['switch-ports', deviceId], ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: ['switch-ports', deviceId] }),
  })

  const applyPortCount = (raw: string) => {
    const newCount = Math.max(0, Math.min(96, Number(raw) || 0))
    setPortCount(String(newCount))

    let base: PortDraft[]
    if (newCount > ports.length) {
      const additions = Array.from({ length: newCount - ports.length }, (_, i) =>
        makePort(ports.length + i + 1, defaultType, defaultSpeed, defaultPoe)
      )
      base = [...ports, ...additions]
    } else {
      base = ports.slice(0, newCount)
    }

    saveMutation.mutate(base)
    setEditing(false)
    setExpanded(null)
  }

  const applyPoe = (enabled: boolean) => {
    setDefaultPoe(enabled)
    if (ports.length > 0) {
      saveMutation.mutate(ports.map((p) => ({ ...p, poe_enabled: enabled })))
    }
  }

  const update = (idx: number, patch: Partial<PortDraft>) => {
    const next = ports.map((p, i) => i === idx ? { ...p, ...patch } : p)
    saveMutation.mutate(next)
  }

  const removePort = (p: PortDraft, idx: number) => {
    if (p.id) deleteMutation.mutate(p.id)
    else saveMutation.mutate(ports.filter((_, i) => i !== idx))
    setPortCount(String(ports.length - 1))
  }

  if (isLoading) return <p className="text-xs text-white/30">Loading ports…</p>

  const saving = saveMutation.isPending || deleteMutation.isPending
  const unconfigured = ports.length === 0

  return (
    <div className="space-y-3">

      {/* ── Config bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-white/[0.03] border border-glass-border">

        {/* Port count */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-wider">Ports</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={portCount}
              disabled={!editing && !unconfigured}
              onChange={(e) => setPortCount(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (editing || unconfigured)) applyPortCount(portCount) }}
              aria-label="Number of ports"
              placeholder="0"
              className="glass-input w-16 text-xs text-center disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              min={0} max={96}
            />
            {(editing || unconfigured) && (
              <button type="button" onClick={() => applyPortCount(portCount)} disabled={saving || !portCount}
                aria-label="Apply port count"
                className="text-white/30 hover:text-emerald-400 transition-colors disabled:opacity-20">
                <Check size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Default type */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-wider">Type</label>
          <select value={defaultType} onChange={(e) => {
              const t = e.target.value as PortDraft['port_type']
              setDefaultType(t)
              setDefaultSpeed(speedsFor(t)[0])
            }}
            disabled={!editing && !unconfigured}
            className="glass-input text-xs disabled:opacity-30" title="Default port type">
            {PORT_TYPES.map(({ value, label }) => (
              <option key={value} value={value} className="bg-surface-overlay">{label}</option>
            ))}
          </select>
        </div>

        {/* Default speed */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-wider">Speed</label>
          <select value={defaultSpeed} onChange={(e) => setDefaultSpeed(e.target.value)}
            disabled={!editing && !unconfigured}
            className="glass-input text-xs disabled:opacity-30" title="Default port speed">
            {speedsFor(defaultType).map((s) => (
              <option key={s} value={s} className="bg-surface-overlay">{s}</option>
            ))}
          </select>
        </div>

        {onPortDisplayRowsChange && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-white/40 uppercase tracking-wider">Layout</label>
            <select value={portDisplayRows} onChange={(e) => onPortDisplayRowsChange(e.target.value)}
              disabled={!editing && !unconfigured}
              title="Port layout rows" className="glass-input text-xs disabled:opacity-30">
              <option value="1" className="bg-surface-overlay">Single row</option>
              <option value="2" className="bg-surface-overlay">Dual row</option>
            </select>
          </div>
        )}

        {onPortNumberingChange && (
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] uppercase tracking-wider ${portDisplayRows === '1' || (!editing && !unconfigured) ? 'text-white/20' : 'text-white/40'}`}>Numbering</label>
            <select value={portNumbering} onChange={(e) => onPortNumberingChange(e.target.value)}
              disabled={portDisplayRows === '1' || (!editing && !unconfigured)}
              title="Port numbering order" className="glass-input text-xs disabled:opacity-30">
              <option value="alternating" className="bg-surface-overlay">Alternating</option>
              <option value="sequential" className="bg-surface-overlay">Sequential rows</option>
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-wider">PoE</label>
          <label className={`flex items-center gap-1.5 text-xs text-white/50 h-[30px] ${editing || unconfigured ? 'cursor-pointer' : 'opacity-30 cursor-default'}`}>
            <input type="checkbox" checked={defaultPoe} onChange={(e) => applyPoe(e.target.checked)}
              disabled={!editing && !unconfigured} aria-label="Default PoE enabled" />
            <Zap size={11} className={defaultPoe ? 'text-amber-400' : 'text-white/30'} />
          </label>
        </div>

        <div className="ml-auto self-end">
          {editing || unconfigured ? (
            <button type="button"
              onClick={() => {
                if (unconfigured && portCount) applyPortCount(portCount)
                else { setEditing(false); setExpanded(null) }
              }}
              disabled={saving}
              className="btn-ghost flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300">
              <Check size={13} /> Done
            </button>
          ) : (
            <button type="button" onClick={() => setEditing(true)}
              className="btn-ghost flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70">
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
      </div>

      {/* ── Port list ───────────────────────────────────────────────── */}
      {ports.map((port, idx) => {
        const isOpen = expanded === idx
        const isUplink = uplinkPortId != null && port.id === uplinkPortId
        const isMgmt = port.is_management
        const isDownlink = !!port.is_downlink
        return (
          <div key={port.id ?? `new-${idx}`}
            className={`rounded-lg border overflow-hidden ${isUplink ? 'border-indigo-500/40 bg-indigo-500/[0.04]' : isDownlink ? 'border-indigo-500/20 bg-indigo-500/[0.02]' : isMgmt ? 'border-violet-500/40 bg-violet-500/[0.04]' : 'border-glass-border bg-white/[0.02]'}`}>

            {/* Collapsed row */}
            <div className="flex items-center gap-3 px-3 py-2">
              {/* Port number */}
              <span className="text-xs font-mono text-white/40 w-6 text-right shrink-0">
                {port.port_number}
              </span>
              {isUplink && <ArrowUp size={11} className="text-indigo-400 shrink-0" aria-label="Uplink port" />}
              {isDownlink && !isUplink && <ArrowDown size={11} className="text-indigo-300/60 shrink-0" aria-label="Downlink port" />}
              {isMgmt && <ShieldAlert size={11} className="text-violet-400 shrink-0" aria-label="Management port" />}

              {/* Port name */}
              <span className="text-sm text-white/80 w-40 truncate shrink-0">{portLabel(port)}</span>

              {/* Type badge */}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_COLOR[port.port_type] ?? 'bg-white/10 text-white/50'}`}>
                {TYPE_LABEL[port.port_type]}
              </span>

              {/* Speed */}
              {port.speed && (
                <span className="text-[10px] text-white/40 shrink-0">{port.speed}</span>
              )}

              {/* PoE */}
              {port.poe_enabled && (
                <Zap size={11} className="text-amber-400 shrink-0" aria-label="PoE" />
              )}

              <span className="flex-1" />

              {/* Connected device */}
              {port.connected_device_name && !isUplink && !isDownlink && isMgmt && (
                <span className="text-[10px] text-violet-400/60 truncate max-w-[140px] shrink-0">
                  ↑ {port.connected_device_name}
                </span>
              )}
              {port.connected_device_name && !isUplink && !isDownlink && !isMgmt && (
                <span className="text-[10px] text-white/40 truncate max-w-[140px] shrink-0">
                  → {port.connected_device_name}
                </span>
              )}

              {/* Expand chevron */}
              <button type="button" onClick={() => setExpanded((e) => e === idx ? null : idx)}
                aria-label="Expand port"
                className="text-white/30 hover:text-white/60 transition-colors shrink-0">
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {/* Delete — edit mode only */}
              {editing && (
                <button type="button" onClick={() => removePort(port, idx)} aria-label="Remove port"
                  className="text-white/20 hover:text-red-400 transition-colors shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            {/* ── Expanded / per-port config ─────────────────────── */}
            {isOpen && (
              <div className="px-3 pb-3 pt-2 border-t border-glass-border grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-white/40 mb-1">Port Name</label>
                  <input
                    value={port.port_name}
                    onChange={(e) => update(idx, { port_name: e.target.value })}
                    onBlur={() => saveMutation.mutate(ports)}
                    placeholder="e.g. Uplink, NAS"
                    className="glass-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-white/40 mb-1">Type</label>
                  <select value={port.port_type}
                    onChange={(e) => update(idx, { port_type: e.target.value as any })}
                    className="glass-input w-full text-sm" title="Port type">
                    {PORT_TYPES.map(({ value, label }) => (
                      <option key={value} value={value} className="bg-surface-overlay">{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-white/40 mb-1">Speed</label>
                  <select value={port.speed}
                    onChange={(e) => update(idx, { speed: e.target.value })}
                    className="glass-input w-full text-sm" title="Port speed">
                    <option value="" className="bg-surface-overlay">Unknown</option>
                    {speedsFor(port.port_type).map((s) => (
                      <option key={s} value={s} className="bg-surface-overlay">{s}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <input type="checkbox" id={`poe-${idx}`} checked={port.poe_enabled}
                    onChange={(e) => update(idx, { poe_enabled: e.target.checked })} className="rounded" />
                  <label htmlFor={`poe-${idx}`} className="text-sm text-white/60 flex items-center gap-1">
                    <Zap size={11} className={port.poe_enabled ? 'text-amber-400' : 'text-white/30'} /> PoE Enabled
                  </label>
                </div>
                {port.poe_enabled && (
                  <div>
                    <label className="block text-[10px] text-white/40 mb-1">PoE Budget (W)</label>
                    <input type="number" value={port.poe_budget_w}
                      onChange={(e) => update(idx, { poe_budget_w: e.target.value })}
                      placeholder="30" className="glass-input w-full text-sm" />
                  </div>
                )}
                {port.connected_device_name && (
                  <div className="col-span-2">
                    <label className="block text-[10px] text-white/40 mb-1">Connected Device</label>
                    <p className="text-sm text-white/60">
                      {port.connected_device_name}
                      {port.connected_nic_label && (
                        <span className="text-white/30 ml-1">({port.connected_nic_label})</span>
                      )}
                    </p>
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-[10px] text-white/40 mb-1">Notes</label>
                  <input value={port.notes}
                    onChange={(e) => update(idx, { notes: e.target.value })}
                    onBlur={() => saveMutation.mutate(ports)}
                    placeholder="Any notes about this port…"
                    className="glass-input w-full text-sm" />
                </div>

                {/* Management port */}
                <div className="col-span-2 pt-2 border-t border-glass-border">
                  <label className="flex items-center gap-2 cursor-pointer w-fit mb-2">
                    <input type="checkbox" checked={port.is_management}
                      onChange={(e) => update(idx, {
                        is_management: e.target.checked,
                        ...(e.target.checked && !port.port_name ? { port_name: 'Management' } : {}),
                      })} className="rounded" />
                    <ShieldAlert size={12} className={port.is_management ? 'text-violet-400' : 'text-white/30'} />
                    <span className="text-sm text-white/60">Management Port (OOB)</span>
                  </label>
                  {port.is_management && (
                    <div className="grid grid-cols-2 gap-3 mt-1">
                      <div>
                        <label className="block text-[10px] text-white/40 mb-1">Management Network</label>
                        <select value={port.mgmt_network_id ?? ''}
                          onChange={(e) => update(idx, { mgmt_network_id: e.target.value ? Number(e.target.value) : null })}
                          className="glass-input w-full text-sm" title="Management network">
                          <option value="" className="bg-surface-overlay">— None —</option>
                          {networks.map((n: any) => (
                            <option key={n.id} value={n.id} className="bg-surface-overlay">
                              {n.name}{n.vlan_id ? ` (VLAN ${n.vlan_id})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-white/40 mb-1">Management IP</label>
                        <input value={port.mgmt_ip_address}
                          onChange={(e) => update(idx, { mgmt_ip_address: e.target.value })}
                          onBlur={() => saveMutation.mutate(ports)}
                          placeholder="e.g. 192.168.1.1"
                          className="glass-input w-full text-sm" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {saving && <p className="text-[10px] text-white/30">Saving…</p>}
    </div>
  )
}
