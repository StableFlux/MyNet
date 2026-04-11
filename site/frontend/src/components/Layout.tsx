import React, { ReactNode, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Monitor, Network, Map,
  Activity, Package, LogOut, Settings,
  GitBranch, Server, ChevronLeft, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { SearchBar } from './SearchBar'
import { AlertBell } from './AlertBell'
import { useAuthStore } from '../store/authStore'
import { useThemeStore, applyTheme } from '../store/themeStore'
import api from '../lib/api'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/networks', icon: Network, label: 'Networks' },
  { to: '/devices', icon: Monitor, label: 'Devices' },
  { to: '/switches', icon: Server, label: 'Switches' },
  { to: '/subnet-map', icon: Map, label: 'Subnet Lists' },
  { to: '/path-tracer', icon: GitBranch, label: 'Path Tracer' },
  { to: '/monitoring', icon: Activity, label: 'Monitoring' },
  { to: '/stock', icon: Package, label: 'Stock & Undeployed' },
]

interface Props {
  children: ReactNode
}

export function Layout({ children }: Props) {
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()
  const { mode } = useThemeStore()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })

  const systemName = sysSettings?.system_name ?? 'MyNet'
  const authRequired = sysSettings?.auth_required ?? true

  useEffect(() => {
    document.title = systemName === 'MyNet' ? 'MyNet' : `MyNet — ${systemName}`
  }, [systemName])

  // Apply theme and subscribe to system preference changes
  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => applyTheme(mode)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  const handleLogout = async () => {
    try { await api.post('/auth/logout') } catch { /* best-effort */ }
    setUser(null)
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
      {/* Sidebar */}
      <aside
        className={clsx('flex-shrink-0 flex flex-col border-r transition-all duration-200', collapsed ? 'w-14' : 'w-56')}
        style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
      >
        {/* Logo */}
        <div className="h-14 flex items-center border-b flex-shrink-0" style={{ borderBottomColor: 'var(--sidebar-border)', padding: collapsed ? '0 0 0 14px' : '0 20px' }}>
          {collapsed ? (
            <img src="/logo_square.png" alt="MyNet" className="w-7 h-7 rounded-lg object-cover shadow-[0_0_14px_rgba(99,102,241,0.5)]" />
          ) : (
            <div className="flex items-center gap-2.5">
              <img src="/logo_square.png" alt="MyNet" className="w-7 h-7 rounded-lg object-cover shadow-[0_0_14px_rgba(99,102,241,0.5)]" />
              <span className="font-bold text-white tracking-wide">{systemName}</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto relative"
          style={collapsed ? {} : { backgroundImage: 'url(/logo.png)', backgroundSize: '100% auto', backgroundPosition: 'bottom center', backgroundRepeat: 'no-repeat', backgroundBlendMode: 'var(--logo-blend-mode)' as React.CSSProperties['backgroundBlendMode'] }}>
          {!collapsed && (
            <a href="https://github.com/StableFlux/MyNet" target="_blank" rel="noopener noreferrer"
              className="absolute bottom-0 left-0 right-0 h-[88px]" title="View on GitHub" />
          )}
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center mx-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border',
                  collapsed ? 'justify-center' : 'gap-3',
                  isActive
                    ? 'bg-indigo-600/20 nav-item-active border-indigo-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]'
                    : 'nav-item-inactive hover:text-white/90 hover:bg-white/[0.05] border-transparent'
                )
              }
            >
              <Icon size={16} />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: user + admin + toggle */}
        <div className="border-t p-3 space-y-1" style={{ borderTopColor: 'var(--sidebar-border)' }}>
          {user?.role === 'admin' && (
            <NavLink
              to="/settings"
              title={collapsed ? 'Settings' : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center px-3 py-2 rounded-lg text-sm transition-all w-full',
                  collapsed ? 'justify-center' : 'gap-3',
                  isActive
                    ? 'bg-indigo-600/20 nav-item-active'
                    : 'text-white/40 hover:text-white hover:bg-white/5'
                )
              }
            >
              <Settings size={15} />
              {!collapsed && 'Settings'}
            </NavLink>
          )}
          <div className={clsx('flex items-center px-3 py-2', collapsed ? 'justify-center' : 'gap-2')}>
            <div className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-xs text-indigo-300 font-bold uppercase flex-shrink-0"
              title={collapsed ? (user?.display_name ?? undefined) : undefined}>
              {user?.display_name?.[0] ?? '?'}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{user?.display_name}</p>
                  <p className="text-[10px] text-white/40 capitalize">{user?.role}</p>
                </div>
                {authRequired && (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="text-white/30 hover:text-white/70 transition-colors"
                    title="Logout"
                  >
                    <LogOut size={14} />
                  </button>
                )}
              </>
            )}
          </div>
          {collapsed && authRequired && (
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center justify-center w-full px-3 py-2 rounded-lg text-white/30 hover:text-white/70 transition-colors"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          )}
          {/* Collapse toggle */}
          <button
            type="button"
            onClick={toggleCollapsed}
            className={clsx('flex items-center w-full px-3 py-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all text-xs', collapsed ? 'justify-center' : 'gap-2')}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center gap-4 px-6 border-b flex-shrink-0" style={{ backgroundColor: 'var(--surface-raised)', borderBottomColor: 'var(--glass-border)' }}>
          <div className="flex-1">
            <SearchBar />
          </div>
          <AlertBell />
        </header>

        {/* Content */}
        <main id="main-scroll" className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: 'var(--surface)', backgroundImage: 'var(--body-gradient)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
