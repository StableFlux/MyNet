import { Cable, Wifi, X, Plus } from 'lucide-react'
import clsx from 'clsx'

export interface NicDraft {
  id?: number
  label: string
  nic_type: 'ETH' | 'WIFI' | 'VIRT'
  mac: string
  ip_address: string
  dns_entry: string
  network_id: string
  address_type: 'reserved' | 'static' | 'dhcp'
  gateway: string
  subnet_mask: string
  dns_server_1: string
  dns_server_2: string
  switch_port: string        // legacy fallback text
  switch_port_id: string     // FK to switch_ports.id
  switch_device_id: string   // for the first dropdown
  poe_enabled: boolean
  ssid: string
  band: string
  notes: string
  is_active: boolean
}

export const emptyNic = (): NicDraft => ({
  label: '', nic_type: 'ETH', mac: '', ip_address: '', dns_entry: '',
  network_id: '', address_type: 'reserved', gateway: '',
  subnet_mask: '', dns_server_1: '', dns_server_2: '',
  switch_port: '', switch_port_id: '', switch_device_id: '',
  poe_enabled: false, ssid: '', band: '', notes: '', is_active: true,
})

interface SwitchPort {
  id: number
  label: string
  port_number: number
  connected_device_id: number | null
  connected_device_name: string | null
  connected_nic_label: string | null
}

interface SwitchDevice {
  id: number
  name: string
  switch_ports: SwitchPort[]
}

interface Props {
  nics: NicDraft[]
  onChange: (nics: NicDraft[]) => void
  networks: { id: number; name: string; vlan_id: number | null; color: string }[]
  switchDevices?: SwitchDevice[]
  readOnly?: boolean
}

