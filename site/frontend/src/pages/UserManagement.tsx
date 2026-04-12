import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Pencil, Trash2, Shield, Eye, User as UserIcon, ChevronLeft } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import { User } from '../types'

const ROLE_ICONS = { admin: Shield, editor: Pencil, viewer: Eye }

export default function UserManagement() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user: me } = useAuthStore()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ display_name: '', email: '', password: '' })
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'viewer' as 'admin' | 'editor' | 'viewer' })

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => { const { data } = await api.get('/auth/users'); return data as User[] },
  })

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => api.post('/auth/users', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setCreating(false) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<typeof form> & { is_active?: boolean } }) =>
      api.patch(`/auth/users/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditingId(null) },
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Failed to update user'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/auth/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Failed to delete user'),
  })

  const profileMutation = useMutation({
    mutationFn: (body: typeof profileForm) => api.patch(`/auth/users/${me!.id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditingProfile(false) },
  })

  const resetForm = () => setForm({ username: '', display_name: '', password: '', role: 'viewer' })

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/settings')} className="btn-ghost flex items-center gap-1.5 text-sm">
            <ChevronLeft size={14} />
            Settings
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">User Management</h1>
            <p className="text-sm text-white/40 mt-0.5">{users?.length ?? 0} users</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setCreating(true) }}
          className="btn-primary flex items-center gap-2">
          <UserPlus size={15} /> Add User
        </button>
      </div>

      {/* My Profile */}
      {me && (
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center">
                <UserIcon size={18} className="text-indigo-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/80 uppercase tracking-wider text-[10px]">My Profile</p>
                <p className="text-sm font-semibold text-white">{me.display_name}</p>
                <p className="text-xs text-white/40">@{me.username}</p>
              </div>
            </div>
            <button type="button" onClick={() => {
              setProfileForm({ display_name: me.display_name, email: (me as any).email ?? '', password: '' })
              setEditingProfile(v => !v)
            }} className="btn-ghost p-1.5" aria-label="Edit profile">
              <Pencil size={13} />
            </button>
          </div>

          {editingProfile && (
            <div className="border-t border-glass-border pt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="profile-username" className="text-[10px] text-white/40 block mb-1">Username</label>
                  <input id="profile-username" className="glass-input w-full text-sm opacity-50 cursor-not-allowed" value={me.username} disabled />
                </div>
                <div>
                  <label htmlFor="profile-display-name" className="text-[10px] text-white/40 block mb-1">Display Name</label>
                  <input id="profile-display-name" className="glass-input w-full text-sm" value={profileForm.display_name}
                    onChange={e => setProfileForm(f => ({ ...f, display_name: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="profile-email" className="text-[10px] text-white/40 block mb-1">Email</label>
                  <input id="profile-email" className="glass-input w-full text-sm" type="email" value={profileForm.email}
                    onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
                </div>
                <div>
                  <label htmlFor="profile-password" className="text-[10px] text-white/40 block mb-1">New Password (leave blank to keep)</label>
                  <input id="profile-password" className="glass-input w-full text-sm" type="password" value={profileForm.password}
                    onChange={e => setProfileForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
                </div>
                <div>
                  <label htmlFor="profile-role" className="text-[10px] text-white/40 block mb-1">Role</label>
                  <input id="profile-role" className="glass-input w-full text-sm opacity-50 cursor-not-allowed" value={me.role} disabled />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => profileMutation.mutate(profileForm)}
                  disabled={profileMutation.isPending} className="btn-primary text-sm">
                  {profileMutation.isPending ? 'Saving…' : 'Save Profile'}
                </button>
                <button type="button" onClick={() => setEditingProfile(false)} className="btn-ghost text-sm">Cancel</button>
              </div>
              {profileMutation.isError && (
                <p className="text-xs text-red-400">{(profileMutation.error as any).response?.data?.detail}</p>
              )}
            </div>
          )}
        </GlassCard>
      )}

      {/* Create form */}
      {creating && (
        <GlassCard className="border border-indigo-500/30">
          <h3 className="text-sm font-semibold text-white mb-4">New User</h3>
          <UserForm form={form} setForm={setForm} showUsername prefix="create" />
          <div className="flex gap-2 mt-4">
            <button onClick={() => createMutation.mutate(form)}
              disabled={createMutation.isPending} className="btn-primary text-sm">
              {createMutation.isPending ? 'Creating…' : 'Create User'}
            </button>
            <button onClick={() => setCreating(false)} className="btn-ghost text-sm">Cancel</button>
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-400 mt-2">{(createMutation.error as any).response?.data?.detail}</p>
          )}
        </GlassCard>
      )}

      {/* User list */}
      <div className="space-y-2">
        {(users ?? []).map((u) => {
          const RoleIcon = ROLE_ICONS[u.role]
          return (
            <div key={u.id}>
              <GlassCard padding="sm" className="flex items-center gap-3">
                <div className={`role-${u.role} w-9 h-9 rounded-xl flex items-center justify-center font-bold uppercase text-sm`}>
                  {u.display_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{u.display_name}</p>
                    <span className="text-[10px] font-mono text-white/30">@{u.username}</span>
                    {!u.is_active && (
                      <span className="text-[10px] text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">disabled</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <RoleIcon size={10} className={`role-${u.role}-text`} />
                    <span className={`text-[10px] capitalize role-${u.role}-text`}>{u.role}</span>
                    {u.last_login && (
                      <span className="text-[10px] text-white/20 ml-2">
                        Last login: {new Date(u.last_login).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                {u.id !== me?.id && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Edit ${u.display_name}`}
                      onClick={() => {
                        setEditingId(editingId === u.id ? null : u.id)
                        setForm({ username: u.username, display_name: u.display_name, password: '', role: u.role })
                      }}
                      className="btn-ghost p-1.5"
                    ><Pencil size={13} /></button>
                    <button
                      type="button"
                      aria-label={`Delete ${u.display_name}`}
                      onClick={() => { if (confirm(`Delete ${u.display_name}?`)) deleteMutation.mutate(u.id) }}
                      className="btn-danger p-1.5"
                    ><Trash2 size={13} /></button>
                  </div>
                )}
              </GlassCard>

              {/* Inline edit */}
              {editingId === u.id && (
                <div className="mt-1 ml-3 p-4 rounded-lg bg-white/[0.03] border border-glass-border space-y-3">
                  <UserForm form={form} setForm={setForm} prefix={`edit-${u.id}`} />
                  <label className="flex items-center gap-2 text-sm text-white/60">
                    <input type="checkbox" checked={!u.is_active}
                      onChange={() => updateMutation.mutate({ id: u.id, body: { is_active: !u.is_active } })}
                      className="rounded" />
                    Disable account
                  </label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => updateMutation.mutate({ id: u.id, body: form })}
                      disabled={updateMutation.isPending} className="btn-primary text-sm">
                      {updateMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="btn-ghost text-sm">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UserForm({ form, setForm, showUsername = false, prefix = 'uf' }: {
  form: any; setForm: any; showUsername?: boolean; prefix?: string
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {showUsername && (
        <div>
          <label htmlFor={`${prefix}-username`} className="text-[10px] text-white/40 block mb-1">Username</label>
          <input id={`${prefix}-username`} className="glass-input w-full text-sm" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="username" />
        </div>
      )}
      <div>
        <label htmlFor={`${prefix}-display-name`} className="text-[10px] text-white/40 block mb-1">Display name</label>
        <input id={`${prefix}-display-name`} className="glass-input w-full text-sm" value={form.display_name}
          onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Display name" />
      </div>
      <div>
        <label htmlFor={`${prefix}-password`} className="text-[10px] text-white/40 block mb-1">Password {!showUsername && '(leave blank to keep)'}</label>
        <input id={`${prefix}-password`} className="glass-input w-full text-sm" type="password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" />
      </div>
      <div>
        <label htmlFor={`${prefix}-role`} className="text-[10px] text-white/40 block mb-1">Role</label>
        <select id={`${prefix}-role`} aria-label="Role" className="glass-input w-full text-sm" value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="viewer" className="bg-surface-overlay">Viewer</option>
          <option value="editor" className="bg-surface-overlay">Editor</option>
          <option value="admin" className="bg-surface-overlay">Admin</option>
        </select>
      </div>
    </div>
  )
}
