import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

// Fallback defaults mirror the backend defaults
export const DEFAULT_LOCATION_TYPE_COLORS: Record<string, string> = {
  Room:      '#a5b4fc',
  Area:      '#6ee7b7',
  Premises:  '#c4b5fd',
  Building:  '#7dd3fc',
  Draw:      '#fcd34d',
  Container: '#fdba74',
  Storage:   '#cbd5e1',
  Shelf:     '#67e8f9',
  Rack:      '#fda4af',
}

export const DEFAULT_DEVICE_STATUS_COLORS: Record<string, string> = {
  in_service:     '#10b981',
  stock:          '#6366f1',
  undeployed:     '#fcd34d',
  decommissioned: '#6b7280',
}

export const DEFAULT_DEVICE_CATEGORY_COLORS: Record<string, string> = {
  'IoT':              '#f97316',
  'Security':         '#fb7185',
  'Power':            '#eab308',
  'Network':          '#38bdf8',
  'Servers & VMs':    '#3b82f6',
  'User Devices':     '#22c55e',
  'Entertainment':    '#16a34a',
  'Peripherals':      '#a78bfa',
  'Maker & Projects': '#4ade80',
}

export const DEVICE_CATEGORIES = [
  'User Devices',
  'Entertainment',
  'Peripherals',
  'Network',
  'Servers & VMs',
  'Security',
  'IoT',
  'Power',
  'Maker & Projects',
] as const

// Cycling fallback for user-created categories not in the defaults
const CATEGORY_FALLBACK = [
  '#a5b4fc', '#6ee7b7', '#7dd3fc', '#fda4af',
  '#fcd34d', '#c4b5fd', '#67e8f9', '#fdba74',
]

export function categoryFallbackColor(category: string): string {
  if (DEFAULT_DEVICE_CATEGORY_COLORS[category]) return DEFAULT_DEVICE_CATEGORY_COLORS[category]
  let hash = 0
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0
  return CATEGORY_FALLBACK[hash % CATEGORY_FALLBACK.length]
}

export interface ColorSettings {
  locationTypeColors: Record<string, string>
  deviceCategoryColors: Record<string, string>
  deviceStatusColors: Record<string, string>
  /** Resolve location type → hex, with fallback */
  locationColor: (type: string | null | undefined) => string
  /** Resolve category → hex, with cycling fallback for unknown categories */
  categoryColor: (category: string) => string
  /** Resolve status → hex */
  statusColor: (status: string) => string
}

export function useColorSettings(): ColorSettings {
  // Shares cache with the Settings page — no extra network request
  const { data } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })

  const locationTypeColors: Record<string, string> = data?.location_type_colors ?? DEFAULT_LOCATION_TYPE_COLORS
  const deviceCategoryColors: Record<string, string> = data?.device_category_colors ?? DEFAULT_DEVICE_CATEGORY_COLORS
  const deviceStatusColors: Record<string, string> = data?.device_status_colors ?? DEFAULT_DEVICE_STATUS_COLORS

  return {
    locationTypeColors,
    deviceCategoryColors,
    deviceStatusColors,
    locationColor: (type) => {
      if (!type) return 'rgba(255,255,255,0.35)'
      return locationTypeColors[type] ?? DEFAULT_LOCATION_TYPE_COLORS[type] ?? 'rgba(255,255,255,0.35)'
    },
    categoryColor: (category) =>
      deviceCategoryColors[category] ?? categoryFallbackColor(category),
    statusColor: (status) =>
      deviceStatusColors[status] ?? DEFAULT_DEVICE_STATUS_COLORS[status] ?? '#6b7280',
  }
}

/** Standalone mutation hook — call to save any subset of colour maps */
export function useUpdateColorSettings() {
  const qc = useQueryClient()
  const save = async (patch: {
    location_type_colors?: Record<string, string>
    device_category_colors?: Record<string, string>
    device_status_colors?: Record<string, string>
  }) => {
    const { data } = await api.patch('/system-settings', patch)
    qc.setQueryData(['system-settings'], (old: any) => ({ ...old, ...data }))
    return data
  }
  return save
}
