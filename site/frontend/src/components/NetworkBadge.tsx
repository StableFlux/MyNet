import { Network } from '../types'

interface Props {
  network?: Network | null
  name?: string
  color?: string
  vlan?: number | null
  size?: 'sm' | 'md'
}

export function NetworkBadge({ network, name, color, vlan, size = 'sm' }: Props) {
  const displayName = network?.name ?? name ?? 'Unknown'
  const displayColor = network?.color ?? color ?? '#64748b'
  const displayVlan = network?.vlan_id ?? vlan

  const sizeClass = size === 'md'
    ? 'text-xs px-2.5 py-1 gap-1.5'
    : 'text-[10px] px-2 py-0.5 gap-1'

  const dotClass = size === 'md' ? 'w-1.5 h-1.5' : 'w-[5px] h-[5px]'

  return (
    <span
      className={`accent-badge inline-flex items-center rounded-full font-mono font-semibold ${sizeClass}`}
      style={{
        '--accent': displayColor,
        '--accent-muted': `${displayColor}22`,
        '--accent-subtle': `${displayColor}55`,
      } as React.CSSProperties}
    >
      <span className={`accent-badge-dot rounded-full flex-shrink-0 ${dotClass}`} aria-hidden="true" />
      {displayVlan != null ? `VLAN ${displayVlan}` : displayName}
    </span>
  )
}
