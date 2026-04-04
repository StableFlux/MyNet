import { Bell } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

export function AlertBell() {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['alerts', 'unread'],
    queryFn: async () => {
      const { data } = await api.get('/alerts/unread-count')
      return data as { count: number }
    },
    refetchInterval: 30_000,
  })

  const count = data?.count ?? 0

  return (
    <button
      onClick={() => navigate('/alerts')}
      className="relative p-2 rounded-lg hover:bg-white/5 text-white/60 hover:text-white transition-colors"
      title="Alerts"
    >
      <Bell size={18} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white px-1">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
