import { create } from 'zustand'

interface SubnetMapState {
  selectedNetworkId: number | null
  showFree: boolean
  showDhcp: boolean
  setSelectedNetworkId: (id: number | null) => void
  setShowFree: (v: boolean) => void
  setShowDhcp: (v: boolean) => void
}

export const useSubnetMapStore = create<SubnetMapState>((set) => ({
  selectedNetworkId: null,
  showFree: false,
  showDhcp: false,
  setSelectedNetworkId: (id) => set({ selectedNetworkId: id }),
  setShowFree: (v) => set({ showFree: v }),
  setShowDhcp: (v) => set({ showDhcp: v }),
}))
