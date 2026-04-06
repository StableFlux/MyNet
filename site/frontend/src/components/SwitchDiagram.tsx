import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, ArrowDown, ShieldAlert, ExternalLink, Globe } from 'lucide-react'

interface SwitchPort {
  id: number
  port_number: number
  port_name: string | null
  port_type: string
  poe_enabled: boolean
  port_mode?: string
  is_management: boolean
  is_downlink: boolean
  connected_device_id: number | null
  connected_device_name: string | null
  connected_nic_label: string | null
  connected_vlan_id: number | null
  connected_network_color: string | null
  remote_port_number: number | null
  remote_port_name: string | null
}

interface SwitchDevice {
  id: number
  name: string
  location: string | null
  port_display_rows: number | null
  port_numbering: string | null
  uplink_port_id: number | null
  upstream_device_id: number | null
  upstream_device_name: string | null
  switch_ports: SwitchPort[]
}

const CONNECTION_TYPE_LABELS: Record<string, string> = {
  dhcp: 'DHCP', static: 'Static IP', pppoe: 'PPPoE', '4g-lte': '4G/LTE', 'ds-lite': 'DS-Lite',
}

export function SwitchDiagram({ device, wanConfigs = [], wanColor = '#f59e0b' }: { device: SwitchDevice; wanConfigs?: any[]; wanColor?: string }) {
  const navigate = useNavigate()
  const [hoveredPort, setHoveredPort] = useState<{ port: SwitchPort; x: number; y: number } | null>(null)

  const sorted = [...device.switch_ports].sort((a, b) => a.port_number - b.port_number)
  const mgmtPorts = sorted.filter((p) => p.is_management)
  const ethPorts = sorted.filter((p) => p.port_type === 'eth' && !p.is_management)
  const sfpPorts = sorted.filter((p) => p.port_type !== 'eth' && !p.is_management)
  const connectedCount = sorted.filter((p) => !!p.connected_device_name || (device.uplink_port_id != null && p.id === device.uplink_port_id)).length

  const rows = device.port_display_rows ?? 2
  const numbering = device.port_numbering ?? 'alternating'

  const renderPortCell = (port: SwitchPort | undefined, key: string, isSfp = false) => {
    if (!port) return <div key={key} className={isSfp ? 'switch-port switch-port-sfp opacity-0' : 'switch-port opacity-0'} />
    const isUplink = device.uplink_port_id != null && port.id === device.uplink_port_id
    const isMgmt = port.is_management
    const isDownlink = port.is_downlink
    const isWan = port.port_mode === 'wan'
    const isConnected = !!port.connected_device_name || isUplink
    const wanConfig = isWan ? wanConfigs.find((wc: any) => wc.switch_port_id === port.id) : null
    const wanOnline = wanConfig?.wan_monitoring_enabled !== false && wanConfig?.wan_current_status === 'up'
    const accentColor = isUplink ? '#818cf8' : isWan ? (wanOnline ? '#22c55e' : wanColor) : isMgmt ? '#a78bfa' : (port.connected_network_color || '#4ade80')

    const cssVars = (isConnected || isWan) ? {
      '--port-accent': accentColor,
      '--port-accent-bg': accentColor + '22',
      '--port-accent-border': accentColor + '55',
      '--port-accent-glow': accentColor + '26',
    } as React.CSSProperties : {}

    return (
      <div
        key={port.id}
        className={[
          'switch-port',
          isSfp ? 'switch-port-sfp' : '',
          isConnected || isWan ? 'switch-port-connected' : '',
          isMgmt && !isConnected && !isWan ? 'switch-port-mgmt' : '',
          isConnected || isMgmt ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        style={cssVars}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHoveredPort({ port, x: r.left + r.width / 2, y: r.top })
        }}
        onMouseLeave={() => setHoveredPort(null)}
        onClick={() => {
          if (port.connected_device_id && port.connected_device_id > 0) navigate(`/devices/${port.connected_device_id}`)
          else if (isUplink && device.upstream_device_id) navigate(`/devices/${device.upstream_device_id}`)
        }}
      >
        {isUplink
          ? <ArrowUp size={9} className="text-indigo-400" />
          : isDownlink
            ? <ArrowDown size={9} className="text-indigo-300/70" />
            : isWan
              ? <Globe size={9} style={{ color: wanColor }} />
              : isMgmt
                ? <ShieldAlert size={9} className="text-violet-400" />
                : isConnected
                  ? <div className="switch-port-led" />
                  : <div className="w-1.5 h-1.5 rounded-full bg-white/[0.08]" />
        }
      </div>
    )
  }

  const renderGroup = (ports: SwitchPort[], isSfp = false) => {
    const byNum: Record<number, SwitchPort> = Object.fromEntries(ports.map((p) => [p.port_number, p]))
    const sorted2 = [...ports].sort((a, b) => a.port_number - b.port_number)

    let cols: { top: SwitchPort | undefined; bot?: SwitchPort | undefined }[]
    if (rows === 1) {
      cols = sorted2.map((p) => ({ top: p }))
    } else if (numbering === 'sequential') {
      const half = Math.ceil(sorted2.length / 2)
      cols = sorted2.slice(0, half).map((p, i) => ({ top: p, bot: sorted2.slice(half)[i] }))
    } else {
      const nums = ports.map((p) => p.port_number)
      const minN = Math.min(...nums); const maxN = Math.max(...nums)
      cols = []
      for (let n = minN; n <= maxN; n += 2) cols.push({ top: byNum[n], bot: byNum[n + 1] })
    }

    return cols.map((col, i) => (
      <div key={i} className="flex flex-col items-center gap-[3px]">
        <span className="text-[8px] text-white/20 leading-none h-[10px] flex items-center font-mono">
          {col.top?.port_number ?? ''}
        </span>
        {renderPortCell(col.top, `top-${i}`, isSfp)}
        {rows > 1 && renderPortCell(col.bot, `bot-${i}`, isSfp)}
        {rows > 1 && (
          <span className="text-[8px] text-white/20 leading-none h-[10px] flex items-center font-mono">
            {col.bot?.port_number ?? ''}
          </span>
        )}
      </div>
    ))
  }

  return (
    <>
      <div className="switch-chassis">
        {/* Header */}
        <div className="flex items-center justify-between gap-6">
          <button
            type="button"
            onClick={() => navigate(`/devices/${device.id}`)}
            className="text-[10px] font-semibold text-white/40 uppercase tracking-widest hover:text-white/60 transition-colors flex items-center gap-1.5"
          >
            {device.name}
            <ExternalLink size={9} className="opacity-60" />
          </button>
          <div className="flex items-center gap-3 text-[10px] text-white/20 font-mono">
            {device.location && <span>{device.location}</span>}
            <span>{connectedCount}/{sorted.length}</span>
          </div>
        </div>

        {/* Port groups */}
        <div className="flex items-center gap-1">
          {ethPorts.length > 0 && renderGroup(ethPorts)}
          {ethPorts.length > 0 && sfpPorts.length > 0 && (
            <div className="w-px self-stretch mx-2 bg-white/[0.06]" />
          )}
          {sfpPorts.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[8px] text-white/15 uppercase tracking-widest text-center mb-0.5">SFP</span>
              <div className="flex items-center gap-1">{renderGroup(sfpPorts, true)}</div>
            </div>
          )}
          {mgmtPorts.length > 0 && (ethPorts.length > 0 || sfpPorts.length > 0) && (
            <div className="w-px self-stretch mx-2 bg-white/[0.06]" />
          )}
          {mgmtPorts.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[8px] text-white/15 uppercase tracking-widest text-center mb-0.5">MGMT</span>
              <div className="flex items-center gap-1">{renderGroup(mgmtPorts)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredPort && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{ left: hoveredPort.x, top: hoveredPort.y - 8 }}
        >
          <div className="bg-surface-raised border border-glass-border rounded-lg p-2.5 shadow-2xl text-xs space-y-1.5 min-w-[160px]">
            {/* Port number / name */}
            <p className="font-semibold text-white/80">
              {hoveredPort.port.port_name
                ? `Port ${hoveredPort.port.port_number} / ${hoveredPort.port.port_name}`
                : `Port ${hoveredPort.port.port_number}`}
            </p>

            {/* Type badges */}
            {(device.uplink_port_id === hoveredPort.port.id || hoveredPort.port.is_downlink || hoveredPort.port.is_management || hoveredPort.port.port_mode === 'wan' || hoveredPort.port.poe_enabled) && (
              <div className="flex flex-wrap gap-1">
                {device.uplink_port_id === hoveredPort.port.id && (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400">↑ Uplink</span>
                )}
                {hoveredPort.port.is_downlink && (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-400/10 text-indigo-300/80">↓ Downlink</span>
                )}
                {hoveredPort.port.is_management && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">Management</span>
                )}
                {hoveredPort.port.port_mode === 'wan' && (
                  <span className="px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: wanColor + '26', color: wanColor }}>WAN</span>
                )}
                {hoveredPort.port.poe_enabled && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80">PoE</span>
                )}
              </div>
            )}

            {/* WAN config details */}
            {hoveredPort.port.port_mode === 'wan' && (() => {
              const wc = wanConfigs.find((w: any) => w.switch_port_id === hoveredPort.port.id)
              if (!wc) return <p className="text-white/30">No WAN config set</p>
              return (
                <div className="space-y-0.5">
                  {wc.isp_name && <p className="text-white/70">{wc.isp_name}</p>}
                  {wc.connection_type && <p className="text-white/40">{CONNECTION_TYPE_LABELS[wc.connection_type] ?? wc.connection_type}</p>}
                  {wc.ip_address && <p className="text-white/40 font-mono">{wc.ip_address}</p>}
                  {(wc.speed_down || wc.speed_up) && (
                    <p className="text-white/30">↓ {wc.speed_down || '—'} / ↑ {wc.speed_up || '—'}</p>
                  )}
                </div>
              )
            })()}

            {/* Connection details */}
            {hoveredPort.port.port_mode !== 'wan' && device.uplink_port_id === hoveredPort.port.id ? (
              <>
                <p className="text-white/70">{device.upstream_device_name ?? 'Upstream device'}</p>
                {hoveredPort.port.remote_port_number != null && (
                  <p className="text-white/40 font-mono">
                    {'→ Port '}
                    {hoveredPort.port.remote_port_number}
                    {hoveredPort.port.remote_port_name ? ` / ${hoveredPort.port.remote_port_name}` : ''}
                  </p>
                )}
              </>
            ) : hoveredPort.port.connected_device_name ? (
              <>
                <p className="text-white/70">{hoveredPort.port.connected_device_name}</p>
                {hoveredPort.port.remote_port_number != null ? (
                  <p className="text-white/40 font-mono">
                    {'→ Port '}
                    {hoveredPort.port.remote_port_number}
                    {hoveredPort.port.remote_port_name ? ` / ${hoveredPort.port.remote_port_name}` : ''}
                  </p>
                ) : hoveredPort.port.connected_nic_label ? (
                  <p className="text-white/40">via {hoveredPort.port.connected_nic_label}</p>
                ) : null}
                {hoveredPort.port.connected_vlan_id && (
                  <p className="text-white/40">VLAN {hoveredPort.port.connected_vlan_id}</p>
                )}
              </>
            ) : hoveredPort.port.port_mode !== 'wan' ? (
              <p className="text-white/30">No device connected</p>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
