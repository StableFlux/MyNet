import { create } from 'zustand'

interface ScanHost {
  ip: string
  hostname: string | null
  mac: string | null
  manufacturer: string | null
  network_id: number | null
  network_name: string | null
  vlan_id: number | null
  known: boolean
  dhcp_lease: boolean
  device_id?: number
  device_name?: string
  nic_label?: string
  role?: string
}

interface ScanResult {
  hosts: ScanHost[]
  total: number
  unknown: number
}

interface NetworkScanState {
  result: ScanResult | null
  selectedIds: Set<number>
  filter: 'all' | 'unknown' | 'known' | 'dhcp'
  setResult: (result: ScanResult | null) => void
  setSelectedIds: (ids: Set<number>) => void
  setFilter: (filter: 'all' | 'unknown' | 'known' | 'dhcp') => void
  clearResult: () => void
}

export const useNetworkScanStore = create<NetworkScanState>((set) => ({
  result: null,
  selectedIds: new Set(),
  filter: 'all',
  setResult: (result) => set({ result }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  setFilter: (filter) => set({ filter }),
  clearResult: () => set({ result: null }),
}))
