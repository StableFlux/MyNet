import { useState, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSearch } from '../hooks/useSearch'
import { NetworkBadge } from './NetworkBadge'
import { STATUS_COLORS } from '../theme/colours'

export function SearchBar() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const { data } = useSearch(query)
  const results = data?.results ?? []

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (deviceId: number) => {
    navigate(`/devices/${deviceId}`)
    setQuery('')
    setOpen(false)
  }

  const handleFullSearch = () => {
    if (query) {
      navigate(`/devices?q=${encodeURIComponent(query)}`)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Enter' && handleFullSearch()}
          placeholder="Search devices… ⌘K"
          className="w-full glass-input pl-9 pr-8 text-sm"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setOpen(false) }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && query.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 glass-card py-1 max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-white/40">No results for "{query}"</p>
          ) : (
            <>
              {results.slice(0, 8).map((device: any) => (
                <button
                  key={device.id}
                  onClick={() => handleSelect(device.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-left transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{device.name}</span>
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: STATUS_COLORS[device.status as keyof typeof STATUS_COLORS] ?? '#64748b' }}
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-white/40 truncate">
                        {device.hostname ?? device.brand ?? device.device_type}
                      </span>
                      {(() => { const n = device.nics?.find((n: any) => n.is_active !== false); return n && <NetworkBadge name={n.network_name} color={n.network_color} vlan={n.vlan_id} /> })()}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-white/30 flex-shrink-0">
                    {device.nics?.find((n: any) => n.is_active !== false && n.ip_address)?.ip_address}
                  </span>
                </button>
              ))}
              {results.length > 8 && (
                <button
                  onClick={handleFullSearch}
                  className="w-full px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 text-center transition-colors border-t border-glass-border"
                >
                  Show all {results.length} results →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
