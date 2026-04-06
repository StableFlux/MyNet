import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Package, ArrowRight, ChevronRight, ChevronDown, MapPin, Calendar,
  Cpu, HardDrive, Monitor,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useColorSettings } from '../hooks/useColorSettings'
import api from '../lib/api'

const STATUS_CONFIG: Record<string, { label: string; pill: string }> = {
  stock:      { label: 'In Stock',    pill: 'rounded-full' },
  undeployed: { label: 'Undeployed',  pill: 'rounded' },
}

function StatPill({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-glass-border bg-white/[0.06]">
      <span className="text-2xl font-bold leading-none" style={{ color: color ?? 'white' }}>{value}</span>
      <span className="text-xs text-white/40 leading-tight">{label}</span>
    </div>
  )
}

function DeployForm({
  device, networks, isPending, onSubmit, onCancel,
}: {
  device: any; networks: any[]; isPending: boolean;
  onSubmit: (form: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: device.name,
    hostname: device.hostname ?? '',
    location: '',
    network_id: '',
    ip_address: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="mx-4 mb-3 p-4 rounded-xl border border-indigo-500/30 space-y-3"
      style={{ background: 'linear-gradient(160deg, color-mix(in srgb, #6366f1 6%, var(--card-base-deep)) 0%, var(--card-base-deepest) 100%)' }}>
      <p className="text-xs font-semibold text-indigo-300">Deploy {device.name}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-white/40 block mb-1">Name</label>
          <input className="glass-input w-full text-sm" value={form.name}
            onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-white/40 block mb-1">Hostname</label>
          <input className="glass-input w-full text-sm font-mono" value={form.hostname}
            onChange={e => set('hostname', e.target.value)} placeholder="hostname.local" />
        </div>
        <div>
          <label className="text-[10px] text-white/40 block mb-1">Location</label>
          <input className="glass-input w-full text-sm" value={form.location}
            onChange={e => set('location', e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-white/40 block mb-1">Network</label>
          <select className="glass-input w-full text-sm" value={form.network_id}
            onChange={e => set('network_id', e.target.value)}>
            <option value="" className="bg-surface-overlay">Select…</option>
            {networks.map((n: any) => (
              <option key={n.id} value={n.id} className="bg-surface-overlay">
                {n.vlan_id ? `VLAN ${n.vlan_id} — ` : ''}{n.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-white/40 block mb-1">IP Address</label>
          <input className="glass-input w-full text-sm font-mono" value={form.ip_address}
            onChange={e => set('ip_address', e.target.value)} placeholder="192.168.1.x" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={isPending} onClick={() => onSubmit(form)}
          className="btn-primary flex items-center gap-1.5 text-sm">
          {isPending ? 'Deploying…' : 'Confirm Deploy'} <ChevronRight size={14} />
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
      </div>
    </div>
  )
}

export default function StockTracker() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'
  const colors = useColorSettings()
  const [deployingId, setDeployingId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleModel = (key: string) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

  const { data: devices } = useQuery({
    queryKey: ['devices', 'stock'],
    queryFn: async () => {
      const [{ data: stock }, { data: undeployed }] = await Promise.all([
        api.get('/devices?status=stock'),
        api.get('/devices?status=undeployed'),
      ])
      return [...stock, ...undeployed]
    },
  })

  const { data: networks } = useQuery({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
  })

  const { data: locations = [] } = useQuery<{ id: number; name: string; parent_id: number | null }[]>({
    queryKey: ['locations', 'flat'],
    queryFn: async () => { const { data } = await api.get('/locations?flat=true'); return data },
  })

  const resolveStoragePath = useMemo(() => {
    const byId = Object.fromEntries(locations.map(l => [l.id, l]))
    const storageRoot = locations.find(l => l.name.toLowerCase() === 'storage' && !l.parent_id)
    const byName = Object.fromEntries(locations.map(l => [l.name, l]))
    return (name: string): string => {
      if (!name || !storageRoot) return name
      const node = byName[name]
      if (!node) return name
      const parts: string[] = []
      let cur: typeof node | undefined = node
      while (cur && cur.id !== storageRoot.id) {
        parts.unshift(cur.name)
        cur = cur.parent_id != null ? byId[cur.parent_id] : undefined
      }
      return parts.join(' › ') || name
    }
  }, [locations])

  const deployMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: any }) =>
      api.post(`/devices/${id}/deploy`, {
        name: form.name,
        hostname: form.hostname || null,
        location: form.location || null,
        network_id: form.network_id ? Number(form.network_id) : null,
        ip_address: form.ip_address || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['search'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['monitoring'] })
      qc.invalidateQueries({ queryKey: ['subnet-map'] })
      setDeployingId(null)
    },
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Deploy failed'),
  })

  const all: any[] = devices ?? []
  const stockCount = all.filter(d => d.status === 'stock').length
  const undeployedCount = all.filter(d => d.status === 'undeployed').length

  // brand → category → model → devices (three-level grouping)
  const brandGroups = useMemo(() => {
    const byBrand: Record<string, Record<string, Record<string, any[]>>> = {}
    for (const d of all) {
      const brand = d.brand || 'Unknown'
      const category = d.device_type_name || d.hardware_type || 'Other'
      const model = d.model || d.name
      if (!byBrand[brand]) byBrand[brand] = {}
      if (!byBrand[brand][category]) byBrand[brand][category] = {}
      byBrand[brand][category][model] = [...(byBrand[brand][category][model] ?? []), d].sort((a, b) => a.name.localeCompare(b.name))
    }
    return Object.entries(byBrand)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([brand, categories]) => ({
        brand,
        categories: Object.entries(categories)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, models]) => ({
            category,
            models: Object.entries(models).sort(([a], [b]) => a.localeCompare(b)),
          })),
      }))
  }, [all])

  const modelCount = brandGroups.reduce((n, bg) => n + bg.categories.reduce((m, c) => m + c.models.length, 0), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Stock & Deployment</h1>
        <p className="text-sm text-white/40 mt-0.5">
          {all.length} item{all.length !== 1 ? 's' : ''} awaiting deployment
        </p>
      </div>

      {/* Summary */}
      {all.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <StatPill label="Total" value={all.length} />
          {stockCount > 0 && (
            <StatPill label="In Stock" value={stockCount} color={colors.statusColor('stock')} />
          )}
          {undeployedCount > 0 && (
            <StatPill label="Undeployed" value={undeployedCount} color={colors.statusColor('undeployed')} />
          )}
          {modelCount > 0 && (
            <span className="text-xs text-white/20 ml-1">
              {brandGroups.length} brand{brandGroups.length !== 1 ? 's' : ''}, {modelCount} model{modelCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Brand → Model cards: 3-column grid, left-to-right ordering */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {[0, 1, 2].map(col => (
          <div key={col} className="flex flex-col gap-4">
            {brandGroups.filter((_, i) => i % 3 === col).map(({ brand, categories }) => {
              const brandTotal = categories.reduce((n, c) => n + c.models.reduce((m, [, items]) => m + items.length, 0), 0)
              return (
                <div key={brand} className="glass-card overflow-hidden">

                  {/* Brand header */}
                  <div className="px-4 py-3 border-b border-glass-border flex items-center gap-3">
                    <p className="text-sm font-bold text-white">{brand}</p>
                    <span className="text-xs text-white/30">{brandTotal} unit{brandTotal !== 1 ? 's' : ''}</span>
                  </div>

                  <div className="p-3 flex flex-col gap-3">
                    {categories.map(({ category, models }) => (
                      <div key={category}>
                        {/* Category divider */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{category}</span>
                          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--glass-border)' }} />
                        </div>
                        <div className="flex flex-col gap-2">
                    {models.map(([modelKey, items]) => {
                      const undeployedCount = items.filter((d: any) => d.status === 'undeployed').length
                      const stockCount = items.filter((d: any) => d.status === 'stock').length
                      const hasUndeployed = undeployedCount > 0
                      const accentColor = hasUndeployed
                        ? colors.statusColor('undeployed')
                        : colors.statusColor('stock')
                      const sample = items[0]
                      const collapseKey = `${brand}::${category}::${modelKey}`
                      const isCollapsed = collapsed[collapseKey] ?? true

                      return (
                        <div key={collapseKey}
                          className="rounded-lg border border-glass-border overflow-hidden"
                          style={{
                            borderTopColor: `${accentColor}55`,
                            background: `linear-gradient(160deg, color-mix(in srgb, ${accentColor} 10%, var(--card-base-deep)) 0%, var(--card-base-deepest) 100%)`,
                          }}>

                          {/* Model header — click to collapse */}
                          <div className="flex"
                            style={{ borderBottom: isCollapsed ? 'none' : '1px solid var(--glass-border)' }}>
                            {/* Chevron handle — left edge toggle */}
                            <button type="button" onClick={() => toggleModel(collapseKey)}
                              className="flex items-center justify-center w-9 flex-shrink-0 border-r border-glass-border hover:bg-white/[0.04] transition-colors">
                              {isCollapsed
                                ? <ChevronRight size={13} className="text-white/25" />
                                : <ChevronDown size={13} className="text-white/25" />}
                            </button>
                            {/* Main content */}
                            <button type="button" onClick={() => toggleModel(collapseKey)}
                              className="flex-1 px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-white/[0.12] flex items-center justify-center flex-shrink-0">
                                <Package size={15} className="text-white/40" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate">{modelKey}</p>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {undeployedCount > 0 && (() => {
                                  const hex = colors.statusColor('undeployed')
                                  return (
                                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 font-medium border ${STATUS_CONFIG.undeployed.pill}`}
                                      style={{ color: hex, backgroundColor: hex + '1a', borderColor: hex + '40' }}>
                                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                                      {undeployedCount} {STATUS_CONFIG.undeployed.label}
                                    </span>
                                  )
                                })()}
                                {stockCount > 0 && (() => {
                                  const hex = colors.statusColor('stock')
                                  return (
                                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 font-medium border ${STATUS_CONFIG.stock.pill}`}
                                      style={{ color: hex, backgroundColor: hex + '1a', borderColor: hex + '40' }}>
                                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                                      {stockCount} {STATUS_CONFIG.stock.label}
                                    </span>
                                  )
                                })()}
                              </div>
                            </button>
                          </div>

                          {/* Device rows */}
                          {!isCollapsed && (
                            <div className="divide-y divide-glass-border">
                              {items.map((device: any) => {
                                const cfg = STATUS_CONFIG[device.status] ?? STATUS_CONFIG.stock
                                const statusHex = colors.statusColor(device.status)
                                const storeLoc = device.storage_location
                                  ? resolveStoragePath(device.storage_location)
                                  : device.location
                                return (
                                  <div key={device.id}>
                                    <div className="px-4 py-3 flex items-center gap-3">
                                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: statusHex }} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <p className="text-sm font-medium text-white">{device.name}</p>
                                          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 font-medium border ${cfg.pill}`}
                                            style={{ color: statusHex, backgroundColor: statusHex + '1a', borderColor: statusHex + '40' }}>
                                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                              style={{ backgroundColor: statusHex }} />
                                            {cfg.label}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                          {device.use && (
                                            <span className="text-[11px] text-white/40 truncate">{device.use}</span>
                                          )}
                                          {device.cpu && (
                                            <span className="flex items-center gap-1 text-[11px] text-white/30">
                                              <Cpu size={9} />{device.cpu}
                                            </span>
                                          )}
                                          {device.ram && (
                                            <span className="flex items-center gap-1 text-[11px] text-white/30">
                                              <HardDrive size={9} />{device.ram}
                                            </span>
                                          )}
                                          {device.os && (
                                            <span className="flex items-center gap-1 text-[11px] text-white/30">
                                              <Monitor size={9} />{device.os}
                                            </span>
                                          )}
                                          {storeLoc && (
                                            <span className="flex items-center gap-1 text-[11px] text-white/30">
                                              <MapPin size={9} />{storeLoc}
                                            </span>
                                          )}
                                          {device.purchase_date && (
                                            <span className="flex items-center gap-1 text-[11px] text-white/30">
                                              <Calendar size={9} />{device.purchase_date}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <button type="button"
                                          onClick={() => navigate(`/devices/${device.id}`)}
                                          className="btn-ghost px-2.5 py-1.5 text-xs">
                                          View
                                        </button>
                                        {canEdit && (
                                          <button type="button"
                                            onClick={() => setDeployingId(
                                              deployingId === device.id ? null : device.id
                                            )}
                                            className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-2.5">
                                            Deploy <ArrowRight size={11} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {deployingId === device.id && (
                                      <DeployForm
                                        device={device}
                                        networks={networks ?? []}
                                        isPending={deployMutation.isPending}
                                        onSubmit={(form: any) => deployMutation.mutate({ id: device.id, form })}
                                        onCancel={() => setDeployingId(null)}
                                      />
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {all.length === 0 && (
        <div className="text-center py-16 text-white/30">
          <Package size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No stock or undeployed devices</p>
        </div>
      )}
    </div>
  )
}
