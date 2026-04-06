import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import api from '../lib/api'

// ---------------------------------------------------------------------------
// Network colour palette
// ---------------------------------------------------------------------------

const PRESET_COLORS = [
  '#6366f1', // indigo — Core
  '#3b82f6', // blue — Trusted
  '#f59e0b', // amber — IoT
  '#ef4444', // red — Pentest
  '#8b5cf6', // violet — DMZ
  '#10b981', // emerald
  '#f97316', // orange
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
]

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface SsidEntry {
  ssid: string
  password: string
  hidden: boolean
  bands: string[]
  security: '' | 'Open' | 'WPA2' | 'WPA3' | 'WPA2/WPA3' | 'WPA2-Enterprise' | 'WPA3-Enterprise'
}

interface FormState {
  name: string
  vlan_id: string
  cidr: string
  gateway: string
  dhcp_range_start: string
  dhcp_range_end: string
  dns_auto: boolean
  dns_servers: string[]   // index 0 = primary, index 1 = secondary
  purpose: string
  color: string
  ssids: SsidEntry[]
  notes: string
  inter_vlan_rules: string // JSON textarea
}

function emptyForm(): FormState {
  return {
    name: '', vlan_id: '', cidr: '', gateway: '',
    dhcp_range_start: '', dhcp_range_end: '',
    dns_auto: false, dns_servers: ['', ''],
    purpose: '', color: '#6366f1',
    ssids: [], notes: '', inter_vlan_rules: '',
  }
}

function normaliseSsid(s: any): SsidEntry {
  if (typeof s === 'string') return { ssid: s, password: '', hidden: false, bands: [], security: '' }
  // back-compat: old single `band` string → array
  const bands = Array.isArray(s.bands) ? s.bands : (s.band ? [s.band] : [])
  return {
    ssid: s.ssid ?? '',
    password: s.password ?? '',
    hidden: s.hidden ?? false,
    bands,
    security: s.security ?? '',
  }
}

function networkToForm(n: any): FormState {
  const dns_servers = [n.dns_primary ?? '', n.dns_secondary ?? '']
  if (Array.isArray(n.dns_extra)) dns_servers.push(...n.dns_extra)
  return {
    name: n.name ?? '',
    vlan_id: n.vlan_id != null ? String(n.vlan_id) : '',
    cidr: n.cidr ?? '',
    gateway: n.gateway ?? '',
    dhcp_range_start: n.dhcp_range_start ?? '',
    dhcp_range_end: n.dhcp_range_end ?? '',
    dns_auto: n.dns_auto ?? false,
    dns_servers,
    purpose: n.purpose ?? '',
    color: n.color ?? '#6366f1',
    ssids: Array.isArray(n.ssids) ? n.ssids.map(normaliseSsid) : [],
    notes: n.notes ?? '',
    inter_vlan_rules: n.inter_vlan_rules
      ? JSON.stringify(n.inter_vlan_rules, null, 2)
      : '',
  }
}

function formToPayload(f: FormState) {
  let inter_vlan_rules: any = null
  if (f.inter_vlan_rules.trim()) {
    try { inter_vlan_rules = JSON.parse(f.inter_vlan_rules) } catch { /* leave null */ }
  }
  const filled = f.dns_auto ? [] : f.dns_servers.map((s) => s.trim()).filter(Boolean)
  return {
    name: f.name,
    vlan_id: f.vlan_id ? parseInt(f.vlan_id) : null,
    cidr: f.cidr || null,
    gateway: f.gateway || null,
    dhcp_range_start: f.dhcp_range_start || null,
    dhcp_range_end: f.dhcp_range_end || null,
    dns_auto: f.dns_auto,
    dns_primary: filled[0] ?? null,
    dns_secondary: filled[1] ?? null,
    dns_extra: filled.length > 2 ? filled.slice(2) : null,
    purpose: f.purpose || null,
    color: f.color,
    ssids: f.ssids.filter((e) => e.ssid.trim()),
    notes: f.notes || null,
    inter_vlan_rules,
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-white/40 mb-1">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono = false, type = 'text' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`glass-input w-full text-sm${mono ? ' font-mono' : ''}`}
    />
  )
}

