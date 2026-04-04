import { useState, useCallback } from 'react'

export type CardId =
  | 'nics'
  | 'switch-ports'
  | 'vm-guests'
  | 'notes'
  | 'hardware'
  | 'software'
  | 'services'

export interface CardLayout {
  id: CardId
  colSpan: 1 | 2   // 2 = full-width row above the two columns
  column: 0 | 1     // which column (ignored when colSpan=2)
}

export type LayoutProfile = 'general' | 'switch'

const DEFAULTS: Record<LayoutProfile, CardLayout[]> = {
  general: [
    { id: 'nics',           colSpan: 1, column: 0 },
    { id: 'hardware',       colSpan: 1, column: 1 },
    { id: 'software',       colSpan: 1, column: 1 },
    { id: 'services',       colSpan: 1, column: 1 },
    { id: 'vm-guests',      colSpan: 1, column: 1 },
    { id: 'notes',          colSpan: 1, column: 1 },
  ],
  switch: [
    { id: 'nics',           colSpan: 1, column: 0 },
    { id: 'switch-ports',   colSpan: 1, column: 0 },
    { id: 'hardware',       colSpan: 1, column: 1 },
    { id: 'software',       colSpan: 1, column: 1 },
    { id: 'services',       colSpan: 1, column: 1 },
    { id: 'vm-guests',      colSpan: 1, column: 1 },
    { id: 'notes',          colSpan: 1, column: 1 },
  ],
}

// v11: services card added to both profiles
const STORAGE_KEY = 'device-detail-layout-v11'

function loadLayouts(): Partial<Record<LayoutProfile, CardLayout[]>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function useDeviceLayout(profile: LayoutProfile) {
  const [layouts, setLayouts] = useState<Partial<Record<LayoutProfile, CardLayout[]>>>(loadLayouts)
  const layout = layouts[profile] ?? DEFAULTS[profile]

  const save = useCallback((updated: CardLayout[], prof = profile) => {
    setLayouts(prev => {
      const next = { ...prev, [prof]: updated }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [profile])

  /** Reorder within the same zone (wide / col-0 / col-1). */
  const reorderInZone = useCallback((activeId: CardId, overId: CardId) => {
    setLayouts(prev => {
      const current = prev[profile] ?? DEFAULTS[profile]
      const ai = current.findIndex(c => c.id === activeId)
      const oi = current.findIndex(c => c.id === overId)
      if (ai === -1 || oi === -1 || ai === oi) return prev
      const result = [...current]
      const [item] = result.splice(ai, 1)
      result.splice(oi, 0, item)
      const next = { ...prev, [profile]: result }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [profile])

  /** Toggle a card between full-width (colSpan 2) and its column (colSpan 1). */
  const toggleColSpan = useCallback((id: CardId) => {
    setLayouts(prev => {
      const current = prev[profile] ?? DEFAULTS[profile]
      const next = {
        ...prev,
        [profile]: current.map(c =>
          c.id === id ? { ...c, colSpan: (c.colSpan === 2 ? 1 : 2) as 1 | 2 } : c
        ),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [profile])

  /** Move a narrow card to the other column. */
  const swapColumn = useCallback((id: CardId) => {
    setLayouts(prev => {
      const current = prev[profile] ?? DEFAULTS[profile]
      const next = {
        ...prev,
        [profile]: current.map(c =>
          c.id === id ? { ...c, column: (c.column === 0 ? 1 : 0) as 0 | 1 } : c
        ),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [profile])

  const resetLayout = useCallback(() => {
    setLayouts(prev => {
      const next = { ...prev, [profile]: DEFAULTS[profile] }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [profile])

  return { layout, reorderInZone, toggleColSpan, swapColumn, resetLayout }
}
