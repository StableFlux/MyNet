import React, { ReactNode, useEffect, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Monitor, Network, Map,
  Activity, Package, LogOut, Settings,
  GitBranch, Server, ChevronLeft, ChevronRight, Menu, X,
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

const ICON_SIZE_EXPANDED = 16
const ICON_SIZE_COLLAPSED = 16

// Collapsed-mode sidebar rows use a uniform slot: fixed height, no horizontal
// padding (that would shrink the icon via flexbox), centered icon with shrink-0.
// Expanded mode uses icon+label rows with gap/padding for typographic rhythm.
const COLLAPSED_SLOT = 'flex items-center justify-center h-10 mx-2 rounded-lg transition-all border border-transparent'
const COLLAPSED_ACTIVE = 'bg-indigo-600/20 nav-item-active border-indigo-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]'
const COLLAPSED_INACTIVE = 'nav-item-inactive hover:text-white/90 hover:bg-white/[0.05]'
const COLLAPSED_MUTED = 'text-white/40 hover:text-white hover:bg-white/5'

interface Props {
  children: ReactNode
}

export function Layout({ children }: Props) {
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const { mode } = useThemeStore()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data } = await api.get('/system-settings'); return data },
  })

  const systemName = sysSettings?.system_name ?? 'MyNet'
  const authRequired = sysSettings?.auth_required ?? true

  useEffect(() => {
    document.title = systemName === 'MyNet' ? 'MyNet' : `MyNet — ${systemName}`
  }, [systemName])

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

  // Sidebar inner content — shared between desktop aside and mobile drawer.
  // `expanded`: true = always show labels (mobile), false = respect desktop `collapsed` state.
  function SidebarInner({ expanded }: { expanded: boolean }) {
    const showLabels = expanded || !collapsed

    return (
      <>
        {/* Logo row */}
        <div
          className="h-14 flex items-center border-b flex-shrink-0"
          style={{
            borderBottomColor: 'var(--sidebar-border)',
            padding: showLabels ? '0 20px' : '0 0 0 14px',
          }}
        >
          {showLabels ? (
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <img src="/logo_square.png" alt="MyNet" className="w-7 h-7 rounded-lg object-cover shadow-[0_0_14px_rgba(99,102,241,0.5)] flex-shrink-0" />
              <span className="font-bold text-white tracking-wide truncate">{systemName}</span>
            </div>
          ) : (
            <img src="/logo_square.png" alt="MyNet" className="w-7 h-7 rounded-lg object-cover shadow-[0_0_14px_rgba(99,102,241,0.5)]" />
          )}
          {expanded && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="ml-3 flex-shrink-0 text-white/40 hover:text-white/80 transition-colors p-1"
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Collapse/expand toggle — desktop only, sits at the top of the menu */}
        {!expanded && (
          <button
            type="button"
            onClick={toggleCollapsed}
            className={
              collapsed
                ? clsx(COLLAPSED_SLOT, COLLAPSED_MUTED, 'mt-2')
                : 'flex items-center justify-end gap-2 mx-2 mt-2 px-3 py-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all text-xs'
            }
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed
              ? <ChevronRight size={ICON_SIZE_COLLAPSED} className="shrink-0" />
              : <><span>Collapse</span><ChevronLeft size={14} /></>}
          </button>
        )}

        {/* Nav */}
        <nav
          className="flex-1 py-3 overflow-y-auto relative"
          style={showLabels ? {
            backgroundImage: 'url(/logo.png)',
            backgroundSize: '100% auto',
            backgroundPosition: 'bottom center',
            backgroundRepeat: 'no-repeat',
            backgroundBlendMode: 'var(--logo-blend-mode)' as React.CSSProperties['backgroundBlendMode'],
          } : {}}
        >
          {showLabels && (
            <a
              href="https://github.com/StableFlux/MyNet"
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-0 left-0 right-0 h-[88px]"
              title="View on GitHub"
            />
          )}
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={!showLabels ? label : undefined}
              className={({ isActive }) =>
                showLabels
                  ? clsx(
                      'flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border',
                      isActive
                        ? 'bg-indigo-600/20 nav-item-active border-indigo-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]'
                        : 'nav-item-inactive hover:text-white/90 hover:bg-white/[0.05] border-transparent'
                    )
                  : clsx(COLLAPSED_SLOT, isActive ? COLLAPSED_ACTIVE : COLLAPSED_INACTIVE)
              }
            >
              <Icon size={showLabels ? ICON_SIZE_EXPANDED : ICON_SIZE_COLLAPSED} className="shrink-0" />
              {showLabels && label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: user + admin + collapse toggle */}
        <div
          className={clsx('border-t space-y-1', showLabels ? 'p-3' : 'py-3')}
          style={{ borderTopColor: 'var(--sidebar-border)' }}
        >
          {user?.role === 'admin' && (
            <NavLink
              to="/settings"
              title={!showLabels ? 'Settings' : undefined}
              className={({ isActive }) =>
                showLabels
                  ? clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all w-full',
                      isActive ? 'bg-indigo-600/20 nav-item-active' : 'text-white/40 hover:text-white hover:bg-white/5'
                    )
                  : clsx(COLLAPSED_SLOT, isActive ? COLLAPSED_ACTIVE : COLLAPSED_MUTED)
              }
            >
              <Settings size={showLabels ? ICON_SIZE_EXPANDED : ICON_SIZE_COLLAPSED} className="shrink-0" />
              {showLabels && 'Settings'}
            </NavLink>
          )}

          {showLabels ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <div
                className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-xs text-indigo-300 font-bold uppercase shrink-0"
              >
                {user?.display_name?.[0] ?? '?'}
              </div>
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
            </div>
          ) : (
            <div className={COLLAPSED_SLOT} title={user?.display_name ?? undefined}>
              <div className="w-7 h-7 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-xs text-indigo-300 font-bold uppercase shrink-0">
                {user?.display_name?.[0] ?? '?'}
              </div>
            </div>
          )}

          {/* Logout when collapsed on desktop */}
          {!showLabels && authRequired && (
            <button
              type="button"
              onClick={handleLogout}
              className={clsx(COLLAPSED_SLOT, COLLAPSED_MUTED)}
              title="Logout"
            >
              <LogOut size={ICON_SIZE_COLLAPSED} className="shrink-0" />
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>

      {/* ── Desktop sidebar ── */}
      <aside
        className={clsx(
          'hidden md:flex flex-shrink-0 flex-col border-r transition-all duration-200',
          collapsed ? 'w-14' : 'w-56'
        )}
        style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
      >
        <SidebarInner expanded={false} />
      </aside>

      {/* ── Mobile drawer backdrop ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex flex-col w-64 border-r transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
      >
        <SidebarInner expanded={true} />
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top bar */}
        <header
          className="h-14 flex items-center gap-3 px-4 md:px-6 border-b flex-shrink-0"
          style={{ backgroundColor: 'var(--surface-raised)', borderBottomColor: 'var(--glass-border)' }}
        >
          {/* Hamburger — mobile only */}
          <button
            type="button"
            className="md:hidden flex-shrink-0 text-white/50 hover:text-white/80 transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          <div className="flex-1 min-w-0">
            <SearchBar />
          </div>
          <AlertBell />
        </header>

        {/* Content */}
        <main
          id="main-scroll"
          className="flex-1 overflow-y-auto p-4 md:p-6"
          style={{ backgroundColor: 'var(--surface)', backgroundImage: 'var(--body-gradient)' }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
