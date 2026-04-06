import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Save, Loader, ChevronDown, Globe, ChevronUp } from 'lucide-react'
import { GlassCard } from '../../components/GlassCard'
import { DEVICE_CATEGORIES, useColorSettings } from '../../hooks/useColorSettings'
import { NicForm, NicDraft, emptyNic, isValidIp, isRfc1918, isIpInCidr } from '../../components/NicForm'
import { SwitchPortsForm } from '../../components/SwitchPortsForm'
import { ConflictModal, Conflict } from '../../components/ConflictModal'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'

// ---------------------------------------------------------------------------
// Form state shape
// ---------------------------------------------------------------------------
interface FormState {
  name: string
  use: string
  device_type_id: string
  hardware_type: string
  brand: string
  model: string
  cpu: string
  ram: string
  gpu: string
  os: string
  os_version: string
  hostname: string
  username: string
  password: string
  ssh_enabled: boolean
  ssh_port: string
  ssh_key: string
  status: string
  location: string
  storage_location: string
  storage_location_id: string
  purchase_date: string
  url: string
  service_name: string
  service_port: string
  hypervisor_device_id: string
  firmware_type: string
  bed_size: string
  mcu_board: string
  ha_entity_id: string
  pihole_enabled: boolean
  pihole_nic_id: string
  pihole_password: string
  wol_enabled: boolean
  monitoring_enabled: boolean
  monitor_interval_secs: string
  monitor_target_nic_id: string
  monitor_nic_ids: number[]
  notes: string
  drives: { label: string; capacity: string; type: string }[]
  services: { name: string; url: string; port: string }[]
  nics: NicDraft[]
  uplink_port_id: string
  upstream_device_id: string
  upstream_port_id: string
  port_display_rows: string
  port_numbering: string
}

const emptyForm = (): FormState => ({
  name: '', use: '', device_type_id: '', hardware_type: '', brand: '', model: '',
  cpu: '', ram: '', gpu: '', os: '', os_version: '', hostname: '',
  username: '', password: '', ssh_enabled: false, ssh_port: '22',
  ssh_key: '', status: 'in_service', location: '', storage_location: '', storage_location_id: '',
  purchase_date: '', url: '', service_name: '', service_port: '',
  hypervisor_device_id: '', firmware_type: '', bed_size: '', mcu_board: '',
  ha_entity_id: '', pihole_enabled: false, pihole_nic_id: '', pihole_password: '', wol_enabled: false, monitoring_enabled: false,
  monitor_interval_secs: '60', monitor_target_nic_id: '', monitor_nic_ids: [], notes: '', drives: [], services: [], nics: [],
  uplink_port_id: '', upstream_device_id: '', upstream_port_id: '',
  port_display_rows: '2', port_numbering: 'alternating',
})

function deviceToForm(device: any, password?: string): FormState {
  return {
    name: device.name ?? '',
    use: device.use ?? '',
    device_type_id: device.device_type_id ? String(device.device_type_id) : '',
    hardware_type: device.hardware_type ?? '',
    brand: device.brand ?? '',
    model: device.model ?? '',
    cpu: device.cpu ?? '',
    ram: device.ram ?? '',
    gpu: device.gpu ?? '',
    os: device.os ?? '',
    os_version: device.os_version ?? '',
    hostname: device.hostname ?? '',
    username: device.username ?? '',
    password: password ?? '',
    ssh_enabled: device.ssh_enabled ?? false,
    ssh_port: String(device.ssh_port ?? 22),
    ssh_key: device.ssh_key ?? '',
    status: device.status ?? 'in_service',
    location: device.location ?? '',
    storage_location: device.storage_location ?? '',
    storage_location_id: device.storage_location_id ? String(device.storage_location_id) : '',
    purchase_date: device.purchase_date ?? '',
    url: device.url ?? '',
    service_name: device.service_name ?? '',
    service_port: device.service_port ? String(device.service_port) : '',
    hypervisor_device_id: device.hypervisor_device_id ? String(device.hypervisor_device_id) : '',
    firmware_type: device.firmware_type ?? '',
    bed_size: device.bed_size ?? '',
    mcu_board: device.mcu_board ?? '',
    ha_entity_id: device.ha_entity_id ?? '',
    pihole_enabled: device.pihole_enabled ?? false,
    pihole_nic_id: device.pihole_nic_id ? String(device.pihole_nic_id) : '',
    pihole_password: '',   // never pre-fill — leave blank to keep existing
    wol_enabled: device.wol_enabled ?? false,
    monitoring_enabled: device.monitoring_enabled ?? false,
    monitor_interval_secs: String(device.monitor_interval_secs ?? 60),
    monitor_target_nic_id: device.monitor_target_nic_id ? String(device.monitor_target_nic_id) : '',
    monitor_nic_ids: (() => {
      const saved = device.monitor_nic_ids ?? []
      if (device.monitoring_enabled && saved.length === 0) {
        const sortedNics = [...(device.nics ?? [])].sort((a: any, b: any) =>
          (a.nic_type === 'ETH' ? 0 : 1) - (b.nic_type === 'ETH' ? 0 : 1)
        )
        const firstId = sortedNics[0]?.id
        return firstId ? [firstId] : []
      }
      return saved
    })(),
    notes: device.notes ?? '',
    drives: (device.drives ?? []).map((d: any) => ({
      label: d.label ?? '',
      capacity: d.capacity ?? '',
      type: d.type ?? '',
    })),
    services: (device.services ?? []).map((s: any) => ({
      name: s.name ?? '',
      url: s.url ?? '',
      port: s.port ?? '',
    })),
    uplink_port_id: device.uplink_port_id ? String(device.uplink_port_id) : '',
    upstream_device_id: device.upstream_device_id ? String(device.upstream_device_id) : '',
    upstream_port_id: device.upstream_port_id ? String(device.upstream_port_id) : '',
    port_display_rows: String(device.port_display_rows ?? 2),
    port_numbering: device.port_numbering ?? 'alternating',
    nics: [...(device.nics ?? [])].sort((a: any, b: any) =>
      (a.nic_type === 'ETH' ? 0 : 1) - (b.nic_type === 'ETH' ? 0 : 1)
    ).map((n: any): NicDraft => ({
      id: n.id,
      label: n.label ?? '',
      nic_type: n.nic_type ?? 'ETH',
      mac: n.mac ?? '',
      ip_address: n.ip_address ?? '',
      dns_entry: n.dns_entry ?? '',
      network_id: n.network_id ? String(n.network_id) : '',
      address_type: n.address_type ?? 'reserved',
      gateway: n.gateway ?? '',
      subnet_mask: n.subnet_mask ?? '',
      dns_server_1: n.dns_server_1 ?? '',
      dns_server_2: n.dns_server_2 ?? '',
      switch_port: n.switch_port ?? '',
      switch_port_id: n.switch_port_id ? String(n.switch_port_id) : '',
      switch_device_id: n.switch_device_id ? String(n.switch_device_id) : '',
      poe_enabled: n.poe_enabled ?? false,
      ssid: n.ssid ?? '',
      band: n.band ?? '',
      connection_type: n.connection_type ?? 'built-in',
      nic_speed: n.nic_speed ?? '',
      transceiver_type: n.transceiver_type ?? '',
      transceiver_speed: n.transceiver_speed ?? '',
      notes: n.notes ?? '',
      is_active: n.is_active ?? true,
    })),
  }
}

