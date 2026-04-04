import { useEffect, useState } from 'react'
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
import AuditLog from './pages/AuditLog'
import StockTracker from './pages/StockTracker'
import Alerts from './pages/Alerts'
import UserManagement from './pages/UserManagement'
import Backup from './pages/Backup'
import Settings from './pages/Settings'
import Locations from './pages/Locations'
import LabelExport from './pages/LabelExport'
import ColourSettings from './pages/ColourSettings'

function AppInner() {
  const { user, setUser } = useAuthStore()
  const qc = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)

  // Handle real-time WebSocket events
  useWebSocket((msg) => {
    if (msg.type === 'ping_result') {
      qc.invalidateQueries({ queryKey: ['monitoring'] })
    }
    if (msg.type === 'alert') {
      qc.invalidateQueries({ queryKey: ['alerts'] })
    }
  })

  useEffect(() => {
    const init = async () => {
      // Check if first-run setup is needed
      const { data: setupCheck } = await api.get('/auth/setup-required')
      if (setupCheck.setup_required) {
        setSetupRequired(true)
        setLoading(false)
        return
      }
      // Try to restore session
      try {
        const { data: me } = await api.get('/auth/me')
        setUser(me)
      } catch {
        // Not logged in — will redirect to login
      }
      setLoading(false)
    }
    init()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (setupRequired) return <Setup />

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
        <Route path="/settings/audit" element={<AdminRoute><AuditLog /></AdminRoute>} />
        <Route path="/stock" element={<StockTracker />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
        <Route path="/settings/locations" element={<AdminRoute><Locations /></AdminRoute>} />
        <Route path="/settings/colours" element={<AdminRoute><ColourSettings /></AdminRoute>} />
        <Route path="/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
        <Route path="/backup" element={<AdminRoute><Backup /></AdminRoute>} />
        <Route path="/settings/label-export" element={<AdminRoute><LabelExport /></AdminRoute>} />
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
