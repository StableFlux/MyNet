import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useState, useEffect } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'

interface ThemeStore {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: 'dark',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'mynet-theme' }
  )
)

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode)
  const html = document.documentElement
  html.classList.remove('dark', 'light')
  html.classList.add(resolved)
}

/** Returns the currently active resolved theme ('dark' or 'light'), reactive to OS changes. */
export function useResolvedTheme(): 'dark' | 'light' {
  const mode = useThemeStore(s => s.mode)
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolveTheme(mode))

  useEffect(() => {
    setResolved(resolveTheme(mode))
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => setResolved(resolveTheme(mode))
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  return resolved
}