function Section({
  title, defaultOpen = true, children,
}: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-glass-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white/80 hover:text-white bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        {title}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// NetworkForm page
// ---------------------------------------------------------------------------

export default function NetworkForm() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [form, setForm] = useState<FormState>(emptyForm())
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch existing network when editing
  const { data: existing } = useQuery({
    queryKey: ['network', id],
    queryFn: async () => { const { data } = await api.get(`/networks/${id}`); return data },
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) setForm(networkToForm(existing))
  }, [existing])

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  // Mutations
  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? api.put(`/networks/${id}`, payload) : api.post('/networks', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['networks'] })
      qc.invalidateQueries({ queryKey: ['subnet-map'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['network', id] })
      navigate('/networks')
    },
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Save failed'),
  })

  // Validation
  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (form.inter_vlan_rules.trim()) {
      try { JSON.parse(form.inter_vlan_rules) }
      catch { e.inter_vlan_rules = 'Must be valid JSON' }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    saveMutation.mutate(formToPayload(form))
  }

  const addSsid = () => set({ ssids: [...form.ssids, { ssid: '', password: '', hidden: false, bands: [], security: '' }] })

  const updateSsid = (i: number, patch: Partial<SsidEntry>) =>
    set({ ssids: form.ssids.map((e, j) => j === i ? { ...e, ...patch } : e) })

  const removeSsid = (i: number) => set({ ssids: form.ssids.filter((_, j) => j !== i) })

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {isEdit ? 'Edit Network' : 'Add Network'}
          </h1>
          <p className="text-sm text-white/40 mt-0.5">
            {isEdit ? 'Update network configuration' : 'Configure a new VLAN or network segment'}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate('/networks')} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
            {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Network'}
          </button>
        </div>
      </div>

      {saveMutation.isError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          Failed to save network. Please check your input and try again.
        </div>
      )}

      {/* Identity */}
      <Section title="Identity">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Network Name *">
              <TextInput value={form.name} onChange={(v) => set({ name: v })} placeholder="Core Network" />
              {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
            </Field>
          </div>
          <Field label="VLAN ID">
            <TextInput value={form.vlan_id} onChange={(v) => set({ vlan_id: v })} placeholder="20" type="number" />
          </Field>
          <Field label="Purpose / Tag">
            <TextInput value={form.purpose} onChange={(v) => set({ purpose: v })} placeholder="Trusted LAN" />
          </Field>
        </div>

        {/* Colour picker */}
        <div>
          <label className="block text-[10px] text-white/40 mb-2">Accent Colour</label>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Select colour ${c}`}
                  title={c}
                  onClick={() => set({ color: c })}
                  style={{ '--accent': c } as React.CSSProperties}
                  className={`accent-bar w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                    form.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-surface scale-110' : ''
                  }`}
                />
              ))}
            </div>
            {/* Custom colour input */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full border border-glass-border overflow-hidden flex-shrink-0">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => set({ color: e.target.value })}
                  aria-label="Custom accent colour"
                  title="Pick a custom colour"
                  className="w-8 h-8 -ml-1 -mt-1 cursor-pointer"
                />
              </div>
              <span className="text-xs text-white/40 font-mono">{form.color}</span>
            </div>
          </div>
        </div>
      </Section>

      {/* Addressing */}
      <Section title="IP Addressing">
        <div className="grid grid-cols-2 gap-3">
          <Field label="CIDR">
            <TextInput value={form.cidr} onChange={(v) => set({ cidr: v })} placeholder="192.168.1.0/24" mono />
          </Field>
          <Field label="Gateway">
            <TextInput value={form.gateway} onChange={(v) => set({ gateway: v })} placeholder="192.168.1.1" mono />
          </Field>
          <Field label="DHCP Range Start">
            <TextInput value={form.dhcp_range_start} onChange={(v) => set({ dhcp_range_start: v })} placeholder="192.168.1.100" mono />
          </Field>
          <Field label="DHCP Range End">
            <TextInput value={form.dhcp_range_end} onChange={(v) => set({ dhcp_range_end: v })} placeholder="192.168.1.200" mono />
          </Field>
        </div>
      </Section>

      {/* DNS */}
      <Section title="DNS">
        {/* Auto / Manual toggle — mirrors UniFi UX */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-glass-border w-fit">
          <button
            type="button"
            onClick={() => set({ dns_auto: true })}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              form.dns_auto
                ? 'bg-indigo-600 text-white'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => set({ dns_auto: false })}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              !form.dns_auto
                ? 'bg-indigo-600 text-white'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            Manual
          </button>
        </div>

        {form.dns_auto ? (
          <p className="text-xs text-white/40 mt-1">
            DNS will be assigned automatically — DHCP clients receive the gateway address as their DNS server.
          </p>
        ) : (
          <div className="space-y-2 mt-3">
            {form.dns_servers.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-white/30 w-16 flex-shrink-0">
                  {i === 0 ? 'Primary' : i === 1 ? 'Secondary' : `Server ${i + 1}`}
                </span>
                <input
                  type="text"
                  value={entry}
                  onChange={(e) => {
                    const next = [...form.dns_servers]
                    next[i] = e.target.value
                    set({ dns_servers: next })
                  }}
                  placeholder={i === 0 ? '192.168.1.1' : i === 1 ? '8.8.8.8' : '0.0.0.0'}
                  className="glass-input flex-1 text-sm font-mono"
                />
                {form.dns_servers.length > 2 && (
                  <button
                    type="button"
                    onClick={() => set({ dns_servers: form.dns_servers.filter((_, j) => j !== i) })}
                    className="text-white/30 hover:text-red-400 transition-colors"
                    aria-label="Remove DNS server"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ dns_servers: [...form.dns_servers, ''] })}
              className="btn-ghost flex items-center gap-1.5 text-xs mt-1"
            >
              <Plus size={12} /> Add DNS server
            </button>
          </div>
        )}
      </Section>

      {/* SSIDs */}
      <Section title="Wireless SSIDs" defaultOpen={false}>
        <div className="space-y-3">
          {form.ssids.map((entry, i) => (
            <div key={i} className="p-3 rounded-lg bg-white/[0.03] border border-glass-border space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-white/30 font-medium">SSID {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeSsid(i)}
                  className="text-white/30 hover:text-red-400 transition-colors"
                  aria-label={`Remove SSID ${i + 1}`}
                ><X size={13} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Network Name">
                  <TextInput
                    value={entry.ssid}
                    onChange={(v) => updateSsid(i, { ssid: v })}
                    placeholder="MyWiFi-20"
                  />
                </Field>
                <Field label="Password">
                  <TextInput
                    value={entry.password}
                    onChange={(v) => updateSsid(i, { password: v })}
                    placeholder="Leave blank if open"
                    type="password"
                  />
                </Field>
                <Field label="Radio Bands">
                  <div className="flex gap-3 h-[34px] items-center">
                    {(['2.4GHz', '5GHz', '6GHz'] as const).map((b) => (
                      <label key={b} className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={entry.bands.includes(b)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...entry.bands, b]
                              : entry.bands.filter((x) => x !== b)
                            updateSsid(i, { bands: next })
                          }}
                          className="rounded"
                        />
                        {b}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Security Protocol">
                  <select
                    aria-label="Security protocol"
                    value={entry.security}
                    onChange={(e) => updateSsid(i, { security: e.target.value as SsidEntry['security'] })}
                    className="glass-input w-full text-sm"
                  >
                    <option value="" className="bg-surface-overlay">Not set</option>
                    <option value="Open" className="bg-surface-overlay">Open</option>
                    <option value="WPA2" className="bg-surface-overlay">WPA2-Personal</option>
                    <option value="WPA3" className="bg-surface-overlay">WPA3-Personal</option>
                    <option value="WPA2/WPA3" className="bg-surface-overlay">WPA2/WPA3 (mixed)</option>
                    <option value="WPA2-Enterprise" className="bg-surface-overlay">WPA2-Enterprise</option>
                    <option value="WPA3-Enterprise" className="bg-surface-overlay">WPA3-Enterprise</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={entry.hidden}
                  onChange={(e) => updateSsid(i, { hidden: e.target.checked })}
                  className="rounded"
                />
                Hidden network (not broadcast)
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={addSsid}
            className="btn-ghost flex items-center gap-1.5 text-xs"
          >
            <Plus size={12} /> Add SSID
          </button>
        </div>
      </Section>

      {/* Inter-VLAN rules */}
      <Section title="Inter-VLAN Rules (JSON)" defaultOpen={false}>
        <div>
          <textarea
            value={form.inter_vlan_rules}
            onChange={(e) => set({ inter_vlan_rules: e.target.value })}
            placeholder={'[\n  {"allow": true, "dest_vlan": 1, "note": "to core"}\n]'}
            rows={5}
            className="glass-input w-full text-sm font-mono resize-y"
          />
          {errors.inter_vlan_rules && (
            <p className="text-xs text-red-400 mt-1">{errors.inter_vlan_rules}</p>
          )}
          <p className="text-[10px] text-white/30 mt-1">Optional. Free-form JSON for documenting firewall rules between VLANs.</p>
        </div>
      </Section>

      {/* Notes */}
      <Section title="Notes" defaultOpen={false}>
        <textarea
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Additional notes about this network..."
          rows={3}
          className="glass-input w-full text-sm resize-y"
        />
      </Section>

    </form>
  )
}