function formToPayload(f: FormState) {
  return {
    name: f.name,
    use: f.use || null,
    device_type_id: f.device_type_id ? Number(f.device_type_id) : null,
    hardware_type: f.hardware_type || null,
    brand: f.brand || null,
    model: f.model || null,
    cpu: f.cpu || null,
    ram: f.ram || null,
    gpu: f.gpu || null,
    os: f.os || null,
    os_version: f.os_version || null,
    hostname: f.hostname || null,
    username: f.username || null,
    password: f.password || null,
    ssh_enabled: f.ssh_enabled,
    ssh_port: f.ssh_port ? Number(f.ssh_port) : 22,
    ssh_key: f.ssh_key || null,
    status: f.status,
    location: f.location || null,
    storage_location: f.storage_location || null,
    storage_location_id: f.storage_location_id ? Number(f.storage_location_id) : null,
    purchase_date: f.purchase_date || null,
    url: f.url || null,
    service_name: f.service_name || null,
    service_port: f.service_port ? Number(f.service_port) : null,
    hypervisor_device_id: f.hypervisor_device_id ? Number(f.hypervisor_device_id) : null,
    firmware_type: f.firmware_type || null,
    bed_size: f.bed_size || null,
    mcu_board: f.mcu_board || null,
    ha_entity_id: f.ha_entity_id || null,
    pihole_enabled: f.pihole_enabled,
    pihole_nic_id: f.pihole_nic_id ? Number(f.pihole_nic_id) : null,
    pihole_password: f.pihole_password || null,
    wol_enabled: f.wol_enabled,
    monitoring_enabled: f.monitoring_enabled,
    monitor_interval_secs: Number(f.monitor_interval_secs) || 60,
    monitor_target_nic_id: f.monitor_target_nic_id ? Number(f.monitor_target_nic_id) : null,
    monitor_nic_ids: f.monitor_nic_ids.length > 0 ? f.monitor_nic_ids : null,
    notes: f.notes || null,
    drives: f.drives.filter(d => d.label || d.capacity || d.type),
    services: f.services.filter(s => s.name || s.url || s.port),
    uplink_port_id: f.uplink_port_id ? Number(f.uplink_port_id) : null,
    upstream_device_id: f.upstream_device_id ? Number(f.upstream_device_id) : null,
    upstream_port_id: f.upstream_port_id ? Number(f.upstream_port_id) : null,
    port_display_rows: Number(f.port_display_rows) || 2,
    port_numbering: f.port_numbering || 'alternating',
    nics: f.nics.map((n) => ({
      label: n.label || null,
      nic_type: n.nic_type,
      mac: n.mac || null,
      ip_address: n.ip_address || null,
      dns_entry: n.dns_entry || null,
      network_id: n.network_id ? Number(n.network_id) : null,
      address_type: n.address_type,
      gateway: n.gateway || null,
      subnet_mask: n.subnet_mask || null,
      dns_server_1: n.dns_server_1 || null,
      dns_server_2: n.dns_server_2 || null,
      switch_port: n.switch_port || null,
      switch_port_id: n.switch_port_id ? Number(n.switch_port_id) : null,
      poe_enabled: n.poe_enabled,
      ssid: n.ssid || null,
      band: n.band || null,
      connection_type: n.connection_type || null,
      nic_speed: n.nic_speed || null,
      transceiver_type: n.transceiver_type || null,
      transceiver_speed: n.transceiver_speed || null,
      notes: n.notes || null,
      is_active: n.is_active,
    })),
  }
}

// ---------------------------------------------------------------------------
// Reusable field components
// ---------------------------------------------------------------------------
function Field({ label, children, col = 1 }: { label: string; children: React.ReactNode; col?: number }) {
  return (
    <div className={col === 2 ? 'col-span-2' : ''}>
      <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder = '', mono = false, disabled = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; disabled?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`glass-input w-full text-sm ${mono ? 'font-mono' : ''}`}
    />
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-[#ffffff] shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-white/70">{label}</span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper — collapsible
// ---------------------------------------------------------------------------
function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <GlassCard padding="none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-glass-border hover:bg-white/[0.02] transition-colors"
      >
        <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">{title}</h3>
        <span className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="p-5">{children}</div>}
    </GlassCard>
  )
}

const INFRA_TYPE_NAMES = ['Network Switch', 'Router / Gateway', 'Access Point - With Switch', 'Firewall']
const WAN_TYPE_NAMES = ['Router / Gateway', 'Firewall', '4G / 5G Router']

// ---------------------------------------------------------------------------
// WAN Configuration section
// ---------------------------------------------------------------------------

const CONNECTION_TYPES = [
  { value: 'dhcp',    label: 'DHCP' },
  { value: 'static',  label: 'Static IP' },
  { value: 'pppoe',   label: 'PPPoE' },
  { value: '4g-lte',  label: '4G/LTE' },
  { value: 'ds-lite', label: 'DS-Lite' },
]

