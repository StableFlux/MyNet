import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Maximize2, Minimize2, ArrowLeftRight } from 'lucide-react'
import { CardId } from '../hooks/useDeviceLayout'

interface Props {
  id: CardId
  colSpan: 1 | 2
  onToggleColSpan: () => void
  onSwapColumn?: () => void
  children: React.ReactNode
  canEdit: boolean
}

export function DraggableCard({ id, colSpan, onToggleColSpan, onSwapColumn, children, canEdit }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        ...(transform ? { transform: CSS.Transform.toString(transform) } : {}),
        ...(transition ? { transition } : {}),
      }}
      className={`group/drag relative${isDragging ? ' opacity-40' : ''}`}
    >
      {canEdit && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 invisible group-hover/drag:visible z-10">
          {colSpan === 1 && onSwapColumn && (
            <button
              type="button"
              onClick={onSwapColumn}
              aria-label="Move to other column"
              className="text-white/20 hover:text-white/60 transition-colors p-1 rounded"
            >
              <ArrowLeftRight size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleColSpan}
            aria-label={colSpan === 2 ? 'Half width' : 'Full width'}
            className="text-white/20 hover:text-white/60 transition-colors p-1 rounded"
          >
            {colSpan === 2 ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
          <button
            type="button"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
            className="text-white/20 hover:text-white/60 transition-colors p-1 rounded cursor-grab active:cursor-grabbing"
          >
            <GripVertical size={11} />
          </button>
        </div>
      )}
      {children}
    </div>
  )
}
