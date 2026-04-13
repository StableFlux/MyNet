import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Plus, X, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Search, CheckSquare, Square, LayoutGrid, List, AlignJustify, Copy, Check, MapPin } from 'lucide-react'
import { DeviceCard } from '../../components/DeviceCard'
import { HARDWARE_TYPE_CATEGORY, LOCATION_TYPE_ICON, NIC_TYPE_ICON, STATUS_ICON } from '../../components/DeviceTypeIcon'
import { useSearch } from '../../hooks/useSearch'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'
import { useColorSettings } from '../../hooks/useColorSettings'

const CARD_GRID = 'grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
const LIST_COLS = '1fr 10rem 10rem 49.5rem 8.75rem'

/** Derive opacity variants of a stored hex color for group headers */
function groupColors(hex: string) {
  return {
    cat:   hex + 'a6', // ~65% — text
    sub:   hex + '59', // ~35% — sub text
    rule:  hex + '1f', // ~12% — rule line
    catBg: hex + '12', // ~7%  — category bg
    subBg: hex + '0a', // ~4%  — sub-type bg
  }
}

export default function DeviceList() {
  const navigate = useNavigate()
  const colors = useColorSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthStore()

  const [networkId, setNetworkId] = useState<number | undefined>(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    const s = saved ? JSON.parse(saved) : {}
    const v = searchParams.get('network') ?? s.network
    return v ? Number(v) : undefined
  })
  const [filterCategory, setFilterCategory] = useState(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    const s = saved ? JSON.parse(saved) : {}
    return searchParams.get('cat') ?? s.cat ?? ''
  })
  const [deviceTypeId, setDeviceTypeId] = useState<number | undefined>(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    const s = saved ? JSON.parse(saved) : {}
    const v = searchParams.get('type') ?? s.type
    return v ? Number(v) : undefined
  })
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    if (!saved) return 'grid'
    const s = JSON.parse(saved)
    return s.viewMode === 'list' ? 'list' : 'grid'
  })
  const [grouped, setGrouped] = useState<boolean>(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    if (!saved) return false
    const s = JSON.parse(saved)
    if (s.viewMode === 'grouped') return true // migrate old 'grouped' viewMode
    return s.grouped ?? false
  })
  const [includeStatuses, setIncludeStatuses] = useState<Set<string>>(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    const arr = saved ? (JSON.parse(saved).includeStatuses ?? ['in_service']) : ['in_service']
    return new Set(arr)
  })
  const [locationFilter, setLocationFilter] = useState(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    const s = saved ? JSON.parse(saved) : {}
    return searchParams.get('loc') ?? s.loc ?? ''
  })
  const [locDropOpen, setLocDropOpen] = useState(false)
  const locDropRef = useRef<HTMLDivElement>(null)
  const [keyword, setKeyword] = useState(() => {
    const saved = sessionStorage.getItem('devicelist-filters')
    return saved ? (JSON.parse(saved).keyword ?? '') : ''
  })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(sessionStorage.getItem('devicelist-collapsed') ?? '{}') } catch { return {} }
  })
  const [expandedNics, setExpandedNics] = useState<Set<number>>(new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyToClipboard = (text: string, key: string) => {
    const fallback = () => {
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback)
    } else {
      fallback()
    }
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  // Sync filters → URL params + sessionStorage
  useEffect(() => {
    const p: Record<string, string> = {}
    if (networkId) p.network = String(networkId)
    if (filterCategory) p.cat = filterCategory
    if (deviceTypeId) p.type = String(deviceTypeId)
    if (locationFilter) p.loc = locationFilter
    setSearchParams(p, { replace: true })
    sessionStorage.setItem('devicelist-filters', JSON.stringify({
      network: networkId, cat: filterCategory, type: deviceTypeId, loc: locationFilter,
      includeStatuses: Array.from(includeStatuses), viewMode, grouped, keyword,
    }))
  }, [networkId, filterCategory, deviceTypeId, locationFilter, includeStatuses, viewMode, grouped, keyword])

  // Persist collapsed state
  useEffect(() => {
    sessionStorage.setItem('devicelist-collapsed', JSON.stringify(collapsed))
  }, [collapsed])

  const { data: searchData, isLoading } = useSearch(keyword, {
    network_id: networkId,
    device_type_id: deviceTypeId,
    device_type_category: (!deviceTypeId && filterCategory) ? filterCategory : undefined,
    exclude_in_service: !includeStatuses.has('in_service'),
    exclude_stock: !includeStatuses.has('stock'),
    exclude_undeployed: !includeStatuses.has('undeployed'),
    exclude_decommissioned: !includeStatuses.has('decommissioned'),
  })

  const { data: networks } = useQuery({
    queryKey: ['networks'],
    queryFn: async () => { const { data } = await api.get('/networks'); return data },
  })

  const { data: deviceTypes } = useQuery({
    queryKey: ['device-types'],
    queryFn: async () => { const { data } = await api.get('/device-types'); return data },
  })

  const { data: locations = [] } = useQuery<{ id: number; name: string; type: string | null; parent_id: number | null }[]>({
    queryKey: ['locations', 'flat'],
    queryFn: async () => { const { data } = await api.get('/locations?flat=true'); return data },
  })

  // Shared batch monitoring query — same key as Monitoring page so the cache is reused.
  // Replaces the N individual /monitoring/device/{id} calls that DeviceCard used to make.
  const { data: monitoringDevices = [] } = useQuery({
    queryKey: ['monitoring', 'devices'],
    queryFn: async () => { const { data } = await api.get('/monitoring/devices'); return data },
    refetchInterval: 60_000,
  })

  const monitoringByDevice = useMemo(() => {
    const map = new Map<number, Record<string, boolean>>()
    for (const d of monitoringDevices) {
      const nicMap: Record<string, boolean> = {}
      for (const n of d.nics ?? []) {
        nicMap[n.ip] = n.status === 'up'
      }
      map.set(d.device_id, nicMap)
    }
    return map
  }, [monitoringDevices])

  const locationTypeMap = useMemo(() =>
    Object.fromEntries(locations.map(l => [l.name, l.type])),
    [locations]
  )

  // Close location dropdown on outside click
  useEffect(() => {
    if (!locDropOpen) return
    const handle = (e: MouseEvent) => {
      if (locDropRef.current && !locDropRef.current.contains(e.target as Node))
        setLocDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [locDropOpen])

  const allSearchResults: any[] = searchData?.results ?? []

  // name → id map for storage_location matching (storage_location has no FK)
  const locNameToId = useMemo(() =>
    Object.fromEntries(locations.map(l => [l.name, l.id])),
    [locations]
  )

  // Which location IDs appear in the current filtered results
  const activeLocationIds = useMemo(() => {
    const ids = new Set<number>()
    for (const d of allSearchResults) {
      if (d.location_id) ids.add(d.location_id)
      // storage_location has no FK — resolve via name map
      if (d.storage_location && locNameToId[d.storage_location])
        ids.add(locNameToId[d.storage_location])
    }
    return ids
  }, [allSearchResults, locNameToId])

  // Build a pruned tree: only nodes where self or any descendant is active
  const locationTree = useMemo(() => {
    const byId: Record<number, any> = {}
    for (const l of locations) byId[l.id] = { ...l, children: [] }
    const roots: any[] = []
    for (const node of Object.values(byId)) {
      node.parent_id && byId[node.parent_id] ? byId[node.parent_id].children.push(node) : roots.push(node)
    }
    const sort = (nodes: any[]) => { nodes.sort((a, b) => a.name.localeCompare(b.name)); nodes.forEach(n => sort(n.children)) }
    sort(roots)
    const hasActive = (n: any): boolean => activeLocationIds.has(n.id) || n.children.some(hasActive)
    const prune = (nodes: any[]): any[] =>
      nodes.filter(hasActive).map(n => ({ ...n, children: prune(n.children) }))
    return prune(roots)
  }, [locations, activeLocationIds])

  const flatLocTree = useMemo(() => {
    const flatten = (nodes: any[], depth = 0): { id: number; name: string; depth: number }[] =>
      nodes.flatMap(n => [{ id: n.id, name: n.name, depth }, ...flatten(n.children, depth + 1)])
    return flatten(locationTree)
  }, [locationTree])
  const selectedLocId = locationFilter && locationFilter !== '__none__' ? Number(locationFilter) : null

  // All IDs in the selected location subtree (selected + all descendants)
  const selectedLocIds = useMemo(() => {
    if (!selectedLocId) return null
    const ids = new Set<number>()
    const collect = (id: number) => {
      ids.add(id)
      locations.filter(l => l.parent_id === id).forEach(l => collect(l.id))
    }
    collect(selectedLocId)
    return ids
  }, [selectedLocId, locations])

  const devices = locationFilter === '__none__'
    ? allSearchResults.filter((d: any) => !d.location && !d.storage_location)
    : selectedLocIds
      ? allSearchResults.filter((d: any) =>
          (d.location_id && selectedLocIds.has(d.location_id)) ||
          (d.storage_location && locNameToId[d.storage_location] && selectedLocIds.has(locNameToId[d.storage_location]))
        )
      : allSearchResults
  const hasFilters = keyword || networkId || filterCategory || deviceTypeId || locationFilter

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      const el = document.getElementById('main-scroll')
      if (el) sessionStorage.setItem('devicelist-scroll', String(el.scrollTop))
    }
  }, [])

  // Restore scroll position after data loads
  const scrollRestored = useRef(false)
  useEffect(() => {
    if (!scrollRestored.current && devices.length > 0) {
      const saved = sessionStorage.getItem('devicelist-scroll')
      const el = document.getElementById('main-scroll')
      if (saved && el) el.scrollTop = Number(saved)
      scrollRestored.current = true
    }
  }, [devices])

  // Two-level grouping: category → sub-type → devices
  const groups = useMemo(() => {
    const catMap = new Map<string, Map<string, any[]>>()
    for (const d of devices) {
      const cat = d.device_type_category ?? HARDWARE_TYPE_CATEGORY[(d as any).hardware_type] ?? 'Other'
      const sub = d.device_type ?? (d as any).hardware_type ?? 'Unknown'
      if (!catMap.has(cat)) catMap.set(cat, new Map())
      const subMap = catMap.get(cat)!
      if (!subMap.has(sub)) subMap.set(sub, [])
      subMap.get(sub)!.push(d)
    }
    return Array.from(catMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cat, subMap]) => ({
        cat,
        total: Array.from(subMap.values()).reduce((n, arr) => n + arr.length, 0),
        subs: Array.from(subMap.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      }))
  }, [devices])

  const allCollapsed = groups.length > 0 && groups.every(({ cat, subs }) =>
    collapsed[cat] || subs.every(([sub]) => collapsed[`${cat}::${sub}`])
  )
  const anyCollapsed = groups.some(({ cat, subs }) =>
    collapsed[cat] || subs.some(([sub]) => collapsed[`${cat}::${sub}`])
  )

  const collapseAll = () => {
    const next: Record<string, boolean> = {}
    for (const { cat, subs } of groups) {
      next[cat] = true
      for (const [sub] of subs) next[`${cat}::${sub}`] = true
    }
    setCollapsed(next)
  }

  const expandAll = () => setCollapsed({})

  const toggleStatus = (key: string) => {
    setIncludeStatuses(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }

  const clearFilters = () => {
    setKeyword('')
    setNetworkId(undefined)
    setFilterCategory('')
    setDeviceTypeId(undefined)
    setLocationFilter('')
    setIncludeStatuses(new Set(['in_service']))
    sessionStorage.removeItem('devicelist-filters')
    sessionStorage.removeItem('devicelist-collapsed')
  }

  const statusLabels: Record<string, string> = {
    in_service: 'In Service',
    stock: 'Stock',
    undeployed: 'Undeployed',
    decommissioned: 'Decomm.',
  }

  const renderNic = (device: any, nic: any, globalIdx: number) => {
    const ip = nic.address_type === 'dhcp' ? 'DHCP' : (nic.ip_address || '—')
    const ipKey = `ip-${device.id}-${nic.id ?? globalIdx}`
    const macKey = `mac-${device.id}-${nic.id ?? globalIdx}`
    const NicIcon = NIC_TYPE_ICON[(nic.nic_type ?? '').toUpperCase()] ?? NIC_TYPE_ICON.ETH
    return (
      <>
        <span className="w-5 flex-shrink-0 flex flex-col items-center justify-center text-white/20 mr-1 gap-0.5">
          <NicIcon size={14} />
          {nic.is_active === false && <span className="text-[7px] font-medium text-white/30 uppercase tracking-wide leading-none">off</span>}
        </span>
        <span className="w-[4.5rem] flex-shrink-0 flex items-center">
          {(nic.network_name || nic.vlan_id) && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-full"
              style={{
                backgroundColor: nic.network_color ? nic.network_color + '22' : 'var(--inline-subtle-bg)',
                border: `1px solid ${nic.network_color ? nic.network_color + '55' : 'var(--inline-subtle-border)'}`,
                color: nic.network_color || 'var(--inline-subtle-text)',
              }}>
              {nic.vlan_id ? `VLAN ${nic.vlan_id}` : nic.network_name}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (ip !== '—') copyToClipboard(ip, ipKey) }}
          className={`flex items-center gap-[2px] px-1 py-0.5 rounded transition-colors flex-shrink-0 mr-2 group/ip ${ip !== '—' ? 'hover:bg-white/[0.06] cursor-pointer' : 'invisible cursor-default'}`}>
          <span className="text-[11px] font-mono text-white/55 w-[6.5rem] text-left">{ip}</span>
          <span className="w-3 flex-shrink-0 flex items-center justify-center">
            {copiedKey === ipKey
              ? <Check size={11} className="text-emerald-400" />
              : <Copy size={11} className="text-white/20 group-hover/ip:text-white/50" />}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (nic.mac) copyToClipboard(nic.mac, macKey) }}
          className={`flex items-center gap-[2px] px-1 py-0.5 rounded transition-colors flex-shrink-0 group/mac ${nic.mac ? 'hover:bg-white/[0.06] cursor-pointer' : 'invisible cursor-default'}`}>
          <span className="text-[11px] font-mono text-white/25 w-[7rem] text-left truncate">{nic.mac || ''}</span>
          <span className="w-3 flex-shrink-0 flex items-center justify-center">
            {nic.mac && (copiedKey === macKey
              ? <Check size={11} className="text-emerald-400" />
              : <Copy size={11} className="text-white/20 group-hover/mac:text-white/50" />)}
          </span>
        </button>
      </>
    )
  }

  const renderListRow = (device: any) => {
    const nics: any[] = device.nics ?? []
    const visibleNics = nics.slice(0, 2)
    const overflowNics = nics.slice(2)
    const isExpanded = expandedNics.has(device.id)
    const locName = (device.status === 'stock' || device.status === 'undeployed')
      ? (device.storage_location ?? '—')
      : (device.location ?? '—')
    const locType = locName !== '—' ? locationTypeMap[locName] : null
    const locColor = colors.locationColor(locType)
    return (
      <div key={device.id}>
        <button type="button"
          onClick={() => navigate(`/devices/${device.id}`)}
          className="w-full grid gap-3 px-3 py-2.5 items-start hover:bg-white/[0.03] transition-colors text-left group"
          style={{ gridTemplateColumns: LIST_COLS }}>
          {/* Name + status dot */}
          <span className="flex items-center gap-2 min-w-0 truncate pt-0.5">
            {(() => { const I = STATUS_ICON[device.status]; return I ? <I size={13} aria-label={statusLabels[device.status] ?? device.status} className="flex-shrink-0" style={{ color: colors.statusColor(device.status) }} /> : null })()}
            <span className="text-[13px] font-medium text-white/80 group-hover:text-white transition-colors truncate">{device.name}</span>
          </span>
          {/* Type */}
          <span className="text-[10px] text-white/40 truncate pt-0.5">
            {device.device_type ?? device.hardware_type ?? '—'}
          </span>
          {/* Brand / Model */}
          <span className="text-[10px] text-white/40 truncate pt-0.5">
            {[device.brand, device.model].filter(Boolean).join(' ') || '—'}
          </span>
          {/* NICs */}
          <span className="flex flex-col gap-3 min-w-0">
            <span className="flex items-center min-w-0">
              <span className="flex items-center overflow-hidden min-w-0">
                {nics.length === 0
                  ? <span className="text-[10px] text-white/20">—</span>
                  : visibleNics.map((nic: any, idx: number) => (
                      <span key={nic.id ?? idx} className={`flex items-center flex-shrink-0 transition-opacity${nic.is_active === false ? ' opacity-50' : ''}`}>
                        {idx > 0 && <span className="flex-shrink-0 w-px h-3.5 bg-white/15 mx-3" />}
                        {renderNic(device, nic, idx)}
                      </span>
                    ))
                }
              </span>
              {overflowNics.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedNics(prev => {
                      const next = new Set(prev)
                      isExpanded ? next.delete(device.id) : next.add(device.id)
                      return next
                    })
                  }}
                  className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-white/40 hover:text-white/70 hover:bg-white/[0.1] transition-colors flex-shrink-0">
                  {isExpanded ? '−' : `+${overflowNics.length}`}
                </button>
              )}
            </span>
            {isExpanded && overflowNics.map((nic: any, idx: number) => (
              <div key={nic.id ?? idx} className={`flex items-center transition-opacity${nic.is_active === false ? ' opacity-50' : ''}`}>
                {renderNic(device, nic, idx + 2)}
              </div>
            ))}
          </span>
          {/* Location */}
          <span className="flex items-center gap-1 truncate pt-0.5" style={{ color: locColor }}>
            {locName !== '—' && (() => { const I = LOCATION_TYPE_ICON[locType ?? ''] ?? MapPin; return <I size={11} className="flex-shrink-0 opacity-70" /> })()}
            <span className="truncate text-xs">{locName}</span>
          </span>
        </button>
      </div>
    )
  }

  const listColumnHeader = (
    <div className="grid gap-3 px-3 py-2 bg-white/[0.03] border-b border-white/[0.06] text-[10px] font-semibold text-white/30 uppercase tracking-wider"
      style={{ gridTemplateColumns: LIST_COLS }}>
      <span>Name</span>
      <span>Type</span>
      <span>Brand / Model</span>
      <span>NICs</span>
      <span>Location</span>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Devices</h1>
          <p className="text-sm text-white/40 mt-0.5">{searchData?.count ?? 0} devices</p>
        </div>
        {(user?.role === 'admin' || user?.role === 'editor') && (
          <button type="button" onClick={() => navigate('/devices/new')} className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Add Device
          </button>
        )}
      </div>

      {/* Status filters + view mode */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {([
            { key: 'in_service',     label: 'In Service'     },
            { key: 'stock',          label: 'Stock'          },
            { key: 'undeployed',     label: 'Undeployed'     },
            { key: 'decommissioned', label: 'Decommissioned', shortLabel: 'Decom' },
          ] as const).map(({ key, label, shortLabel }: { key: string; label: string; shortLabel?: string }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <button type="button" onClick={() => toggleStatus(key as any)}
                className={includeStatuses.has(key as any) ? 'text-indigo-400' : 'text-white/25'}>
                {includeStatuses.has(key as any) ? <CheckSquare size={14} /> : <Square size={14} />}
              </button>
              <span className="text-sm text-white/60">
                {shortLabel && <span className="sm:hidden">{shortLabel}</span>}
                <span className={shortLabel ? 'hidden sm:inline' : ''}>{label}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-4 border-l border-white/10 pl-4">
          {([
            { value: 'grid' as const, icon: LayoutGrid,   label: 'Grid' },
            { value: 'list' as const, icon: AlignJustify, label: 'List' },
          ]).map(({ value, icon: Icon, label }) => (
            <label key={value} className="flex items-center gap-2 cursor-pointer select-none">
              <button type="button" onClick={() => setViewMode(value)}
                className={viewMode === value ? 'text-indigo-400' : 'text-white/25'}>
                <Icon size={14} />
              </button>
              <span className="text-sm text-white/60">{label}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button type="button" onClick={() => setGrouped(g => !g)}
              className={grouped ? 'text-indigo-400' : 'text-white/25'}>
              <List size={14} />
            </button>
            <span className="text-sm text-white/60">Grouped</span>
          </label>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Dropdowns — 2-col grid on mobile, inline on desktop */}
        <div className="grid grid-cols-2 gap-2 sm:contents">
        <select aria-label="Filter by network" value={networkId ?? ''}
          onChange={(e) => setNetworkId(e.target.value ? Number(e.target.value) : undefined)}
          className="glass-input text-sm w-full sm:w-60">
          <option value="" className="bg-surface-overlay">All networks</option>
          {(networks ?? []).map((n: any) => (
            <option key={n.id} value={n.id} className="bg-surface-overlay">
              {n.vlan_id ? `VLAN ${n.vlan_id} ` : ''}{n.name}
            </option>
          ))}
        </select>

        <div ref={locDropRef} className="relative w-full sm:w-[16.5rem]">
          <button type="button" onClick={() => setLocDropOpen(o => !o)}
            className="glass-input text-sm w-full flex items-center justify-between gap-2 text-left cursor-pointer">
            <span className="truncate text-white">
              {locationFilter === '__none__' ? '— No location'
                : selectedLocId ? (locations.find(l => l.id === selectedLocId)?.name ?? 'Location')
                : 'All locations'}
            </span>
            <ChevronDown size={13} className={`flex-shrink-0 text-white/30 transition-transform ${locDropOpen ? 'rotate-180' : ''}`} />
          </button>
          {locDropOpen && (
            <div className="absolute z-30 top-full mt-1 left-0 w-full sm:w-[16.5rem] glass-card rounded-lg border border-white/[0.08] shadow-xl overflow-y-auto max-h-72 py-1">
              {[
                { value: '', label: 'All locations', depth: 0 },
                ...(allSearchResults.some((d: any) => !d.location && !d.storage_location) ? [{ value: '__none__', label: '— No location', depth: 0 }] : []),
                ...flatLocTree.map(({ id, name, depth }) => ({ value: String(id), label: name, depth })),
              ].map(({ value, label, depth }) => (
                <button key={value} type="button"
                  onClick={() => { setLocationFilter(value); setLocDropOpen(false) }}
                  className={`w-full text-left text-sm py-1.5 pr-3 transition-colors ${locationFilter === value ? 'text-white bg-white/[0.06]' : 'text-white/55 hover:text-white/80 hover:bg-white/[0.04]'}`}
                  style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
                  {depth > 0 && <span className="text-white/20 mr-1.5">{'›'}</span>}
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <select
          aria-label="Filter by category"
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setDeviceTypeId(undefined) }}
          className="glass-input text-sm w-full sm:w-60"
        >
          <option value="" className="bg-surface-overlay">All categories</option>
          {Array.from(new Set<string>((deviceTypes ?? []).map((dt: any) => dt.category ?? 'Other'))).sort().map((cat) => (
            <option key={cat} value={cat} className="bg-surface-overlay">{cat}</option>
          ))}
        </select>

        {filterCategory && (
          <select
            aria-label="Filter by sub-type"
            value={deviceTypeId ?? ''}
            onChange={(e) => setDeviceTypeId(e.target.value ? Number(e.target.value) : undefined)}
            className="glass-input text-sm w-full sm:w-60"
          >
            <option value="" className="bg-surface-overlay">All sub-types</option>
            {(deviceTypes ?? [])
              .filter((dt: any) => (dt.category ?? 'Other') === filterCategory)
              .sort((a: any, b: any) => a.name.localeCompare(b.name))
              .map((dt: any) => (
                <option key={dt.id} value={dt.id} className="bg-surface-overlay">{dt.name}</option>
              ))}
          </select>
        )}
        </div>{/* end dropdowns grid */}

        {/* Search — full width on mobile, fixed width on desktop */}
        <div className="relative w-full sm:w-80 sm:order-first">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            type="search"
            placeholder="Search devices…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="glass-input text-sm pl-7 w-full"
          />
        </div>

        {hasFilters && (
          <button type="button" onClick={clearFilters} className="btn-ghost flex items-center gap-1 text-sm">
            <X size={13} /> Clear
          </button>
        )}

        {grouped && (
          <div className="ml-auto flex items-center gap-1">
            {anyCollapsed && (
              <button type="button" onClick={expandAll}
                className="btn-ghost flex items-center gap-1.5 text-xs text-white/40">
                <ChevronsUpDown size={12} /> Expand all
              </button>
            )}
            {!allCollapsed && (
              <button type="button" onClick={collapseAll}
                className="btn-ghost flex items-center gap-1.5 text-xs text-white/40">
                <ChevronsDownUp size={12} /> Collapse all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className={CARD_GRID}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="glass-card p-3 h-24 animate-pulse" />
          ))}
        </div>
      ) : devices.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-sm">No devices found</p>
        </div>
      ) : grouped ? (
        /* Grouped view — works for both grid and list */
        viewMode === 'list' ? (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="overflow-x-auto">
              {listColumnHeader}
              {groups.map(({ cat, total, subs }, groupIdx) => {
                const catCollapsed = collapsed[cat]
                const gc = groupColors(colors.categoryColor(cat))
                return (
                  <div key={cat} className={groupIdx > 0 ? 'border-t-2 border-white/[0.07]' : ''}>
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                      className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] group"
                      style={{ backgroundColor: gc.catBg }}
                    >
                      <span className="text-[10px] uppercase tracking-widest font-bold transition-colors" style={{ color: gc.cat }}>{cat}</span>
                      <span className="text-[10px] text-white/30 bg-white/[0.07] px-1.5 py-0.5 rounded-full">{total}</span>
                      <span className="flex-1" />
                      {catCollapsed
                        ? <ChevronRight size={13} className="text-white/30 group-hover:text-white/50 transition-colors" />
                        : <ChevronDown size={13} className="text-white/30 group-hover:text-white/50 transition-colors" />}
                    </button>
                    {!catCollapsed && subs.map(([sub, subDevices]) => {
                      const subKey = `${cat}::${sub}`
                      const subCollapsed = collapsed[subKey]
                      return (
                        <div key={sub}>
                          <button
                            type="button"
                            onClick={() => setCollapsed((c) => ({ ...c, [subKey]: !c[subKey] }))}
                            className="w-full flex items-center gap-2 pl-8 pr-3 py-2 border-b border-white/[0.04] group"
                            style={{ backgroundColor: gc.subBg }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: gc.sub }} />
                            <span className="text-[11px] font-semibold transition-colors" style={{ color: gc.sub }}>{sub}</span>
                            <span className="text-[10px] text-white/20 bg-white/5 px-1.5 py-0.5 rounded-full">{subDevices.length}</span>
                            <span className="flex-1" />
                            {subCollapsed
                              ? <ChevronRight size={11} className="text-white/25 group-hover:text-white/45 transition-colors" />
                              : <ChevronDown size={11} className="text-white/25 group-hover:text-white/45 transition-colors" />}
                          </button>
                          {!subCollapsed && (
                            <div className="divide-y divide-white/[0.04]">
                              {subDevices.map(renderListRow)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(({ cat, total, subs }) => {
              const catCollapsed = collapsed[cat]
              const gc = groupColors(colors.categoryColor(cat))
              return (
                <div key={cat}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                    className="w-full flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-lg -mx-2.5 group transition-colors"
                    style={{ backgroundColor: gc.catBg }}
                  >
                    <span className="text-[11px] uppercase tracking-widest font-bold transition-colors" style={{ color: gc.cat }}>{cat}</span>
                    <span className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded-full">{total}</span>
                    <span className="flex-1 h-px" style={{ backgroundColor: gc.rule }} />
                    {catCollapsed
                      ? <ChevronRight size={14} className="text-white/30 group-hover:text-white/50 transition-colors" />
                      : <ChevronDown size={14} className="text-white/30 group-hover:text-white/50 transition-colors" />}
                  </button>
                  {!catCollapsed && (
                    <div className="space-y-4 ml-3">
                      {subs.map(([sub, subDevices]) => {
                        const subKey = `${cat}::${sub}`
                        const subCollapsed = collapsed[subKey]
                        return (
                          <div key={sub}>
                            <button
                              type="button"
                              onClick={() => setCollapsed((c) => ({ ...c, [subKey]: !c[subKey] }))}
                              className="w-full flex items-center gap-2 mb-2 px-2 py-1 rounded -mx-2 group transition-colors"
                              style={{ backgroundColor: gc.subBg }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: gc.sub }} />
                              <span className="text-xs font-semibold transition-colors" style={{ color: gc.sub }}>{sub}</span>
                              <span className="text-[10px] text-white/25 bg-white/5 px-1.5 py-0.5 rounded-full">{subDevices.length}</span>
                              <span className="flex-1 h-px" style={{ backgroundColor: gc.rule }} />
                              {subCollapsed
                                ? <ChevronRight size={12} className="text-white/25 group-hover:text-white/40 transition-colors" />
                                : <ChevronDown size={12} className="text-white/25 group-hover:text-white/40 transition-colors" />}
                            </button>
                            {!subCollapsed && (
                              <div className={CARD_GRID}>
                                {subDevices.map((device: any) => (
                                  <DeviceCard key={device.id} device={device} nicOnlineMap={monitoringByDevice.get(device.id)} />
                                ))}
                              </div>
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
        )
      ) : viewMode === 'list' ? (
        /* Flat list */
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="overflow-x-auto">
            {listColumnHeader}
            <div className="divide-y divide-white/[0.04]">
              {devices.map(renderListRow)}
            </div>
          </div>
        </div>
      ) : (
        /* Flat grid */
        <div className={CARD_GRID}>
          {devices.map((device: any) => (
            <DeviceCard key={device.id} device={device} nicOnlineMap={monitoringByDevice.get(device.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
