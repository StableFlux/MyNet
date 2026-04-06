import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SwitchDiagram } from '../components/SwitchDiagram'
import { useColorSettings } from '../hooks/useColorSettings'
import api from '../lib/api'

const STORAGE_KEY = 'switches-order-v1'

function loadOrder(): number[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

function SortableSwitch({ device, wanColor, wanConfigs }: { device: any; wanColor: string; wanConfigs: any[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: device.id })
  const deviceWanConfigs = wanConfigs.filter((wc) => wc.device_id === device.id)
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: CSS.Transform.toString({ ...transform, scaleX: 1, scaleY: 1 }), transition } : {}}
      className={isDragging ? 'opacity-40' : ''}
    >
      {/* Drag handle — thin bar above the chassis */}
      <div
        {...attributes}
        {...listeners}
        className="h-3 flex items-center justify-center cursor-grab active:cursor-grabbing mb-1 opacity-0 hover:opacity-100 transition-opacity"
      >
        <div className="w-12 h-1 rounded-full bg-white/20" />
      </div>
      <SwitchDiagram device={device} wanColor={wanColor} wanConfigs={deviceWanConfigs} />
    </div>
  )
}

export default function Switches() {
  const { wanPortColor } = useColorSettings()
  const { data: switches = [], isLoading } = useQuery({
    queryKey: ['switches'],
    queryFn: async () => { const { data } = await api.get('/switch-ports/switches'); return data },
  })
  const { data: allWanConfigs = [] } = useQuery({
    queryKey: ['wan-configs-all'],
    queryFn: async () => { const { data } = await api.get('/wan-configs'); return data },
  })
  const { data: monitoringDevices = [] } = useQuery({
    queryKey: ['monitoring-devices'],
    queryFn: async () => { const { data } = await api.get('/monitoring/devices'); return data },
    refetchInterval: 30_000,
  })
  const wanStatusByPortId: Record<number, string> = {}
  for (const dev of monitoringDevices) {
    for (const nic of dev.nics ?? []) {
      if (nic.is_wan_ping && nic.switch_port_id != null) {
        wanStatusByPortId[nic.switch_port_id] = nic.status
      }
    }
  }
  const allWanConfigsWithStatus = allWanConfigs.map((wc: any) => ({
    ...wc,
    wan_current_status: wanStatusByPortId[wc.switch_port_id] ?? null,
  }))

  const [order, setOrder] = useState<number[]>(loadOrder)

  // When switches load, initialise order using grouped-alpha sort for any IDs not yet in saved order
  useEffect(() => {
    if (!switches.length) return
    const ids = switches.map((s: any) => s.id)
    const existingOrder = order.filter((id) => ids.includes(id))
    const newSwitches = switches.filter((s: any) => !order.includes(s.id))
    const single = newSwitches.filter((s: any) => (s.port_display_rows ?? 2) === 1).sort((a: any, b: any) => a.name.localeCompare(b.name))
    const multi = newSwitches.filter((s: any) => (s.port_display_rows ?? 2) !== 1).sort((a: any, b: any) => a.name.localeCompare(b.name))
    const sortedNew = [...single, ...multi].map((s: any) => s.id)
    setOrder([...existingOrder, ...sortedNew])
  }, [switches.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const orderedSwitches = order
    .map((id) => switches.find((s: any) => s.id === id))
    .filter(Boolean)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(Number(active.id)), prev.indexOf(Number(over.id)))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Switches</h1>
          <p className="text-sm text-white/40 mt-0.5">{switches.length} switch{switches.length !== 1 ? 'es' : ''}</p>
        </div>
        {order.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const reset: number[] = []
              localStorage.setItem(STORAGE_KEY, JSON.stringify(reset))
              setOrder([])
            }}
            className="text-[11px] text-white/20 hover:text-white/40 transition-colors"
          >
            Reset layout
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card h-32 w-96 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : switches.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <Network size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No switches configured</p>
          <p className="text-xs mt-1 text-white/20">Add switch ports to a device to see it here</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedSwitches.map((s: any) => s.id)} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap gap-4 items-start">
              {orderedSwitches.map((sw: any) => (
                <SortableSwitch key={sw.id} device={sw} wanColor={wanPortColor} wanConfigs={allWanConfigsWithStatus} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