export function NicForm({ nics, onChange, networks, switchDevices = [], readOnly = false }: Props) {
  const update = (i: number, patch: Partial<NicDraft>) => {
    const next = nics.map((n, idx) => idx === i ? { ...n, ...patch } : n)
    onChange(next)
  }

  const remove = (i: number) => onChange(nics.filter((_, idx) => idx !== i))

  const add = (type: 'ETH' | 'WIFI') => onChange([...nics, { ...emptyNic(), nic_type: type }])

  return (
    <div className="space-y-3">
      {nics.map((nic, i) => (
        <div key={i} className="p-4 rounded-xl border border-glass-border bg-white/[0.02] space-y-3">
          {/* NIC header row */}
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-glass-border overflow-hidden">
              {(['ETH', 'WIFI'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={readOnly}
                  onClick={() => update(i, { nic_type: t, ssid: '', switch_port: '', band: '' })}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                    nic.nic_type === t
                      ? 'bg-indigo-600/30 text-indigo-300'
                      : 'text-white/40 hover:text-white hover:bg-white/5'
                  )}
                >
                  {t === 'ETH' ? <Cable size={12} /> : <Wifi size={12} />}
                  {t}
                </button>
              ))}
            </div>

            {!readOnly && (
              <button
                type="button"
                onClick={() => update(i, { is_active: !nic.is_active })}
                className={clsx(
                  'px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors flex-shrink-0 w-24',
                  nic.is_active
                    ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.15]'
                    : 'text-red-400 border-red-500/25 bg-red-500/[0.08] hover:bg-red-500/[0.15]'
                )}
              >
                {nic.is_active ? 'Activated' : 'Deactivated'}
              </button>
            )}

            <input
              type="text"
              value={nic.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Interface label (e.g. eth0)"
              disabled={readOnly}
              className="glass-input text-sm flex-1 min-w-0"
            />

            {!readOnly && (
              <button type="button" onClick={() => remove(i)} aria-label="Remove NIC"
                className="btn-danger p-1.5 flex-shrink-0"><X size={14} /></button>
            )}
          </div>

          {/* Common NIC fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-white/40 mb-1">MAC Address</label>
              <input value={nic.mac} onChange={(e) => update(i, { mac: e.target.value })}
                disabled={readOnly} placeholder="aa:bb:cc:dd:ee:ff"
                className="glass-input w-full text-sm font-mono" />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Network / VLAN</label>
              <select value={nic.network_id} onChange={(e) => update(i, { network_id: e.target.value })}
                disabled={readOnly} title="Network / VLAN" className="glass-input w-full text-sm">
                <option value="" className="bg-surface-overlay">None</option>
                {networks.map((n) => (
                  <option key={n.id} value={n.id} className="bg-surface-overlay">
                    {n.vlan_id ? `VLAN ${n.vlan_id} — ` : ''}{n.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">IP Address</label>
              <input value={nic.ip_address} onChange={(e) => update(i, { ip_address: e.target.value })}
                disabled={readOnly} placeholder="10.10.20.x or DHCP"
                className="glass-input w-full text-sm font-mono" />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Address Type</label>
              <select value={nic.address_type} onChange={(e) => update(i, { address_type: e.target.value as any })}
                disabled={readOnly} title="Address Type" className="glass-input w-full text-sm">
                <option value="reserved" className="bg-surface-overlay">Reserved (DHCP)</option>
                <option value="static" className="bg-surface-overlay">Static</option>
                <option value="dhcp" className="bg-surface-overlay">DHCP (dynamic)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] text-white/40 mb-1">DNS Name</label>
              <input value={nic.dns_entry} onChange={(e) => update(i, { dns_entry: e.target.value })}
                disabled={readOnly} placeholder="hostname.local"
                className="glass-input w-full text-sm font-mono" />
            </div>
          </div>

          {/* DNS servers + static gateway */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-glass-border">
            <div>
              <label className="block text-[10px] text-white/40 mb-1">DNS Server 1</label>
              <input value={nic.dns_server_1} onChange={(e) => update(i, { dns_server_1: e.target.value })}
                disabled={readOnly} placeholder="1.1.1.1"
                className="glass-input w-full text-sm font-mono" />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">DNS Server 2</label>
              <input value={nic.dns_server_2} onChange={(e) => update(i, { dns_server_2: e.target.value })}
                disabled={readOnly} placeholder="8.8.8.8"
                className="glass-input w-full text-sm font-mono" />
            </div>
            <div className="col-span-2">
              <p className="text-[10px] text-white/25 italic">Leave blank to inherit DNS servers from the network configuration.</p>
            </div>
            {nic.address_type === 'static' && (<>
              <div>
                <label className="block text-[10px] text-white/40 mb-1">Gateway</label>
                <input value={nic.gateway} onChange={(e) => update(i, { gateway: e.target.value })}
                  disabled={readOnly} placeholder="10.0.0.1"
                  className="glass-input w-full text-sm font-mono" />
              </div>
              <div>
                <label className="block text-[10px] text-white/40 mb-1">Subnet Mask</label>
                <input value={nic.subnet_mask} onChange={(e) => update(i, { subnet_mask: e.target.value })}
                  disabled={readOnly} placeholder="255.255.255.0 or /24"
                  className="glass-input w-full text-sm font-mono" />
              </div>
            </>)}
          </div>

          {/* ETH-only fields */}
          {nic.nic_type === 'ETH' && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-glass-border">
              <div>
                <label className="block text-[10px] text-white/40 mb-1">Switch</label>
                <select
                  value={nic.switch_device_id}
                  onChange={(e) => update(i, { switch_device_id: e.target.value, switch_port_id: '' })}
                  disabled={readOnly}
                  title="Switch device"
                  className="glass-input w-full text-sm"
                >
                  <option value="" className="bg-surface-overlay">None</option>
                  {switchDevices.map((sw) => (
                    <option key={sw.id} value={sw.id} className="bg-surface-overlay">{sw.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-white/40 mb-1">Port</label>
                <select
                  value={nic.switch_port_id}
                  onChange={(e) => update(i, { switch_port_id: e.target.value })}
                  disabled={readOnly || !nic.switch_device_id}
                  title="Switch port"
                  className="glass-input w-full text-sm"
                >
                  <option value="" className="bg-surface-overlay">— select port —</option>
                  {(() => {
                    // Ports claimed by other NICs in this form (not yet saved)
                    const claimedByForm = new Set(
                      nics.filter((_, idx) => idx !== i).map((n) => n.switch_port_id).filter(Boolean)
                    )
                    return (switchDevices.find((sw) => String(sw.id) === String(nic.switch_device_id))?.switch_ports ?? [])
                      .sort((a, b) => a.port_number - b.port_number)
                      .map((p) => {
                        const isThisNic = String(p.id) === String(nic.switch_port_id)
                        const inUseByDB = p.connected_device_id != null && !isThisNic
                        const inUseByForm = claimedByForm.has(String(p.id))
                        const inUse = inUseByDB || inUseByForm
                        const usedBy = inUseByDB
                          ? `In use: ${p.connected_device_name}${p.connected_nic_label ? ` / ${p.connected_nic_label}` : ''}`
                          : inUseByForm ? 'In use: assigned to another NIC on this device' : ''
                        return (
                          <option
                            key={p.id}
                            value={p.id}
                            disabled={inUse}
                            title={inUse ? usedBy : undefined}
                            className="bg-surface-overlay"
                          >
                            {p.label}{inUse ? ` — ${usedBy}` : ''}
                          </option>
                        )
                      })
                  })()}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input type="checkbox" id={`poe-${i}`} checked={nic.poe_enabled}
                  onChange={(e) => update(i, { poe_enabled: e.target.checked })}
                  disabled={readOnly} className="rounded" />
                <label htmlFor={`poe-${i}`} className="text-sm text-white/60">PoE Enabled</label>
              </div>
            </div>
          )}

          {/* WiFi-only fields */}
          {nic.nic_type === 'WIFI' && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-glass-border">
              <div>
                <label className="block text-[10px] text-white/40 mb-1">SSID</label>
                <input value={nic.ssid} onChange={(e) => update(i, { ssid: e.target.value })}
                  disabled={readOnly} placeholder="HomeNet-20"
                  className="glass-input w-full text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-white/40 mb-1">Band</label>
                <select value={nic.band} onChange={(e) => update(i, { band: e.target.value })}
                  disabled={readOnly} title="Band" className="glass-input w-full text-sm">
                  <option value="" className="bg-surface-overlay">Unknown</option>
                  <option value="2.4GHz" className="bg-surface-overlay">2.4 GHz</option>
                  <option value="5GHz" className="bg-surface-overlay">5 GHz</option>
                  <option value="6GHz" className="bg-surface-overlay">6 GHz</option>
                </select>
              </div>
            </div>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="flex gap-2">
          <button type="button" onClick={() => add('ETH')}
            className="btn-ghost flex items-center gap-1.5 text-sm border border-glass-border">
            <Plus size={13} /><Cable size={13} /> Add Ethernet NIC
          </button>
          <button type="button" onClick={() => add('WIFI')}
            className="btn-ghost flex items-center gap-1.5 text-sm border border-glass-border">
            <Plus size={13} /><Wifi size={13} /> Add WiFi NIC
          </button>
        </div>
      )}
    </div>
  )
}
