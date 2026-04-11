import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

interface Props {
  deviceId: number
}

export function MonitoringWidget({ deviceId }: Props) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['monitoring', deviceId],
    queryFn: async () => {
      const { data } = await api.get(`/monitoring/device/${deviceId}?hours=1`)
      return data
    },
    refetchInterval: 60_000,
  })

  if (!data) return null

  const status = data.current_status as string
  const latency = data.current_latency as number | null

  const dotColor =
    status === 'up' ? '#10b981' :
    status === 'down' ? '#ef4444' :
    status === 'timeout' ? '#f59e0b' :
    '#64748b'

  const label =
    status === 'up' ? `Online${latency != null ? ` — ${latency}ms` : ''}` :
    status === 'down' ? 'Offline' :
    status === 'timeout' ? 'Timeout' :
    'Unknown'

  return (
    <button
      onClick={() => navigate(`/monitoring?device=${deviceId}`)}
      className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
      title="View monitoring details"
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
        style={{ backgroundColor: dotColor }}
      />
      <span className="font-mono text-xs">{label}</span>
      <Activity size={12} className="opacity-50" />
    </button>
  )
}
