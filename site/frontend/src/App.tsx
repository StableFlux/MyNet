import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import AdminRoute from './components/AdminRoute'
import { useAuthStore } from './store/authStore'
import { useWebSocket } from './hooks/useWebSocket'
import { useQueryClient } from '@tanstack/react-query'
import api from './lib/api'

// Pages
import Login from './pages/Login'
import Setup from './pages/Setup'
import Dashboard from './pages/Dashboard'
import DeviceList from './pages/Devices/DeviceList'
import DeviceDetail from './pages/Devices/DeviceDetail'
import DeviceForm from './pages/Devices/DeviceForm'
import Networks from './pages/Networks'
import Switches from './pages/Switches'
import NetworkForm from './pages/NetworkForm'
import SubnetMap from './pages/SubnetMap'
import PathTracer from './pages/PathTracer'
import Monitoring from './pages/Monitoring'
import Events from './pages/Events'
import StockTracker from './pages/StockTracker'
import UserManagement from './pages/UserManagement'
import Backup from './pages/Backup'
import Settings from './pages/Settings'
import Locations from './pages/Locations'
import LabelExport from './pages/LabelExport'
import ColourSettings from './pages/ColourSettings'
import PiholeSettings from './pages/PiholeSettings'
import NetworkScan from './pages/NetworkScan'
import UnifiSettings from './pages/UnifiSettings'
import Storage from './pages/Storage'
import DegradedMode from './pages/DegradedMode'
import Debug from './pages/Debug'

function AppInner() {
  const { user, setUser } = useAuthStore()
  const qc = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [storageCandidate, setStorageCandidate] = useState<any>(null)
  const [degraded, setDegraded] = useState<any>(null)
  // Debounce monitoring invalidation: the scheduler broadcasts one ping_result per
  // device/IP, so N monitored addresses → N rapid WS messages. Without debouncing
  // this causes N back-to-back invalidations, re-rendering every monitoring consumer
  // (Switches DnD context, DeviceList, Monitoring page) simultaneously — which
  // freezes the UI. Coalescing into a single invalidation 600ms after the last
  // message matches the actual data cadence (one batch per 60s tick).
  const monitoringInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handle real-time WebSocket events
  useWebSocket((msg) => {
    if (msg.type === 'ping_result') {
      if (monitoringInvalidateTimer.current) clearTimeout(monitoringInvalidateTimer.current)
      monitoringInvalidateTimer.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['monitoring'] })
      }, 600)
    }
    if (msg.type === 'alert') {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['events-count'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  })

  const init = async () => {
    // Storage health probe first — never touches the DB, so it works in
    // degraded mode. If the DB is unreachable, we render the recovery UI
    // instead of bouncing between login / setup / unreachable errors.
    try {
      const { data: health } = await api.get('/storage/health')
      if (health.platform_supported && !health.db_reachable) {
        setDegraded(health)
        setLoading(false)
        return
      }
    } catch {
      // Health endpoint itself failed — proceed to the normal flow, which
      // will surface the real issue via its own error handling.
    }

    try {
      const { data: setupCheck } = await api.get('/auth/setup-required')
      if (setupCheck.setup_required) {
        setSetupRequired(true)
        setStorageCandidate(setupCheck.storage_candidate ?? null)
        setLoading(false)
        return
      }
    } catch {
      setLoading(false)
      return
    }
    try {
      const { data: me } = await api.get('/auth/me')
      setUser(me)
    } catch {
      // Not logged in — will redirect to login
    }
    setLoading(false)
  }

  useEffect(() => { init() }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (degraded) return <DegradedMode health={degraded} onRetry={() => { setDegraded(null); setLoading(true); init() }} />

  if (setupRequired) return <Setup storageCandidate={storageCandidate} />

  if (!user) return <Login />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/devices" element={<DeviceList />} />
        <Route path="/devices/new" element={<DeviceForm />} />
        <Route path="/devices/:id" element={<DeviceDetail />} />
        <Route path="/devices/:id/edit" element={<DeviceForm />} />
        <Route path="/networks" element={<Networks />} />
        <Route path="/switches" element={<Switches />} />
        <Route path="/networks/new" element={<NetworkForm />} />
        <Route path="/networks/:id/edit" element={<NetworkForm />} />
        <Route path="/subnet-map" element={<SubnetMap />} />
        <Route path="/path-tracer" element={<PathTracer />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/stock" element={<StockTracker />} />
        <Route path="/events" element={<Events />} />
        <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
        <Route path="/settings/locations" element={<AdminRoute><Locations /></AdminRoute>} />
        <Route path="/settings/colours" element={<AdminRoute><ColourSettings /></AdminRoute>} />
        <Route path="/settings/pihole" element={<AdminRoute><PiholeSettings /></AdminRoute>} />
        <Route path="/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
        <Route path="/backup" element={<AdminRoute><Backup /></AdminRoute>} />
        <Route path="/settings/label-export" element={<AdminRoute><LabelExport /></AdminRoute>} />
        <Route path="/settings/network-scan" element={<AdminRoute><NetworkScan /></AdminRoute>} />
        <Route path="/settings/unifi" element={<AdminRoute><UnifiSettings /></AdminRoute>} />
        <Route path="/settings/storage" element={<AdminRoute><Storage /></AdminRoute>} />
        <Route path="/debug" element={<Debug />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppInner />
    </BrowserRouter>
  )
}
