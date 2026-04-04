import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { SEVERITY_COLORS } from '../theme/colours'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'

export default function Alerts() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => { const { data } = await api.get('/alerts?acknowledged=false'); return data },
    refetchInterval: 30_000,
  })

  const ackMutation = useMutation({
    mutationFn: (id: number) => api.post(`/alerts/${id}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })

  const ackAllMutation = useMutation({
    mutationFn: () => api.post('/alerts/acknowledge-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Alerts</h1>
          <p className="text-sm text-white/40 mt-0.5">{alerts?.length ?? 0} unacknowledged</p>
        </div>
        {canEdit && alerts?.length > 0 && (
          <button onClick={() => ackAllMutation.mutate()} className="btn-ghost flex items-center gap-2 text-sm">
            <CheckCheck size={14} /> Acknowledge all
          </button>
        )}
      </div>

      {(!alerts || alerts.length === 0) ? (
        <div className="text-center py-16 text-white/30">
          <Bell size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No active alerts</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a: any) => (
            <GlassCard key={a.id} padding="sm" className="flex items-start gap-3">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                style={{ backgroundColor: SEVERITY_COLORS[a.severity as keyof typeof SEVERITY_COLORS] ?? '#64748b' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white">{a.message}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-white/30">{new Date(a.created_at).toLocaleString()}</span>
                  <span className="text-[10px] capitalize text-white/30">{a.severity}</span>
                  {a.device_id && (
                    <button onClick={() => navigate(`/devices/${a.device_id}`)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300">
                      View device →
                    </button>
                  )}
                </div>
              </div>
              {canEdit && (
                <button onClick={() => ackMutation.mutate(a.id)}
                  className="btn-ghost p-1.5 flex-shrink-0" title="Acknowledge">
                  <CheckCheck size={14} />
                </button>
              )}
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}
