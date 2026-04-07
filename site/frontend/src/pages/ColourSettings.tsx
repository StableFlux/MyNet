import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Save, RotateCcw, LucideIcon, Globe } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { ColorPicker } from '../components/ColorPicker'
import {
  DEFAULT_LOCATION_TYPE_COLORS,
  DEFAULT_DEVICE_CATEGORY_COLORS,
  DEFAULT_DEVICE_STATUS_COLORS,
  DEFAULT_WAN_PORT_COLOR,
  categoryFallbackColor,
} from '../hooks/useColorSettings'
import api from '../lib/api'
import { STATUS_ICON } from '../components/DeviceTypeIcon'

const STATUS_LABELS: Record<string, string> = {
  in_service:     'In Service',
  stock:          'Stock',
  undeployed:     'Undeployed',
  decommissioned: 'Decommissioned',
}

// ── Section component ────────────────────────────────────────────────────────

function ColorSection({
  title,
  description,
  listTitle,
  items,
  colors,
  onChange,
  onReset,
  emptyMessage,
}: {
  title: string
  description: string
  listTitle?: string
  items: { key: string; label: string; icon?: LucideIcon }[]
  colors: Record<string, string>
  onChange: (key: string, hex: string) => void
  onReset: () => void
  emptyMessage?: string
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)

  return (
    <GlassCard className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-white/40 mt-0.5">{description}</p>
        </div>
        <button type="button" onClick={onReset}
          className="btn-ghost text-xs flex items-center gap-1.5 flex-shrink-0 text-white/30 hover:text-white/60">
          <RotateCcw size={11} /> Reset defaults
        </button>
      </div>

      {items.length === 0 && emptyMessage && (
        <p className="text-xs text-white/30 italic">{emptyMessage}</p>
      )}
      <div>
        {listTitle && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5 px-1">{listTitle}</p>
        )}
        <div className="grid grid-cols-1 gap-2">
        {items.map(({ key, label, icon: Icon }) => {
          const hex = colors[key] ?? '#6b7280'
          const isOpen = openKey === key
          return (
            <div key={key} className="rounded-lg border border-white/[0.06] overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
              >
                {Icon
                  ? <Icon size={16} className="flex-shrink-0" style={{ color: hex }} />
                  : <span className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20" style={{ backgroundColor: hex }} />
                }
                <span className="text-xs font-medium flex-1" style={{ color: hex }}>{label}</span>
                <span className="text-[10px] font-mono text-white/25 flex-shrink-0">{hex}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 border-t border-white/[0.06] pt-3"
                  style={{ backgroundColor: hex + '0a' }}>
                  <ColorPicker value={hex} onChange={(c) => onChange(key, c)} />
                </div>
              )}
            </div>
          )
        })}
        </div>
      </div>
    </GlassCard>
  )
}

// ── Location Types section — grouped by top-level location ──────────────────

function collectTypes(node: any): string[] {
  const types: string[] = []
  if (node.type) types.push(node.type)
  for (const child of node.children ?? []) types.push(...collectTypes(child))
  return types
}

