import React from 'react'

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#64748b', // slate
  '#a5b4fc', // indigo-300
  '#6ee7b7', // emerald-300
  '#7dd3fc', // sky-300
  '#fda4af', // rose-300
  '#fcd34d', // amber-300
  '#67e8f9', // cyan-300
  '#c4b5fd', // violet-300
]

interface ColorPickerProps {
  value: string
  onChange: (hex: string) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            className="w-5 h-5 rounded-full transition-transform hover:scale-110 flex-shrink-0"
            style={{
              backgroundColor: c,
              outline: value === c ? `2px solid white` : '2px solid transparent',
              outlineOffset: '1px',
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full border border-white/20 overflow-hidden flex-shrink-0">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-7 h-7 -ml-1 -mt-1 cursor-pointer"
            title="Custom colour"
          />
        </div>
        <span className="text-[11px] font-mono text-white/40">{value}</span>
      </div>
    </div>
  )
}
