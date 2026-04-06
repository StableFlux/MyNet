import { Cable, Wifi, X, Plus, AlertTriangle } from 'lucide-react'
import { NIC_TYPE_ICON } from './DeviceTypeIcon'
import clsx from 'clsx'

function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    if (!cidr.includes('/')) return false
    const [network, prefixStr] = cidr.split('/')
    const prefix = parseInt(prefixStr, 10)
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false
    const ipParts = ip.split('.').map(Number)
    const netParts = network.split('.').map(Number)
    if (ipParts.length !== 4 || netParts.length !== 4) return false
    if (ipParts.some(n => isNaN(n) || n < 0 || n > 255)) return false
    if (netParts.some(n => isNaN(n) || n < 0 || n > 255)) return false
    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]
    const netNum = (netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3]
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
    return (ipNum >>> 0 & mask) === (netNum >>> 0 & mask)
  } catch {
    return false
  }
}

export interface NicDraft {
  id?: number
  label: string
  nic_type: 'ETH' | 'WIFI' | 'VIRT' | 'SFP' | 'QSFP'
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
  connection_type: string
  nic_speed: string
  transceiver_type: string
  transceiver_speed: string
  notes: string
  is_active: boolean
}

export const emptyNic = (): NicDraft => ({
  label: '', nic_type: 'ETH', mac: '', ip_address: '', dns_entry: '',
  network_id: '', address_type: 'reserved', gateway: '',
  subnet_mask: '', dns_server_1: '', dns_server_2: '',
  switch_port: '', switch_port_id: '', switch_device_id: '',
  poe_enabled: false, ssid: '', band: '',
  connection_type: 'built-in', nic_speed: '', transceiver_type: '', transceiver_speed: '',
  notes: '', is_active: true,
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

interface NetworkSsid {
  ssid: string
  bands: string[]
}

interface Props {
  nics: NicDraft[]
  onChange: (nics: NicDraft[]) => void
  networks: { id: number; name: string; vlan_id: number | null; color: string; cidr: string | null; ssids: NetworkSsid[] | null }[]
  switchDevices?: SwitchDevice[]
  readOnly?: boolean
  dnsDomain?: string
}

const ALL_BANDS = ['2.4GHz', '5GHz', '6GHz']

const ETH_SPEEDS = [
  { value: '10M',    label: '10 Mbps' },
  { value: '100M',   label: '100 Mbps (Fast Ethernet)' },
  { value: '1GbE',   label: '1 GbE' },
  { value: '2.5GbE', label: '2.5 GbE' },
  { value: '5GbE',   label: '5 GbE' },
  { value: '10GbE',  label: '10 GbE' },
  { value: '25GbE',  label: '25 GbE' },
  { value: '40GbE',  label: '40 GbE' },
  { value: '100GbE', label: '100 GbE' },
]

const WIFI_SPEEDS = [
  { value: '802.11b',  label: '802.11b — 11 Mbps' },
  { value: '802.11a',  label: '802.11a — 54 Mbps' },
  { value: '802.11g',  label: '802.11g — 54 Mbps' },
  { value: 'WiFi4',    label: 'Wi-Fi 4 / 802.11n — 600 Mbps' },
  { value: 'WiFi5',    label: 'Wi-Fi 5 / 802.11ac — 3.5 Gbps' },
  { value: 'WiFi6',    label: 'Wi-Fi 6 / 802.11ax — 9.6 Gbps' },
  { value: 'WiFi6E',   label: 'Wi-Fi 6E / 802.11ax — 9.6 Gbps (6 GHz)' },
  { value: 'WiFi7',    label: 'Wi-Fi 7 / 802.11be — 46 Gbps' },
]

const TRANSCEIVER_TYPES = [
  { value: 'fiber-sm', label: 'Fiber — Single-mode' },
  { value: 'fiber-mm', label: 'Fiber — Multi-mode' },
  { value: 'dac',      label: 'DAC (Direct Attach Copper)' },
  { value: 'aoc',      label: 'AOC (Active Optical Cable)' },
  { value: 'copper',   label: 'Copper / RJ45' },
]

const TRANSCEIVER_SPEEDS: Record<string, Record<string, string[]>> = {
  'fiber-sm': { SFP: ['1G', '10G', '25G'],          QSFP: ['40G', '100G', '400G'] },
  'fiber-mm': { SFP: ['1G', '10G', '25G'],          QSFP: ['40G', '100G'] },
  'dac':      { SFP: ['1G', '10G', '25G'],          QSFP: ['40G', '100G', '200G', '400G'] },
  'aoc':      { SFP: ['10G', '25G'],                QSFP: ['40G', '100G', '200G', '400G'] },
  'copper':   { SFP: ['100M', '1G', '10G'],         QSFP: [] },
}

function getTransceiverSpeeds(nicType: string, transceiverType: string): string[] {
  if (!transceiverType) return []
  return TRANSCEIVER_SPEEDS[transceiverType]?.[nicType] ?? []
}

function getSubnetWarning(nic: NicDraft, networks: Props['networks']): string | null {
  const ip = nic.ip_address.trim()
  if (!ip || ip.toUpperCase() === 'DHCP' || nic.address_type === 'dhcp') return null
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null

  const selectedNet = nic.network_id ? networks.find(n => String(n.id) === nic.network_id) : null

  if (selectedNet) {
    if (!selectedNet.cidr) return null
    if (isIpInCidr(ip, selectedNet.cidr)) return null
    return `${ip} is outside ${selectedNet.name}'s subnet (${selectedNet.cidr})`
  }

  // No network selected — check against all known subnets
  const cidrs = networks.map(n => n.cidr).filter(Boolean) as string[]
  if (cidrs.length === 0) return null
  if (cidrs.some(c => isIpInCidr(ip, c))) return null
  return `${ip} does not fall within any defined network subnet`
}

export function NicForm({ nics, onChange, networks, switchDevices = [], readOnly = false, dnsDomain = '' }: Props) {
  const update = (i: number, patch: Partial<NicDraft>) => {
    const next = nics.map((n, idx) => idx === i ? { ...n, ...patch } : n)
    onChange(next)
  }

  const remove = (i: number) => onChange(nics.filter((_, idx) => idx !== i))

  const add = (type: 'ETH' | 'WIFI' | 'SFP' | 'QSFP') => onChange([...nics, { ...emptyNic(), nic_type: type }])

  function handleNetworkChange(i: number, networkId: string) {
    const net = networks.find(n => String(n.id) === networkId)
    const ssids = net?.ssids ?? []
    const patch: Partial<NicDraft> = { network_id: networkId, ssid: '', band: '' }
    if (ssids.length === 1) {
      patch.ssid = ssids[0].ssid
      if (ssids[0].bands.length === 1) patch.band = ssids[0].bands[0]
    }
    update(i, patch)
  }

  function handleSsidChange(i: number, ssidName: string) {
    const net = networks.find(n => String(n.id) === nics[i].network_id)
    const ssidEntry = net?.ssids?.find(s => s.ssid === ssidName)
    const patch: Partial<NicDraft> = { ssid: ssidName, band: '' }
    if (ssidEntry && ssidEntry.bands.length === 1) patch.band = ssidEntry.bands[0]
    update(i, patch)
  }

  return (
    <div className="space-y-3">
      {nics.map((nic, i) => {
        const selectedNet = nic.network_id ? networks.find(n => String(n.id) === nic.network_id) : null
        const networkSsids = selectedNet?.ssids ?? []
        const selectedSsidEntry = networkSsids.find(s => s.ssid === nic.ssid)
        const availableBands = selectedSsidEntry?.bands?.length ? selectedSsidEntry.bands : ALL_BANDS
        const subnetWarning = getSubnetWarning(nic, networks)

        return (
          <div key={i} className="p-4 rounded-xl border border-glass-border bg-white/[0.02] space-y-3">
            {/* NIC header row */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-glass-border text-xs font-medium text-indigo-300 bg-indigo-600/20">
                {(() => { const I = NIC_TYPE_ICON[nic.nic_type?.toUpperCase()] ?? NIC_TYPE_ICON.ETH; return <I size={12} /> })()}
                {nic.nic_type === 'SFP' ? 'SFP Slot' : nic.nic_type === 'QSFP' ? 'QSFP Slot' : nic.nic_type}
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
                <select value={nic.network_id}
                  onChange={(e) => handleNetworkChange(i, e.target.value)}
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
                  disabled={readOnly} placeholder="192.168.1.x or DHCP"
                  className={clsx('glass-input w-full text-sm font-mono', subnetWarning && 'border-amber-500/50')} />
                {!readOnly && subnetWarning && (
                  <p className="flex items-center gap-1 mt-1 text-[10px] text-amber-400">
                    <AlertTriangle size={10} className="flex-shrink-0" />
                    {subnetWarning}
                  </p>
                )}
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
                <div className="flex gap-1.5">
                  <input value={nic.dns_entry} onChange={(e) => update(i, { dns_entry: e.target.value })}
                    disabled={readOnly} placeholder={dnsDomain ? `hostname${dnsDomain}` : 'hostname.local'}
                    className="glass-input flex-1 text-sm font-mono min-w-0" />
                  {dnsDomain && !readOnly && nic.dns_entry && !nic.dns_entry.endsWith(dnsDomain) && (
                    <button
                      type="button"
                      onClick={() => update(i, { dns_entry: nic.dns_entry + dnsDomain })}
                      title={`Append ${dnsDomain}`}
                      className="flex-shrink-0 px-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-mono hover:bg-indigo-500/20 transition-colors"
                    >
                      +{dnsDomain}
                    </button>
                  )}
                </div>
              </div>
              {(nic.nic_type === 'ETH' || nic.nic_type === 'WIFI') && <>
                <div>
                  <label className="block text-[10px] text-white/40 mb-1">Connection</label>
                  <select value={nic.connection_type} onChange={(e) => update(i, { connection_type: e.target.value })}
                    disabled={readOnly} title="Connection type" className="glass-input w-full text-sm">
                    <option value="built-in" className="bg-surface-overlay">Built-in</option>
                    <option value="usb" className="bg-surface-overlay">USB</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-white/40 mb-1">NIC Speed</label>
                  <select value={nic.nic_speed} onChange={(e) => update(i, { nic_speed: e.target.value })}
                    disabled={readOnly} title="NIC speed" className="glass-input w-full text-sm">
                    <option value="" className="bg-surface-overlay">— select speed —</option>
                    {(nic.nic_type === 'WIFI' ? WIFI_SPEEDS : ETH_SPEEDS).map(s => (
                      <option key={s.value} value={s.value} className="bg-surface-overlay">{s.label}</option>
                    ))}
                  </select>
                </div>
              </>}
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

            {/* SFP / QSFP-only fields */}
            {(nic.nic_type === 'SFP' || nic.nic_type === 'QSFP') && (() => {
              const speeds = getTransceiverSpeeds(nic.nic_type, nic.transceiver_type)
              const noSpeeds = nic.transceiver_type && speeds.length === 0
              return (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-glass-border">
                  <div>
                    <label className="block text-[10px] text-white/40 mb-1">Transceiver Type</label>
                    <select value={nic.transceiver_type}
                      onChange={(e) => update(i, { transceiver_type: e.target.value, transceiver_speed: '' })}
                      disabled={readOnly} title="Transceiver type" className="glass-input w-full text-sm">
                      <option value="" className="bg-surface-overlay">— select type —</option>
                      {TRANSCEIVER_TYPES.map(t => (
                        <option key={t.value} value={t.value} className="bg-surface-overlay">{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/40 mb-1">Speed</label>
                    {noSpeeds ? (
                      <p className="flex items-center gap-1 mt-2 text-[10px] text-amber-400">
                        <AlertTriangle size={10} className="flex-shrink-0" />
                        Not applicable for this transceiver type
                      </p>
                    ) : (
                      <select value={nic.transceiver_speed}
                        onChange={(e) => update(i, { transceiver_speed: e.target.value })}
                        disabled={readOnly || speeds.length === 0} title="Transceiver speed"
                        className="glass-input w-full text-sm">
                        <option value="" className="bg-surface-overlay">— select speed —</option>
                        {speeds.map(s => (
                          <option key={s} value={s} className="bg-surface-overlay">{s}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* WiFi-only fields */}
            {nic.nic_type === 'WIFI' && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-glass-border">
                <div>
                  <label className="block text-[10px] text-white/40 mb-1">
                    SSID{networkSsids.length > 0 && <span className="text-white/20 ml-1">— from selected network</span>}
                  </label>
                  {networkSsids.length > 0 ? (
                    <select value={nic.ssid} onChange={(e) => handleSsidChange(i, e.target.value)}
                      disabled={readOnly} title="SSID" className="glass-input w-full text-sm">
                      <option value="" className="bg-surface-overlay">— select SSID —</option>
                      {networkSsids.map((s) => (
                        <option key={s.ssid} value={s.ssid} className="bg-surface-overlay">{s.ssid}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={nic.ssid} onChange={(e) => update(i, { ssid: e.target.value })}
                      disabled={readOnly} placeholder="HomeNet-20"
                      className="glass-input w-full text-sm" />
                  )}
                </div>
                <div>
                  <label className="block text-[10px] text-white/40 mb-1">Band</label>
                  <select value={nic.band}
                    onChange={(e) => update(i, { band: e.target.value })}
                    disabled={readOnly || availableBands.length === 1}
                    title="Band"
                    className="glass-input w-full text-sm">
                    {availableBands.length > 1 && (
                      <option value="" className="bg-surface-overlay">Unknown</option>
                    )}
                    {availableBands.map((b) => (
                      <option key={b} value={b} className="bg-surface-overlay">
                        {b.replace('GHz', ' GHz')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => add('ETH')}
            className="btn-ghost flex items-center gap-1.5 text-sm border border-glass-border">
            <Plus size={13} /><Cable size={13} /> Add Ethernet NIC
          </button>
          <button type="button" onClick={() => add('WIFI')}
            className="btn-ghost flex items-center gap-1.5 text-sm border border-glass-border">
            <Plus size={13} /><Wifi size={13} /> Add WiFi NIC
          </button>
          <button type="button" onClick={() => add('SFP')}
            className="btn-ghost flex items-center gap-1.5 text-sm border border-glass-border">
            <Plus size={13} /><Cable size={13} /> Add SFP Slot
          </button>
          <button type="button" onClick={() => add('QSFP')}
            className="btn-ghost flex items-center gap-1.5 text-sm border border-glass-border">
            <Plus size={13} /><Cable size={13} /> Add QSFP Slot
          </button>
        </div>
      )}
    </div>
  )
}