function LocationTypeColorSection({
  colors,
  onChange,
  onReset,
}: {
  colors: Record<string, string>
  onChange: (key: string, hex: string) => void
  onReset: () => void
}) {
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ['locations'],
    queryFn: async () => { const { data } = await api.get('/locations'); return data },
  })

  const [openKey, setOpenKey] = useState<string | null>(null)

  // Build groups: one per top-level location node
  const groups: { name: string; types: string[] }[] = (locations as any[]).map(root => ({
    name: root.name,
    types: Array.from(new Set(collectTypes(root))).sort(),
  })).filter(g => g.types.length > 0)

  const renderItem = (key: string) => {
    const hex = colors[key] ?? DEFAULT_LOCATION_TYPE_COLORS[key] ?? '#6b7280'
    const isOpen = openKey === key
    return (
      <div key={key} className="rounded-lg border border-white/[0.06] overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenKey(isOpen ? null : key)}
          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
        >
          <span className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20"
            style={{ backgroundColor: hex }} />
          <span className="text-xs font-medium flex-1" style={{ color: hex }}>{key}</span>
          <span className="text-[10px] font-mono text-white/25 flex-shrink-0">{hex}</span>
        </button>
        {isOpen && (
          <div className="px-3 pb-3 border-t border-white/[0.06] pt-3"
            style={{ backgroundColor: hex + '0a' }}>
            <ColorPicker value={hex} onChange={(c) => onChange(key, c)} />
          </div>
        )}
      </div>
    )
  }

  return (
    <GlassCard className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">Location Types</p>
          <p className="text-xs text-white/40 mt-0.5">Colours for location type badges and the location column in the device list.</p>
        </div>
        <button type="button" onClick={onReset}
          className="btn-ghost text-xs flex items-center gap-1.5 flex-shrink-0 text-white/30 hover:text-white/60">
          <RotateCcw size={11} /> Reset defaults
        </button>
      </div>

      {groups.length === 0 && (
        <p className="text-xs text-white/30 italic">No locations configured yet.</p>
      )}

      <div className="space-y-4">
        {groups.map(group => (
          <div key={group.name}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5 px-1">
              {group.name}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {group.types.map(renderItem)}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

// ── Networks/VLANs section — per-instance, saves immediately ────────────────

function NetworkColorSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const { data: networks = [] } = useQuery<any[]>({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
  })
  const { data: sysData } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })

  const [openId, setOpenId] = useState<number | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [wanOpen, setWanOpen] = useState(false)
  const [savingWan, setSavingWan] = useState(false)

  const wanColor: string = sysData?.wan_port_color ?? DEFAULT_WAN_PORT_COLOR

  const saveNetworkColor = async (id: number, hex: string) => {
    setSavingId(id)
    try {
      await api.patch(`/networks/${id}/color`, { color: hex })
      qc.invalidateQueries({ queryKey: ['networks'] })
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? 'Failed to save colour')
    } finally {
      setSavingId(null)
    }
  }

  const saveWanColor = async (hex: string) => {
    setSavingWan(true)
    try {
      const { data } = await api.patch('/system-settings', { wan_port_color: hex })
      qc.setQueryData(['system-settings'], (old: any) => ({ ...old, ...data }))
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? 'Failed to save colour')
    } finally {
      setSavingWan(false)
    }
  }

  return (
    <GlassCard className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-white">Networks / VLANs</p>
        <p className="text-xs text-white/40 mt-0.5">
          Accent colour for each network — used on NIC pills, subnet map, and network cards.
          Changes save immediately.
        </p>
      </div>
      <div className="space-y-4">

        {/* WAN group */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5 px-1">WAN</p>
        <div className="grid grid-cols-1 gap-2">
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <button type="button"
            onClick={() => setWanOpen(o => !o)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left">
            <Globe size={16} className="flex-shrink-0" style={{ color: wanColor }} />
            <span className="text-xs font-medium flex-1" style={{ color: wanColor }}>WAN</span>
            <span className="text-[10px] font-mono text-white/25 flex-shrink-0">{wanColor}</span>
            {savingWan && <span className="text-[10px] text-white/30 flex-shrink-0">Saving…</span>}
          </button>
          {wanOpen && (
            <div className="px-3 pb-3 border-t border-white/[0.06] pt-3"
              style={{ backgroundColor: wanColor + '0a' }}>
              <ColorPicker value={wanColor} onChange={saveWanColor} />
            </div>
          )}
        </div>
        </div>
        </div>

        {/* Networks group */}
        {networks.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5 px-1">Network</p>
          <div className="grid grid-cols-1 gap-2">
        {networks.map((n: any) => {
          const hex: string = n.color ?? '#6366f1'
          const isOpen = openId === n.id
          const label = n.vlan_id ? `VLAN ${n.vlan_id} — ${n.name}` : n.name
          return (
            <div key={n.id} className="rounded-lg border border-white/[0.06] overflow-hidden">
              <button type="button"
                onClick={() => setOpenId(isOpen ? null : n.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left">
                <span className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20"
                  style={{ backgroundColor: hex }} />
                <span className="text-xs font-medium flex-1 text-white/70">{label}</span>
                <span className="text-[10px] font-mono text-white/25 flex-shrink-0">{hex}</span>
                {savingId === n.id && <span className="text-[10px] text-white/30 flex-shrink-0">Saving…</span>}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 border-t border-white/[0.06] pt-3"
                  style={{ backgroundColor: hex + '0a' }}>
                  <ColorPicker value={hex} onChange={(c) => saveNetworkColor(n.id, c)} />
                </div>
              )}
            </div>
          )
        })}
          </div>
        </div>
        )}

      </div>
    </GlassCard>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ColourSettings() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: sysData } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })

  const { data: deviceTypes = [] } = useQuery<any[]>({
    queryKey: ['device-types'],
    queryFn: async () => { const { data } = await api.get('/device-types'); return data },
  })

  const [locationColors, setLocationColors] = useState<Record<string, string>>({})
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>({})
  const [statusColors, setStatusColors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (sysData) {
      setLocationColors(sysData.location_type_colors ?? DEFAULT_LOCATION_TYPE_COLORS)
      setCategoryColors(sysData.device_category_colors ?? DEFAULT_DEVICE_CATEGORY_COLORS)
      setStatusColors(sysData.device_status_colors ?? DEFAULT_DEVICE_STATUS_COLORS)
      setDirty(false)
    }
  }, [sysData])

  const handleLocationChange = (key: string, hex: string) => { setLocationColors(prev => ({ ...prev, [key]: hex })); setDirty(true) }
  const handleCategoryChange = (key: string, hex: string) => { setCategoryColors(prev => ({ ...prev, [key]: hex })); setDirty(true) }
  const handleStatusChange   = (key: string, hex: string) => { setStatusColors(prev => ({ ...prev, [key]: hex })); setDirty(true) }

  const save = async () => {
    setSaving(true)
    try {
      const { data } = await api.patch('/system-settings', {
        location_type_colors: locationColors,
        device_category_colors: categoryColors,
        device_status_colors: statusColors,
      })
      qc.setQueryData(['system-settings'], (old: any) => ({ ...old, ...data }))
      setDirty(false)
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? 'Failed to save colours')
    } finally {
      setSaving(false)
    }
  }

  const categories = Array.from(
    new Set((deviceTypes as any[]).map((dt: any) => dt.category ?? 'Other').filter(Boolean))
  ).sort() as string[]
  const categoryItems = categories.map(c => ({ key: c, label: c }))
  const statusItems   = Object.entries(STATUS_LABELS).map(([key, label]) => ({ key, label, icon: STATUS_ICON[key] }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/settings')} className="btn-ghost flex items-center gap-1.5 text-sm">
            <ChevronLeft size={14} />
            Settings
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Colour Settings</h1>
            <p className="text-sm text-white/40 mt-0.5">Customise colours used across the site</p>
          </div>
        </div>
        {dirty && (
          <button type="button" onClick={save} disabled={saving}
            className="btn-primary flex items-center gap-2">
            <Save size={14} />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        <NetworkColorSection qc={qc} />

        <LocationTypeColorSection
          colors={locationColors}
          onChange={handleLocationChange}
          onReset={() => { setLocationColors(DEFAULT_LOCATION_TYPE_COLORS); setDirty(true) }}
        />

        <ColorSection
          title="Device Categories"
          description="Colours for category headers in the grouped device view."
          listTitle="Category"
          items={categoryItems}
          colors={Object.fromEntries(categoryItems.map(({ key }) => [key, categoryColors[key] ?? categoryFallbackColor(key)]))}
          onChange={handleCategoryChange}
          onReset={() => { setCategoryColors(DEFAULT_DEVICE_CATEGORY_COLORS); setDirty(true) }}
          emptyMessage="No device types configured yet."
        />

        <ColorSection
          title="Device Statuses"
          description="Colours for the status indicator dot on each device."
          listTitle="Status"
          items={statusItems}
          colors={statusColors}
          onChange={handleStatusChange}
          onReset={() => { setStatusColors(DEFAULT_DEVICE_STATUS_COLORS); setDirty(true) }}
        />
      </div>
    </div>
  )
}
