import { ReactNode } from 'react'
import clsx from 'clsx'

interface Props {
  children: ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean
  padding?: 'sm' | 'md' | 'lg' | 'none'
}

const paddings = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
}

export function GlassCard({ children, className, onClick, hover = false, padding = 'md' }: Props) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'glass-card',
        paddings[padding],
        hover && 'glass-card-interactive cursor-pointer',
        !hover && onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}