function WanPortCard({ portId, portNumber, portName, existing, onSaved, onDeleted }: {
  portId: number
  portNumber: number
  portName?: string | null
  existing: any | null
  onSaved: () => void
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(!!existing)
  const [form, setForm] = useState<any>({
    isp_name: '', connection_type: 'dhcp', vlan_id: '',
    ip_address: '', subnet_mask: '', gateway: '',
    pppoe_username: '', pppoe_password: '',
    mtu: '', dns_primary: '', dns_secondary: '', notes: '',
    speed_down: '', speed_up: '',
    ...(existing ? {
      ...existing,
      vlan_id: existing.vlan_id != null ? String(existing.vlan_id) : '',
      mtu: existing.mtu != null ? String(existing.mtu) : '',
      speed_down: existing.speed_down ?? '',
      speed_up: existing.speed_up ?? '',
    } : {}),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        vlan_id: form.vlan_id ? Number(form.vlan_id) : null,
        mtu: form.mtu ? Number(form.mtu) : null,
      }
      await api.put(`/wan-configs/port/${portId}`, payload)
    },
    onSuccess: onSaved,
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Failed to save WAN config'),
  })

  const deleteMut = useMutation({
    mutationFn: async () => { await api.delete(`/wan-configs/port/${portId}`) },
    onSuccess: onDeleted,
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Failed to delete WAN config'),
  })

  const { wanPortColor } = useColorSettings()
  const label = portName ? `Port ${portNumber} / ${portName}` : `Port ${portNumber}`
  const connType = form.connection_type

  return (
    <div className="rounded-lg border overflow-hidden"
      style={{ borderColor: wanPortColor + '4d', backgroundColor: wanPortColor + '08' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
        <Globe size={13} className="shrink-0" style={{ color: wanPortColor }} />
        <span className="text-sm text-white/80 flex-1 text-left">{label}</span>
        {existing && <span className="text-[10px]" style={{ color: wanPortColor + '99' }}>{existing.isp_name || existing.connection_type || 'Configured'}</span>}
        {open ? <ChevronUp size={14} className="text-white/30" /> : <ChevronDown size={14} className="text-white/30" />}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 border-t space-y-3" style={{ borderColor: wanPortColor + '33' }}>
          {/* Row 1: ISP Name | Connection Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-white/40 mb-1">ISP Name</label>
              <input value={form.isp_name} onChange={e => setForm((f: any) => ({ ...f, isp_name: e.target.value }))}
                placeholder="e.g. Comcast" className="glass-input w-full text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Connection Type</label>
              <select value={form.connection_type} onChange={e => setForm((f: any) => ({ ...f, connection_type: e.target.value }))}
                className="glass-input w-full text-sm" title="Connection type">
                {CONNECTION_TYPES.map(ct => (
                  <option key={ct.value} value={ct.value} className="bg-surface-overlay">{ct.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: VLAN ID | MTU */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-white/40 mb-1">VLAN ID</label>
              <input type="number" value={form.vlan_id} onChange={e => setForm((f: any) => ({ ...f, vlan_id: e.target.value }))}
                placeholder="e.g. 100" className="glass-input w-full text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">MTU</label>
              <input type="number" value={form.mtu} onChange={e => setForm((f: any) => ({ ...f, mtu: e.target.value }))}
                placeholder="1500" className="glass-input w-full text-sm" />
            </div>
          </div>

          {/* Row 3: Speed Down (1/4) | Speed Up (1/4) | WAN IP (1/2, non-DHCP only) */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Speed Down</label>
              <input value={form.speed_down} onChange={e => setForm((f: any) => ({ ...f, speed_down: e.target.value }))}
                placeholder="500 Mbps" className="glass-input w-full text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Speed Up</label>
              <input value={form.speed_up} onChange={e => setForm((f: any) => ({ ...f, speed_up: e.target.value }))}
                placeholder="50 Mbps" className="glass-input w-full text-sm" />
            </div>
            {connType !== 'dhcp' && (
              <div className="col-span-2">
                <label className="block text-[10px] text-white/40 mb-1">WAN IP Address</label>
                <input value={form.ip_address} onChange={e => setForm((f: any) => ({ ...f, ip_address: e.target.value }))}
                  placeholder="e.g. 203.0.113.1" className="glass-input w-full text-sm" />
              </div>
            )}
          </div>

          {/* Static only: Subnet Mask + Gateway */}
          {connType === 'static' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-white/40 mb-1">Subnet Mask</label>
                <input value={form.subnet_mask} onChange={e => setForm((f: any) => ({ ...f, subnet_mask: e.target.value }))}
                  placeholder="255.255.255.0" className="glass-input w-full text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-white/40 mb-1">Gateway</label>
                <input value={form.gateway} onChange={e => setForm((f: any) => ({ ...f, gateway: e.target.value }))}
                  placeholder="203.0.113.254" className="glass-input w-full text-sm" />
              </div>
            </div>
          )}

          {connType === 'pppoe' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-white/40 mb-1">PPPoE Username</label>
                <input value={form.pppoe_username} onChange={e => setForm((f: any) => ({ ...f, pppoe_username: e.target.value }))}
                  placeholder="user@isp.com" className="glass-input w-full text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-white/40 mb-1">PPPoE Password</label>
                <input type="password" value={form.pppoe_password} onChange={e => setForm((f: any) => ({ ...f, pppoe_password: e.target.value }))}
                  placeholder="••••••••" className="glass-input w-full text-sm" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Primary DNS</label>
              <input value={form.dns_primary} onChange={e => setForm((f: any) => ({ ...f, dns_primary: e.target.value }))}
                placeholder="8.8.8.8" className="glass-input w-full text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Secondary DNS</label>
              <input value={form.dns_secondary} onChange={e => setForm((f: any) => ({ ...f, dns_secondary: e.target.value }))}
                placeholder="8.8.4.4" className="glass-input w-full text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-white/40 mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this WAN connection…" className="glass-input w-full text-sm" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="btn-ghost flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300">
              <Save size={12} /> {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
            {existing && (
              <button type="button" onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
                className="btn-ghost text-xs text-red-400/60 hover:text-red-400 ml-auto">
                Remove config
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function WanConfigsSection({ deviceId, wanConfigs, onRefresh }: {
  deviceId: number
  wanConfigs: any[]
  onRefresh: () => void
}) {
  const { data: ports = [] } = useQuery<any[]>({
    queryKey: ['switch-ports', deviceId],
    queryFn: async () => { const { data } = await api.get(`/switch-ports/device/${deviceId}`); return data },
  })

  const wanPorts = ports.filter((p: any) => p.port_mode === 'wan')

  if (wanPorts.length === 0) return null

  return (
    <Section title="WAN Configuration">
      <div className="space-y-2">
        {wanPorts.map((port: any) => {
          const existing = wanConfigs.find((wc: any) => wc.switch_port_id === port.id) ?? null
          return (
            <WanPortCard
              key={port.id}
              portId={port.id}
              portNumber={port.port_number}
              portName={port.port_name}
              existing={existing}
              onSaved={onRefresh}
              onDeleted={onRefresh}
            />
          )
        })}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DeviceForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'
  const isEdit = !!id && id !== 'new'

  const [form, setForm] = useState<FormState>(() => {
    // Pre-fill from clone
    const cloneFrom = (location.state as any)?.cloneFrom
    if (cloneFrom) return { ...emptyForm(), ...cloneFrom }
    const f = emptyForm()
    // Pre-fill IP/network from URL params (coming from subnet map click)
    const ip = searchParams.get('ip')
    const net = searchParams.get('network')
    if (ip || net) {
      f.nics = [{ ...emptyNic(), ip_address: ip ?? '', network_id: net ?? '', nic_type: 'ETH' }]
    }
    return f
  })
  const [error, setError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showInfraWarning, setShowInfraWarning] = useState(false)
  const [pendingConflicts, setPendingConflicts] = useState<{ deviceId: number; conflicts: Conflict[] } | null>(null)

  // Fetch existing device for edit mode
  const { data: device, isLoading: deviceLoading } = useQuery({
    queryKey: ['device', id],
    queryFn: async () => { const { data } = await api.get(`/devices/${id}`); return data },
    enabled: isEdit,
  })

  // Fetch all device types
  const { data: deviceTypes } = useQuery({
    queryKey: ['device-types'],
    queryFn: async () => { const { data } = await api.get('/device-types'); return data },
  })

  // Fetch all networks (for NIC form dropdowns)
  const { data: networks } = useQuery({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
  })

  // Fetch locations (flat list, sorted by name)
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ['locations', 'flat'],
    queryFn: async () => { const { data } = await api.get('/locations?flat=true'); return data },
  })

  // Fetch all devices (for hypervisor selector + NIC conflict detection)
  const { data: allDevices } = useQuery({
    queryKey: ['devices', 'all'],
    queryFn: async () => { const { data } = await api.get('/devices'); return data },
  })

  const currentDeviceId = id ? Number(id) : null
  const occupiedIps: { ip: string; deviceName: string }[] = React.useMemo(() => {
    if (!allDevices) return []
    return (allDevices as any[])
      .filter((d: any) => d.id !== currentDeviceId)
      .flatMap((d: any) => (d.nics ?? [])
        .filter((n: any) => n.ip_address && n.ip_address !== 'DHCP')
        .map((n: any) => ({ ip: n.ip_address, deviceName: d.name }))
      )
  }, [allDevices, currentDeviceId])

  const occupiedMacs: { mac: string; deviceName: string }[] = React.useMemo(() => {
    if (!allDevices) return []
    return (allDevices as any[])
      .filter((d: any) => d.id !== currentDeviceId)
      .flatMap((d: any) => (d.nics ?? [])
        .filter((n: any) => n.mac && n.nic_type !== 'VIRT')
        .map((n: any) => ({ mac: n.mac.trim().toLowerCase(), deviceName: d.name }))
      )
  }, [allDevices, currentDeviceId])

  // Fetch switch devices with their ports (for NIC dropdowns + uplink configuration)
  const { data: switchDevices } = useQuery({
    queryKey: ['switch-devices'],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const [{ data: dtData }, { data: devData }] = await Promise.all([
        api.get('/device-types'),
        api.get('/devices'),
      ])
      const infraIds = new Set(
        (dtData as any[]).filter((dt: any) => INFRA_TYPE_NAMES.includes(dt.name)).map((dt: any) => dt.id)
      )
      const infra = (devData as any[]).filter((d: any) => infraIds.has(d.device_type_id))
      const withPorts = await Promise.all(infra.map(async (d: any) => {
        const { data: ports } = await api.get(`/switch-ports/device/${d.id}`)
        return { id: d.id, name: d.name, switch_ports: ports }
      }))
      return withPorts
    },
  })

  const selectedDt = (deviceTypes ?? []).find((dt: any) => String(dt.id) === form.device_type_id) as any
  const isInfraDevice = INFRA_TYPE_NAMES.includes(selectedDt?.name ?? '')
  const isWanCapable = WAN_TYPE_NAMES.includes(selectedDt?.name ?? '')

  // Track whether the original loaded device was an infra type
  const originalDt = (deviceTypes ?? []).find((dt: any) => device && String(dt.id) === String(device.device_type_id)) as any
  const wasInfraDevice = INFRA_TYPE_NAMES.includes(originalDt?.name ?? '')

  // This switch's own ports — for uplink port dropdown (shares cache with SwitchPortsForm)
  const { data: ownPorts = [] } = useQuery<any[]>({
    queryKey: ['switch-ports', Number(id)],
    queryFn: async () => { const { data } = await api.get(`/switch-ports/device/${id}`); return data },
    enabled: isEdit && (isInfraDevice || wasInfraDevice),
  })

  // Upstream switch ports — keyed on selected upstream device so it always fetches fresh
  const upstreamDeviceId = form.upstream_device_id ? Number(form.upstream_device_id) : null
  const { data: upstreamPorts = [] } = useQuery<any[]>({
    queryKey: ['switch-ports', upstreamDeviceId],
    queryFn: async () => { const { data } = await api.get(`/switch-ports/device/${upstreamDeviceId}`); return data },
    enabled: !!upstreamDeviceId,
  })

  // WAN configs for WAN-capable infra devices
  const { data: wanConfigs = [], refetch: refetchWanConfigs } = useQuery<any[]>({
    queryKey: ['wan-configs', Number(id)],
    queryFn: async () => { const { data } = await api.get(`/wan-configs/device/${id}`); return data },
    enabled: isEdit && isWanCapable,
  })

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })
  const dnsDomain: string = sysSettings?.dns_domain ?? ''

  // OOB switch ports — keyed on selected OOB device
  const oobDeviceId = form.nics[0]?.switch_device_id ? Number(form.nics[0].switch_device_id) : null
  const { data: oobPorts = [] } = useQuery<any[]>({
    queryKey: ['switch-ports', oobDeviceId],
    queryFn: async () => { const { data } = await api.get(`/switch-ports/device/${oobDeviceId}`); return data },
    enabled: !!oobDeviceId,
  })

  // When device data loads (edit mode), populate form
  useEffect(() => {
    if (device) setForm(deviceToForm(device))
  }, [device])

  // When deviceTypes load and we already have a device_type_id (edit mode), set the category
  useEffect(() => {
    if (deviceTypes && form.device_type_id) {
      const dt = (deviceTypes as any[]).find((d: any) => String(d.id) === form.device_type_id)
      if (dt?.category) setSelectedCategory(dt.category)
    }
  }, [deviceTypes, form.device_type_id])

  // Hierarchical location picker
  const [locDropOpen, setLocDropOpen] = useState(false)
  const locDropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!locDropOpen) return
    const handle = (e: MouseEvent) => {
      if (locDropRef.current && !locDropRef.current.contains(e.target as Node))
        setLocDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [locDropOpen])

  const locTree = React.useMemo(() => {
    const byId: Record<number, any> = {}
    for (const l of locations) byId[l.id] = { ...l, children: [] }
    const roots: any[] = []
    for (const node of Object.values(byId)) {
      node.parent_id && byId[node.parent_id]
        ? byId[node.parent_id].children.push(node)
        : roots.push(node)
    }
    const sort = (nodes: any[]) => { nodes.sort((a: any, b: any) => a.name.localeCompare(b.name)); nodes.forEach((n: any) => sort(n.children)) }
    sort(roots)
    return roots.filter((n: any) => n.name.toLowerCase() !== 'storage')
  }, [locations])

  const flatLocTree = React.useMemo(() => {
    const flatten = (nodes: any[], depth = 0): { id: number; name: string; depth: number }[] =>
      nodes.flatMap((n: any) => [{ id: n.id, name: n.name, depth }, ...flatten(n.children, depth + 1)])
    return flatten(locTree)
  }, [locTree])

  const locationDisplayPath = React.useMemo(() => {
    if (!form.location) return ''
    const byId = Object.fromEntries(locations.map((l: any) => [l.id, l]))
    const node = locations.find((l: any) => l.name === form.location)
    if (!node) return form.location
    const parts: string[] = []
    let cur = node
    while (cur) { parts.unshift(cur.name); cur = cur.parent_id ? byId[cur.parent_id] : null }
    return parts.join(' › ')
  }, [form.location, locations])

  // Storage location picker
  const [storDropOpen, setStorDropOpen] = useState(false)
  const storDropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!storDropOpen) return
    const handle = (e: MouseEvent) => {
      if (storDropRef.current && !storDropRef.current.contains(e.target as Node))
        setStorDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [storDropOpen])

  const flatStorTree = React.useMemo(() => {
    const byId: Record<number, any> = {}
    for (const l of locations) byId[l.id] = { ...l, children: [] }
    const roots: any[] = []
    for (const l of locations) {
      if (l.parent_id && byId[l.parent_id]) byId[l.parent_id].children.push(byId[l.id])
      else if (!l.parent_id) roots.push(byId[l.id])
    }
    // Only show locations under 'storage' root
    const storageRoot = roots.find((r: any) => r.name?.toLowerCase() === 'storage')
    if (!storageRoot) return []
    const flatten = (nodes: any[], depth = 0): { id: number; name: string; depth: number }[] =>
      nodes.flatMap((n: any) => [{ id: n.id, name: n.name, depth }, ...flatten(n.children, depth + 1)])
    return flatten(storageRoot.children)
  }, [locations])

  const storageDisplayPath = React.useMemo(() => {
    if (!form.storage_location_id) return ''
    const byId = Object.fromEntries(locations.map((l: any) => [l.id, l]))
    const node = byId[Number(form.storage_location_id)]
    if (!node) return ''
    const parts: string[] = []
    let cur = node
    while (cur) { parts.unshift(cur.name); cur = cur.parent_id ? byId[cur.parent_id] : null }
    return parts.join(' › ')
  }, [form.storage_location_id, locations])

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? api.put(`/devices/${id}`, payload) : api.post('/devices', payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['device', id] })
      qc.invalidateQueries({ queryKey: ['search'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['switches'] })
      qc.invalidateQueries({ queryKey: ['wan-configs-all'] })
      qc.invalidateQueries({ queryKey: ['subnet-map'] })
      const conflicts: Conflict[] = res.data.conflicts ?? []
      if (conflicts.length > 0) {
        setPendingConflicts({ deviceId: res.data.id, conflicts })
      } else {
        navigate(`/devices/${res.data.id}`, { replace: isEdit })
      }
    },
    onError: (err: any) => setError(err.response?.data?.detail ?? 'Save failed'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Device name is required'); return }
    setError('')
    if (isEdit && wasInfraDevice && !isInfraDevice && ownPorts.length > 0) {
      setShowInfraWarning(true)
      return
    }
    saveMutation.mutate(formToPayload(form))
  }

  if (!canEdit) {
    navigate(isEdit ? `/devices/${id}` : '/devices', { replace: true })
    return null
  }

  if (isEdit && deviceLoading) {
    return <div className="glass-card h-48 animate-pulse rounded-xl" />
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => isEdit ? navigate(-1) : navigate('/devices')}
            className="btn-ghost p-2" aria-label="Back"><ChevronLeft size={18} /></button>
          <h1 className="text-xl font-bold text-white">{isEdit ? 'Edit Device' : 'Add Device'}</h1>
        </div>
        <button type="submit" disabled={saveMutation.isPending}
          className="btn-primary flex items-center gap-2">
          {saveMutation.isPending ? <Loader size={15} className="animate-spin" /> : <Save size={15} />}
          {saveMutation.isPending ? 'Saving…' : 'Save Device'}
        </button>
      </div>

      {showInfraWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="glass-card p-6 max-w-md w-full space-y-4 border border-amber-500/30">
            <h2 className="text-base font-semibold text-white">Delete switch port data?</h2>
            <p className="text-sm text-white/60">
              This device has <span className="text-amber-400 font-medium">{ownPorts.length} port{ownPorts.length !== 1 ? 's' : ''}</span> configured.
              Changing to a non-switch type will permanently delete all port labels, connections, and uplink data — including references on other devices.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" className="btn-ghost"
                onClick={() => setShowInfraWarning(false)}>Cancel</button>
              <button type="button" className="btn-primary bg-amber-600 hover:bg-amber-500"
                onClick={() => { setShowInfraWarning(false); saveMutation.mutate(formToPayload(form)) }}>
                Delete &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="glass-card p-3 border border-red-500/30 bg-red-500/10">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* ── Three columns: NICs | Identity+Hardware+Software | Sidebar ── */}
      <div className="grid grid-cols-[1fr_1fr_18rem] gap-4 items-start">

        {/* Col 2 — Identity, Hardware, Software, VM */}
        <div className="space-y-4 col-start-2 row-start-1">
        <Section title="Identity">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Device Name *" col={2}>
              <TextInput value={form.name} onChange={(v) => set({ name: v })} placeholder="My Desktop" />
            </Field>
            <Field label="Description / Use">
              <TextInput value={form.use} onChange={(v) => set({ use: v })} placeholder="Main Workstation" />
            </Field>
            <Field label="Status">
              <select aria-label="Status" value={form.status} onChange={(e) => set({ status: e.target.value })}
                className="glass-input w-full text-sm">
                <option value="in_service" className="bg-surface-overlay">In Service</option>
                <option value="undeployed" className="bg-surface-overlay">Undeployed</option>
                <option value="stock" className="bg-surface-overlay">Stock</option>
                <option value="decommissioned" className="bg-surface-overlay">Decommissioned</option>
              </select>
            </Field>
            <Field label="Category">
              <select
                aria-label="Category"
                value={selectedCategory}
                onChange={(e) => { setSelectedCategory(e.target.value); set({ device_type_id: '' }) }}
                className="glass-input w-full text-sm"
              >
                <option value="" className="bg-surface-overlay">Select category…</option>
                {DEVICE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat} className="bg-surface-overlay">{cat}</option>
                ))}
              </select>
            </Field>
            <Field label="Sub-type">
              <select
                aria-label="Sub-type"
                value={form.device_type_id}
                onChange={(e) => set({ device_type_id: e.target.value })}
                className="glass-input w-full text-sm"
                disabled={!selectedCategory}
              >
                <option value="" className="bg-surface-overlay">Select sub-type…</option>
                {(deviceTypes ?? [])
                  .filter((dt: any) => (dt.category ?? 'Other') === selectedCategory)
                  .map((dt: any) => (
                    <option key={dt.id} value={dt.id} className="bg-surface-overlay">{dt.name}</option>
                  ))}
              </select>
            </Field>
            <Field label="Location" col={2}>
              <div ref={locDropRef} className="relative">
                <button type="button" onClick={() => setLocDropOpen(o => !o)}
                  className="glass-input w-full text-sm flex items-center justify-between gap-2 text-left cursor-pointer">
                  <span className="truncate text-white">{locationDisplayPath || '— None —'}</span>
                  <ChevronDown size={13} className={`flex-shrink-0 text-white/30 transition-transform ${locDropOpen ? 'rotate-180' : ''}`} />
                </button>
                {locDropOpen && (
                  <div className="absolute z-30 top-full mt-1 left-0 w-full glass-card rounded-lg border border-white/[0.08] shadow-xl overflow-y-auto max-h-64 py-1">
                    <button type="button"
                      onClick={() => { set({ location: '' }); setLocDropOpen(false) }}
                      className={`w-full text-left text-sm px-3 py-1.5 transition-colors ${!form.location ? 'text-white bg-white/[0.06]' : 'text-white/55 hover:text-white/80 hover:bg-white/[0.04]'}`}>
                      — None —
                    </button>
                    {flatLocTree.map(({ id, name, depth }) => (
                      <button key={id} type="button"
                        onClick={() => { set({ location: name }); setLocDropOpen(false) }}
                        className={`w-full text-left text-sm py-1.5 pr-3 transition-colors ${form.location === name ? 'text-white bg-white/[0.06]' : 'text-white/55 hover:text-white/80 hover:bg-white/[0.04]'}`}
                        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
                        {depth > 0 && <span className="text-white/20 mr-1.5">›</span>}
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Hardware">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand">
              <TextInput value={form.brand} onChange={(v) => set({ brand: v })} placeholder="Acme" />
            </Field>
            <Field label="Model">
              <TextInput value={form.model} onChange={(v) => set({ model: v })} placeholder="Model X" />
            </Field>
            <Field label="CPU">
              <TextInput value={form.cpu} onChange={(v) => set({ cpu: v })} placeholder="Intel Core i5" />
            </Field>
            <Field label="RAM">
              <TextInput value={form.ram} onChange={(v) => set({ ram: v })} placeholder="64GB" />
            </Field>
            <Field label="GPU">
              <TextInput value={form.gpu} onChange={(v) => set({ gpu: v })} placeholder="Intel UHD Graphics" />
            </Field>
            <Field label="Hardware Type">
              <select className="glass-input w-full text-sm" value={form.hardware_type}
                onChange={(e) => set({ hardware_type: e.target.value })}>
                <option value="" className="bg-surface-overlay">Select type…</option>
                <optgroup label="Compute">
                  <option value="SBC" className="bg-surface-overlay">SBC (Single Board Computer)</option>
                  <option value="Mini PC" className="bg-surface-overlay">Mini PC</option>
                  <option value="Desktop" className="bg-surface-overlay">Desktop</option>
                  <option value="Laptop" className="bg-surface-overlay">Laptop</option>
                  <option value="Server" className="bg-surface-overlay">Server</option>
                  <option value="Workstation" className="bg-surface-overlay">Workstation</option>
                  <option value="Thin Client" className="bg-surface-overlay">Thin Client</option>
                </optgroup>
                <optgroup label="Networking">
                  <option value="Network Switch" className="bg-surface-overlay">Network Switch</option>
                  <option value="Router" className="bg-surface-overlay">Router</option>
                  <option value="Wireless AP" className="bg-surface-overlay">Wireless AP</option>
                  <option value="Firewall" className="bg-surface-overlay">Firewall</option>
                  <option value="Modem" className="bg-surface-overlay">Modem</option>
                </optgroup>
                <optgroup label="Storage">
                  <option value="NAS" className="bg-surface-overlay">NAS</option>
                  <option value="DAS" className="bg-surface-overlay">DAS</option>
                </optgroup>
                <optgroup label="Mobile / Wearable">
                  <option value="Mobile" className="bg-surface-overlay">Smartphone</option>
                  <option value="Tablet" className="bg-surface-overlay">Tablet</option>
                  <option value="Wearable" className="bg-surface-overlay">Smartwatch / Wearable</option>
                </optgroup>
                <optgroup label="Smart Home">
                  <option value="Smart Speaker" className="bg-surface-overlay">Smart Speaker</option>
                  <option value="Smart Assistant" className="bg-surface-overlay">Smart Assistant / Display</option>
                  <option value="Smart Switch" className="bg-surface-overlay">Smart Switch</option>
                  <option value="Smart Plug" className="bg-surface-overlay">Smart Plug</option>
                  <option value="Sensor" className="bg-surface-overlay">Sensor</option>
                </optgroup>
                <optgroup label="IoT / Embedded">
                  <option value="Microcontroller" className="bg-surface-overlay">Microcontroller</option>
                </optgroup>
                <optgroup label="A/V">
                  <option value="Camera" className="bg-surface-overlay">Camera</option>
                  <option value="NVR" className="bg-surface-overlay">NVR</option>
                  <option value="Media Player" className="bg-surface-overlay">Media Player</option>
                  <option value="Display" className="bg-surface-overlay">Display</option>
                  <option value="Projector" className="bg-surface-overlay">Projector</option>
                </optgroup>
                <optgroup label="Peripherals">
                  <option value="Printer" className="bg-surface-overlay">Printer</option>
                  <option value="3D Printer" className="bg-surface-overlay">3D Printer</option>
                  <option value="Scanner" className="bg-surface-overlay">Scanner</option>
                  <option value="UPS" className="bg-surface-overlay">UPS</option>
                </optgroup>
                <optgroup label="Other">
                  <option value="Other" className="bg-surface-overlay">Other</option>
                </optgroup>
              </select>
            </Field>
          </div>
          <div className="mt-3 w-1/4">
            <Field label="Purchase Date">
              <input type="date" aria-label="Purchase Date" value={form.purchase_date} onChange={(e) => set({ purchase_date: e.target.value })}
                className="glass-input w-full text-sm" />
            </Field>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-white/50">Storage Drives</p>
              <button type="button"
                onClick={() => set({ drives: [...form.drives, { label: '', capacity: '', type: '' }] })}
                className="btn-ghost text-xs py-1 px-2">+ Add Drive</button>
            </div>
            {form.drives.map((drive, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-center">
                <input className="glass-input text-sm" placeholder="C: / sda" value={drive.label}
                  onChange={(e) => { const d = [...form.drives]; d[i] = { ...d[i], label: e.target.value }; set({ drives: d }) }} />
                <input className="glass-input text-sm" placeholder="500GB" value={drive.capacity}
                  onChange={(e) => { const d = [...form.drives]; d[i] = { ...d[i], capacity: e.target.value }; set({ drives: d }) }} />
                <select aria-label="Drive type" className="glass-input text-sm" value={drive.type}
                  onChange={(e) => { const d = [...form.drives]; d[i] = { ...d[i], type: e.target.value }; set({ drives: d }) }}>
                  <option value="" className="bg-surface-overlay">Type…</option>
                  <optgroup label="Solid State">
                    <option className="bg-surface-overlay">NVMe SSD (PCIe)</option>
                    <option className="bg-surface-overlay">SATA SSD</option>
                    <option className="bg-surface-overlay">M.2 SATA SSD</option>
                    <option className="bg-surface-overlay">PCIe SSD</option>
                    <option className="bg-surface-overlay">eMMC</option>
                  </optgroup>
                  <optgroup label="Spinning">
                    <option className="bg-surface-overlay">HDD</option>
                    <option className="bg-surface-overlay">HDD (NAS)</option>
                  </optgroup>
                  <optgroup label="Removable">
                    <option className="bg-surface-overlay">SD Card</option>
                    <option className="bg-surface-overlay">MicroSD</option>
                    <option className="bg-surface-overlay">USB Drive</option>
                    <option className="bg-surface-overlay">Optical</option>
                  </optgroup>
                  <optgroup label="Virtual">
                    <option className="bg-surface-overlay">Virtual Disk</option>
                    <option className="bg-surface-overlay">Network Share</option>
                  </optgroup>
                </select>
                <button type="button"
                  onClick={() => set({ drives: form.drives.filter((_, j) => j !== i) })}
                  className="btn-ghost text-xs py-1 px-2 text-red-400/60 hover:text-red-400">✕</button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Software & Access">
          <div className="grid grid-cols-2 gap-4">
            <Field label="OS">
              <TextInput value={form.os} onChange={(v) => set({ os: v })} placeholder="Windows 11 Pro" />
            </Field>
            <Field label="OS Version">
              <TextInput value={form.os_version} onChange={(v) => set({ os_version: v })} placeholder="25H2" />
            </Field>
            <Field label="Hostname" col={2}>
              <TextInput value={form.hostname} onChange={(v) => set({ hostname: v })} placeholder="mydevice.local" mono />
            </Field>
            <Field label="Username">
              <TextInput value={form.username} onChange={(v) => set({ username: v })} placeholder="pi" mono />
            </Field>
            <Field label="Password">
              <input type="password" value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={isEdit ? '(unchanged)' : 'password'}
                className="glass-input w-full text-sm font-mono" />
            </Field>
            <Field label="SSH" col={2}>
              <div className="flex items-center gap-3">
                <div className="w-[12.5%]">
                  <label className="block text-[10px] text-white/40 mb-1">Port</label>
                  <TextInput value={form.ssh_port} onChange={(v) => set({ ssh_port: v })} placeholder="22" mono />
                </div>
                <div className="flex flex-col">
                  <label className="block text-[10px] text-white/40 mb-1">Status</label>
                  <div className="flex items-center h-[34px]">
                    <Toggle checked={form.ssh_enabled} onChange={(v) => set({ ssh_enabled: v })} label="" />
                  </div>
                </div>
              </div>
            </Field>
            <Field label="SSH Key" col={2}>
              <textarea
                value={form.ssh_key}
                onChange={(e) => set({ ssh_key: e.target.value })}
                placeholder="Paste public key (ssh-ed25519 / ssh-rsa …)"
                rows={3}
                className="glass-input w-full text-xs font-mono resize-none"
              />
            </Field>
          </div>
        </Section>

        <Section title="Services">
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-white/50">Services</p>
              <button type="button"
                onClick={() => set({ services: [...form.services, { name: '', url: '', port: '' }] })}
                className="btn-ghost text-xs py-1 px-2">+ Add Service</button>
            </div>
            {form.services.map((svc, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.5fr_auto_auto] gap-2 items-center">
                <input className="glass-input text-sm" placeholder="Name" value={svc.name}
                  onChange={(e) => { const s = [...form.services]; s[i] = { ...s[i], name: e.target.value }; set({ services: s }) }} />
                <input className="glass-input text-sm font-mono" placeholder="http://device.local" value={svc.url}
                  onChange={(e) => { const s = [...form.services]; s[i] = { ...s[i], url: e.target.value }; set({ services: s }) }} />
                <input className="glass-input text-sm font-mono w-20" placeholder="Port" value={svc.port}
                  onChange={(e) => { const s = [...form.services]; s[i] = { ...s[i], port: e.target.value }; set({ services: s }) }} />
                <button type="button"
                  onClick={() => set({ services: form.services.filter((_, j) => j !== i) })}
                  className="btn-ghost text-xs py-1 px-2 text-red-400/60 hover:text-red-400">✕</button>
              </div>
            ))}
            {form.services.length === 0 && (
              <p className="text-xs text-white/20 py-1">No services added</p>
            )}
          </div>
        </Section>

        <Section title="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={4}
            className="glass-input w-full text-sm resize-none"
            placeholder="Any additional notes…"
          />
        </Section>

        {(deviceTypes ?? []).find((dt: any) => String(dt.id) === form.device_type_id)?.name === 'Printer (3D)' && (
          <Section title="3D Printer">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Firmware">
                <select aria-label="Firmware" value={form.firmware_type} onChange={(e) => set({ firmware_type: e.target.value })}
                  className="glass-input w-full text-sm">
                  <option value="" className="bg-surface-overlay">Unknown</option>
                  <option value="Klipper" className="bg-surface-overlay">Klipper</option>
                  <option value="Marlin" className="bg-surface-overlay">Marlin</option>
                  <option value="RRF" className="bg-surface-overlay">RepRapFirmware</option>
                  <option value="Bambu" className="bg-surface-overlay">Bambu</option>
                </select>
              </Field>
              <Field label="Bed Size">
                <TextInput value={form.bed_size} onChange={(v) => set({ bed_size: v })} placeholder="250x250x250" />
              </Field>
              <Field label="MCU Board">
                <TextInput value={form.mcu_board} onChange={(v) => set({ mcu_board: v })} placeholder="SKR Mini E3" />
              </Field>
            </div>
          </Section>
        )}

        {(deviceTypes ?? []).find((dt: any) => String(dt.id) === form.device_type_id)?.name?.startsWith('Virtual Machine') && (
          <Section title="Virtual Machine">
            <Field label="Hypervisor Host">
              <select aria-label="Hypervisor Host" value={form.hypervisor_device_id}
                onChange={(e) => set({ hypervisor_device_id: e.target.value })}
                className="glass-input w-full text-sm">
                <option value="" className="bg-surface-overlay">None</option>
                {(allDevices ?? [])
                  .filter((d: any) => d.id !== Number(id))
                  .map((d: any) => (
                    <option key={d.id} value={d.id} className="bg-surface-overlay">{d.name}</option>
                  ))}
              </select>
            </Field>
          </Section>
        )}
        </div>{/* end col 2 */}

        {/* Col 1 — Network Configuration */}
        <div className="space-y-4 col-start-1 row-start-1">

        {isInfraDevice ? (() => {
          const mgmt = form.nics[0] ?? emptyNic()
          const setMgmt = (patch: Partial<NicDraft>) => {
            const updated = form.nics.length > 0
              ? form.nics.map((n, i) => i === 0 ? { ...n, ...patch } : n)
              : [{ ...emptyNic(), ...patch }]
            set({ nics: updated })
          }

          // NIC validation for management interface
          const mgmtIp = mgmt.ip_address?.trim()
          const mgmtIpComplete = mgmtIp ? mgmtIp.split('.').length === 4 : false
          const mgmtSelectedNet = mgmt.network_id ? (networks ?? []).find((n: any) => String(n.id) === mgmt.network_id) : null
          const mgmtNetCidr: string | null = mgmtSelectedNet?.cidr ?? null
          const mgmtMalformedIp = mgmtIpComplete && mgmtIp && !isValidIp(mgmtIp) && mgmtIp.toUpperCase() !== 'DHCP'
            ? `"${mgmtIp}" is not a valid IP address` : null
          const mgmtSubnetWarn = !mgmtMalformedIp && mgmtIp && isValidIp(mgmtIp) && mgmtIp.toUpperCase() !== 'DHCP' && mgmtNetCidr
            ? (!isIpInCidr(mgmtIp, mgmtNetCidr) ? `${mgmtIp} is outside ${mgmtSelectedNet?.name}'s subnet (${mgmtNetCidr})` : null)
            : null
          const mgmtNetIsPublic = mgmtNetCidr ? !isRfc1918(mgmtNetCidr.split('/')[0]) : false
          const mgmtRfc1918Warn = !mgmtMalformedIp && !mgmtSubnetWarn && mgmtIp && isValidIp(mgmtIp) && mgmtIp.toUpperCase() !== 'DHCP' && !isRfc1918(mgmtIp) && !mgmtNetIsPublic
            ? `${mgmtIp} is a public IP — use private (RFC 1918) ranges for LAN interfaces` : null
          const mgmtDupIpWarn = !mgmtMalformedIp && mgmtIp && mgmtIp.toUpperCase() !== 'DHCP'
            ? occupiedIps.find(o => o.ip === mgmtIp)
              ? `${mgmtIp} is already assigned to ${occupiedIps.find(o => o.ip === mgmtIp)!.deviceName}` : null
            : null
          const mgmtMac = mgmt.mac?.trim().toLowerCase()
          const mgmtDupMacWarn = mgmtMac
            ? occupiedMacs.find(o => o.mac === mgmtMac)
              ? `${mgmt.mac.trim()} is already assigned to ${occupiedMacs.find(o => o.mac === mgmtMac)!.deviceName}` : null
            : null

          return (
            <Section title="Network Configuration">
              <div className="grid grid-cols-2 gap-4">
                <Field label="MAC Address">
                  <input value={mgmt.mac} onChange={(e) => setMgmt({ mac: e.target.value })}
                    placeholder="aa:bb:cc:dd:ee:ff"
                    className={`glass-input w-full text-sm font-mono${mgmtDupMacWarn ? ' border-amber-500/50' : ''}`} />
                  {mgmtDupMacWarn && (
                    <p className="flex items-center gap-1 mt-1 text-[10px] text-amber-400">
                      <span>⚠</span>{mgmtDupMacWarn}
                    </p>
                  )}
                </Field>
                <Field label="Network / VLAN">
                  <select value={mgmt.network_id} onChange={(e) => setMgmt({ network_id: e.target.value })}
                    title="Network / VLAN" className="glass-input w-full text-sm">
                    <option value="" className="bg-surface-overlay">None</option>
                    {(networks ?? []).map((n: any) => (
                      <option key={n.id} value={n.id} className="bg-surface-overlay">
                        {n.vlan_id ? `VLAN ${n.vlan_id} — ` : ''}{n.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="IP Address">
                  <input value={mgmt.ip_address} onChange={(e) => setMgmt({ ip_address: e.target.value })}
                    placeholder="192.168.1.x or DHCP"
                    className={`glass-input w-full text-sm font-mono${mgmtMalformedIp || mgmtDupIpWarn ? ' border-red-500/50' : mgmtSubnetWarn || mgmtRfc1918Warn ? ' border-amber-500/50' : ''}`} />
                  {mgmtMalformedIp && <p className="flex items-center gap-1 mt-1 text-[10px] text-red-400"><span>⚠</span>{mgmtMalformedIp}</p>}
                  {mgmtDupIpWarn && <p className="flex items-center gap-1 mt-1 text-[10px] text-red-400"><span>⚠</span>{mgmtDupIpWarn}</p>}
                  {!mgmtMalformedIp && !mgmtDupIpWarn && (mgmtSubnetWarn || mgmtRfc1918Warn) && (
                    <p className="flex items-center gap-1 mt-1 text-[10px] text-amber-400"><span>⚠</span>{mgmtSubnetWarn ?? mgmtRfc1918Warn}</p>
                  )}
                </Field>
                <Field label="Address Type">
                  <select value={mgmt.address_type} onChange={(e) => setMgmt({ address_type: e.target.value as any })}
                    title="Address Type" className="glass-input w-full text-sm">
                    <option value="reserved" className="bg-surface-overlay">Reserved (DHCP)</option>
                    <option value="static" className="bg-surface-overlay">Static</option>
                    <option value="dhcp" className="bg-surface-overlay">DHCP (dynamic)</option>
                  </select>
                </Field>
                <Field label="DNS Name" col={2}>
                  <input value={mgmt.dns_entry} onChange={(e) => setMgmt({ dns_entry: e.target.value })}
                    placeholder="hostname.local" className="glass-input w-full text-sm font-mono" />
                </Field>

                <Field label="DNS Server 1">
                  <input value={mgmt.dns_server_1} onChange={(e) => setMgmt({ dns_server_1: e.target.value })}
                    placeholder="1.1.1.1" className="glass-input w-full text-sm font-mono" />
                </Field>
                <Field label="DNS Server 2">
                  <input value={mgmt.dns_server_2} onChange={(e) => setMgmt({ dns_server_2: e.target.value })}
                    placeholder="8.8.8.8" className="glass-input w-full text-sm font-mono" />
                </Field>
                <div className="col-span-2">
                  <p className="text-[10px] text-white/25 italic">Leave blank to inherit DNS servers from the network configuration.</p>
                </div>
                {mgmt.address_type === 'static' && (<>
                  <Field label="Gateway">
                    <input value={mgmt.gateway} onChange={(e) => setMgmt({ gateway: e.target.value })}
                      placeholder="10.0.0.1" className="glass-input w-full text-sm font-mono" />
                  </Field>
                  <Field label="Subnet Mask">
                    <input value={mgmt.subnet_mask} onChange={(e) => setMgmt({ subnet_mask: e.target.value })}
                      placeholder="255.255.255.0 or /24" className="glass-input w-full text-sm font-mono" />
                  </Field>
                </>)}

                {/* OOB management switch connection */}
                {(() => {
                  const mgmtPort = (ownPorts as any[]).find((p) => p.is_management)
                  const disabled = !mgmtPort
                  return (
                    <div className={`col-span-2 border-t border-glass-border pt-3 space-y-3 ${disabled ? 'opacity-40' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider">OOB Management Connection</span>
                        {mgmtPort ? (
                          <span className="text-[10px] text-violet-400/70">via Port {mgmtPort.port_number}{mgmtPort.port_name ? ` / ${mgmtPort.port_name}` : ''}</span>
                        ) : (
                          <span className="text-[10px] text-white/25">— assign a management port first</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">OOB Switch</label>
                          <select value={mgmt.switch_device_id}
                            onChange={(e) => setMgmt({ switch_device_id: e.target.value, switch_port_id: '' })}
                            disabled={disabled}
                            className="glass-input w-full text-sm disabled:cursor-not-allowed" aria-label="OOB management switch">
                            <option value="" className="bg-surface-overlay">None</option>
                            {(switchDevices ?? []).filter((d: any) => String(d.id) !== id).map((d: any) => (
                              <option key={d.id} value={d.id} className="bg-surface-overlay">{d.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">OOB Port</label>
                          <select value={mgmt.switch_port_id}
                            onChange={(e) => setMgmt({ switch_port_id: e.target.value })}
                            disabled={disabled || !mgmt.switch_device_id}
                            className="glass-input w-full text-sm disabled:cursor-not-allowed" aria-label="OOB management port">
                            <option value="" className="bg-surface-overlay">— select port —</option>
                            {oobPorts.sort((a: any, b: any) => a.port_number - b.port_number).map((p: any) => (
                              <option key={p.id} value={p.id} className="bg-surface-overlay">
                                {p.port_name ? `Port ${p.port_number} / ${p.port_name}` : `Port ${p.port_number}`}{p.speed ? ` (${p.speed})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="col-span-2 border-t border-glass-border pt-3 grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Uplink Port (this switch)</label>
                    <select value={form.uplink_port_id} onChange={(e) => set({ uplink_port_id: e.target.value })}
                      className="glass-input w-full text-sm" aria-label="Uplink port on this switch">
                      <option value="" className="bg-surface-overlay">None</option>
                      {ownPorts.map((p: any) => (
                        <option key={p.id} value={p.id} className="bg-surface-overlay">
                          {p.port_name ? `Port ${p.port_number} / ${p.port_name}` : `Port ${p.port_number}`}{p.speed ? ` (${p.speed})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Upstream Switch</label>
                    <select value={form.upstream_device_id}
                      onChange={(e) => set({ upstream_device_id: e.target.value, upstream_port_id: '' })}
                      className="glass-input w-full text-sm" aria-label="Upstream switch">
                      <option value="" className="bg-surface-overlay">None</option>
                      {(switchDevices ?? []).filter((d: any) => String(d.id) !== id).map((d: any) => (
                        <option key={d.id} value={d.id} className="bg-surface-overlay">{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Upstream Port</label>
                    <select value={form.upstream_port_id} onChange={(e) => set({ upstream_port_id: e.target.value })}
                      disabled={!form.upstream_device_id}
                      className="glass-input w-full text-sm disabled:opacity-40" aria-label="Upstream switch port">
                      <option value="" className="bg-surface-overlay">None</option>
                      {upstreamPorts.map((p: any) => {
                        const occupied = p.connected_device_id && String(p.connected_device_id) !== id
                        return (
                          <option key={p.id} value={p.id} disabled={!!occupied} className="bg-surface-overlay">
                            {p.port_name ? `Port ${p.port_number} / ${p.port_name}` : `Port ${p.port_number}`}{p.speed ? ` (${p.speed})` : ''}{occupied ? ` — ${p.connected_device_name}` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-2 pt-1">
                  <input type="checkbox" id="mgmt-poe" checked={mgmt.poe_enabled}
                    onChange={(e) => setMgmt({ poe_enabled: e.target.checked })} className="rounded" />
                  <label htmlFor="mgmt-poe" className="text-sm text-white/60">Powered by PoE (uplink)</label>
                </div>
              </div>
            </Section>
          )
        })() : (
        <Section title="Network Configuration">
          <NicForm
            nics={form.nics}
            onChange={(nics) => set({ nics })}
            networks={(networks ?? []).map((n: any) => ({
              id: n.id, name: n.name, vlan_id: n.vlan_id, color: n.color, cidr: n.cidr ?? null,
              ssids: (n.ssids ?? []).map((s: any) => ({ ssid: s.ssid, bands: s.bands ?? [] })),
            }))}
            switchDevices={switchDevices ?? []}
            dnsDomain={dnsDomain}
            occupiedIps={occupiedIps}
            occupiedMacs={occupiedMacs}
          />
        </Section>
        )}

        {isWanCapable && isEdit && (
          <WanConfigsSection deviceId={Number(id)} wanConfigs={wanConfigs} onRefresh={() => { refetchWanConfigs(); qc.invalidateQueries({ queryKey: ['wan-configs-all'] }) }} />
        )}

        {isInfraDevice && isEdit && (
          <Section title="Ports">
            <SwitchPortsForm
              deviceId={Number(id)}
              uplinkPortId={form.uplink_port_id ? Number(form.uplink_port_id) : null}
              portDisplayRows={form.port_display_rows}
              portNumbering={form.port_numbering}
              onPortDisplayRowsChange={(v) => set({ port_display_rows: v })}
              onPortNumberingChange={(v) => set({ port_numbering: v })}
              isWanCapable={isWanCapable}
            />
          </Section>
        )}

        {isInfraDevice && !isEdit && (
          <Section title="Ports">
            <p className="text-sm text-white/30">Save the device first to add ports.</p>
          </Section>
        )}
        </div>{/* end col 1 */}

        {/* Sidebar — Storage, Services, HA, Pi-hole, Notes */}
        <div className="space-y-4 col-start-3 row-start-1">
        <Section title="Storage">
          <Field label="Storage Location">
            <div ref={storDropRef} className="relative">
              <button type="button" onClick={() => setStorDropOpen(o => !o)}
                className="glass-input w-full text-sm flex items-center justify-between gap-2 text-left cursor-pointer">
                <span className="truncate text-white">{storageDisplayPath || '— None —'}</span>
                <ChevronDown size={13} className={`flex-shrink-0 text-white/30 transition-transform ${storDropOpen ? 'rotate-180' : ''}`} />
              </button>
              {storDropOpen && (
                <div className="absolute z-30 top-full mt-1 left-0 w-full glass-card rounded-lg border border-white/[0.08] shadow-xl overflow-y-auto max-h-64 py-1">
                  <button type="button"
                    className="w-full text-left px-3 py-1.5 text-sm text-white/40 hover:bg-white/[0.05]"
                    onClick={() => { set({ storage_location: '', storage_location_id: '' }); setStorDropOpen(false) }}>
                    — None —
                  </button>
                  {flatStorTree.map((l) => (
                    <button key={l.id} type="button"
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-white/[0.05] ${form.storage_location_id === String(l.id) ? 'text-white bg-white/[0.04]' : 'text-white/70'}`}
                      style={{ paddingLeft: `${0.75 + l.depth * 1}rem` }}
                      onClick={() => { set({ storage_location: l.name, storage_location_id: String(l.id) }); setStorDropOpen(false) }}>
                      {l.name}
                    </button>
                  ))}
                  {flatStorTree.length === 0 && (
                    <p className="px-3 py-2 text-xs text-white/25">No storage locations configured.</p>
                  )}
                </div>
              )}
            </div>
          </Field>
        </Section>
        <Section title="Home Assistant">
          <Field label="HA Entity ID">
            <TextInput value={form.ha_entity_id} onChange={(v) => set({ ha_entity_id: v })}
              placeholder="switch.plug_living_room" mono />
          </Field>
        </Section>

        <Section title="Pi-hole">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Pi-hole Instance</label>
              <div className="flex items-center gap-3 h-[34px]">
                <Toggle checked={form.pihole_enabled} onChange={(v) => set({ pihole_enabled: v })} label="" />
                <span className="text-xs text-white/40">
                  {form.pihole_enabled ? 'Polled for DNS stats' : 'Enable as Pi-hole'}
                </span>
              </div>
            </div>
          </div>
          {form.pihole_enabled && (
            <div>
              <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Poll via NIC</label>
              <select
                value={form.pihole_nic_id}
                onChange={(e) => set({ pihole_nic_id: e.target.value })}
                className="glass-input text-sm w-full"
              >
                <option value="">Auto (first available)</option>
                {form.nics.map((n: any, idx: number) => {
                  const host = n.dns_entry || n.ip_address
                  const nicLabel = n.label || `NIC ${idx + 1}`
                  const label = host ? `${nicLabel} — ${host}` : nicLabel
                  return <option key={n.id ?? `new-${idx}`} value={String(n.id ?? '')}>{label}</option>
                })}
              </select>
            </div>
          )}
          {form.pihole_enabled && (
            <div className="mt-3">
              <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1.5">
                Pi-hole Admin Password
                {device?.pihole_password_set && (
                  <span className="ml-2 normal-case text-emerald-400/70">● password saved — leave blank to keep</span>
                )}
              </label>
              <input
                type="password"
                value={form.pihole_password}
                onChange={(e) => set({ pihole_password: e.target.value })}
                placeholder={device?.pihole_password_set ? '••••••••' : 'Pi-hole admin password (leave blank if none)'}
                className="glass-input text-sm w-full"
                autoComplete="new-password"
              />
            </div>
          )}
        </Section>

        </div>{/* end sidebar continued */}
      </div>{/* end three-column layout */}

      {/* Submit footer */}
      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={() => isEdit ? navigate(-1) : navigate('/devices')}
          className="btn-ghost">Cancel</button>
        <button type="submit" disabled={saveMutation.isPending}
          className="btn-primary flex items-center gap-2">
          {saveMutation.isPending ? <Loader size={15} className="animate-spin" /> : <Save size={15} />}
          {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Device'}
        </button>
      </div>
    </form>

    {pendingConflicts && (
      <ConflictModal
        deviceId={pendingConflicts.deviceId}
        conflicts={pendingConflicts.conflicts}
        onClose={() => {
          const targetId = pendingConflicts.deviceId
          setPendingConflicts(null)
          navigate(`/devices/${targetId}`, { replace: isEdit })
        }}
      />
    )}
    </>
  )
}
