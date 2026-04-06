import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Check, ArrowLeft, ArrowRight } from 'lucide-react'
import { DeviceTypeIcon, HARDWARE_TYPE_ICON, NIC_TYPE_ICON, STATUS_ICON } from './DeviceTypeIcon'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Device } from '../types'
import { NetworkBadge } from './NetworkBadge'
import { GlassCard } from './GlassCard'
import { useAuthStore } from '../store/authStore'
import { useColorSettings } from '../hooks/useColorSettings'
import api from '../lib/api'

interface Props {
  device: Device
}

export function DeviceCard({ device }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const colors = useColorSettings()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

  const [monitoringEnabled, setMonitoringEnabled] = useState(device.monitoring_enabled)
  const [copiedIp, setCopiedIp] = useState<string | null>(null)
  const [nicOffset, setNicOffset] = useState(0)
  const nicContainerRef = useRef<HTMLDivElement>(null)

  const allNicsWithInfo = device.nics
    .filter((n) => n.network_name || n.ip_address || (n as any).address_type === 'dhcp')
    .sort((a, b) => {
      const aWifi = a.nic_type?.toUpperCase() === 'WIFI' ? 1 : 0
      const bWifi = b.nic_type?.toUpperCase() === 'WIFI' ? 1 : 0
      return aWifi - bWifi
    })
  const hasMoreNics = allNicsWithInfo.length > 2
  const monitorNicIds: number[] = (device as any).monitor_nic_ids ?? []
  const isNicMonitored = (nicId: number) =>
    monitoringEnabled && (!monitorNicIds.length || monitorNicIds.includes(nicId))

  const statusClass = `status-${device.status.replace(/_/g, '-')}`
  const accentBar = colors.categoryColor((device as any).device_type_category ?? (device as any).hardware_type)

  const { data: monData } = useQuery({
    queryKey: ['monitoring', device.id],
    queryFn: async () => { const { data } = await api.get(`/monitoring/device/${device.id}`); return data ?? null },
    enabled: monitoringEnabled,
    staleTime: 30_000,
  })

  const nicOnlineMap = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const nic of (monData?.nics ?? [])) {
      map[nic.ip] = nic.current_status === 'up'
    }
    return map
  }, [monData])

  useEffect(() => {
    if (nicContainerRef.current) {
      const w = nicContainerRef.current.offsetWidth
      nicContainerRef.current.scrollTo({ left: nicOffset * (w / 2 + 3), behavior: 'smooth' })
    }
  }, [nicOffset])

  const copyIp = (e: React.MouseEvent, ip: string) => {
    e.stopPropagation()
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(ip).catch(() => _copyFallback(ip))
    } else {
      _copyFallback(ip)
    }
    setCopiedIp(ip)
    setTimeout(() => setCopiedIp(null), 1500)
  }

  const _copyFallback = (text: string) => {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }

  const toggleMonitoring = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data } = await api.patch(
        `/devices/${device.id}/monitoring?enabled=${enabled}&interval_secs=${device.monitor_interval_secs ?? 60}`
      )
      return data
    },
    onMutate: (enabled) => setMonitoringEnabled(enabled),
    onError: () => setMonitoringEnabled(device.monitoring_enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search'] })
      queryClient.invalidateQueries({ queryKey: ['monitoring'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  return (
    <GlassCard
      hover
      padding="sm"
      onClick={() => navigate(`/devices/${device.id}`)}
      className="relative flex flex-col gap-2"
    >
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ background: accentBar }}
      />
      {/* Row 1: device type icon + name/use + ping */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
            <DeviceTypeIcon name={(device as any).device_type_icon ?? HARDWARE_TYPE_ICON[(device as any).hardware_type]} size={28} className="text-white/30" />
            {(() => { const I = STATUS_ICON[device.status]; return I ? <I size={10} style={{ color: colors.statusColor(device.status) }} /> : null })()}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">{device.name}</h3>
            <p className="text-xs text-white/40 truncate">{device.use ?? ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canEdit && (
            <button
              type="button"
              aria-label={monitoringEnabled ? 'Disable ping monitoring' : 'Enable ping monitoring'}
              disabled={toggleMonitoring.isPending || device.status === 'stock' || device.status === 'undeployed'}
              onClick={(e) => {
                e.stopPropagation()
                toggleMonitoring.mutate(!monitoringEnabled)
              }}
              className="flex items-center gap-1 group disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-white/25 group-hover:text-white/40 transition-colors">ping</span>
              <div className={`relative w-7 h-4 rounded-full transition-colors ${monitoringEnabled ? 'bg-indigo-600' : 'bg-white/15 group-hover:bg-white/20'}`}>
                <span className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-[#ffffff] shadow-sm transition-transform ${monitoringEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: brand/model left, NIC arrows right */}
      {(hasMoreNics || device.brand || device.model) && (
        <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
          <p className="text-[10px] text-white/30 truncate">
            {[device.brand, device.model].filter(Boolean).join(' ')}
          </p>
          {hasMoreNics && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                type="button"
                aria-label="Previous NICs"
                disabled={nicOffset === 0}
                onClick={(e) => { e.stopPropagation(); setNicOffset(o => o - 1) }}
                className="text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowLeft size={13} />
              </button>
              <button
                type="button"
                aria-label="Next NICs"
                disabled={nicOffset + 1 >= allNicsWithInfo.length}
                onClick={(e) => { e.stopPropagation(); setNicOffset(o => o + 1) }}
                className="text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Row 3: NIC boxes — smooth scroll track */}
      {allNicsWithInfo.length > 0 && (
        <div ref={nicContainerRef} className="flex gap-1.5 overflow-x-scroll [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {allNicsWithInfo.map((n, i) => {
            const NicIcon = NIC_TYPE_ICON[n.nic_type?.toUpperCase()] ?? NIC_TYPE_ICON.ETH
            const inactive = (n as any).is_active === false
            const hasColor = !!n.network_color && !inactive
            const onlineStatus = !inactive && isNicMonitored(n.id) && n.ip_address ? nicOnlineMap[n.ip_address] : undefined
            const iconClass = inactive ? 'text-white/15' : onlineStatus === true ? 'nic-icon-online' : onlineStatus === false ? 'nic-icon-offline' : 'text-white/25'
            const nicCssVars = hasColor ? {
              '--port-accent-bg': n.network_color + '1a',
              '--port-accent-border': n.network_color + '44',
              '--port-accent-glow': n.network_color + '22',
            } as React.CSSProperties : {}
            return (
              <div
                key={i}
                className={`nic-slot flex w-[calc(50%-3px)] flex-shrink-0 items-center gap-1.5 ${hasColor ? 'nic-slot-connected' : ''} ${inactive ? 'opacity-40' : ''}`}
                style={nicCssVars}
              >
                <NicIcon size={22} className={`flex-shrink-0 ${iconClass}`} />
                <div className="flex flex-1 flex-col gap-0.5 items-center">
                  {n.network_name && (
                    <NetworkBadge
                      name={n.network_name}
                      color={n.network_color}
                      vlan={n.vlan_id}
                    />
                  )}
                  {((n as any).address_type === 'dhcp' || n.ip_address) && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono text-white/50 leading-none">
                        {(n as any).address_type === 'dhcp' ? 'DHCP' : n.ip_address}
                      </span>
                      {(n as any).address_type !== 'dhcp' && n.ip_address && (
                        <button
                          type="button"
                          aria-label="Copy IP address"
                          onClick={(e) => copyIp(e, n.ip_address!)}
                          className="text-white/20 hover:text-white/60 transition-colors"
                        >
                          {copiedIp === n.ip_address ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}


    </GlassCard>
  )
}
