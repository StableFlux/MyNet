import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const fd = new URLSearchParams()
      fd.append('username', form.username)
      fd.append('password', form.password)
      await api.post('/auth/login', fd, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      const { data: me } = await api.get('/auth/me')
      setUser(me)
      navigate('/')
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm -mt-32">
        <img src="/logo.png" alt="MyNet" className="w-[365px] mx-auto mb-6 block" />
        <div className="glass-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-xs font-medium text-white/60 mb-1.5">Username</label>
              <input
                id="login-username"
                type="text"
                className="glass-input w-full"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoFocus
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-white/60 mb-1.5">Password</label>
              <input
                id="login-password"
                className="glass-input w-full"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(e as any) }}
                required
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
