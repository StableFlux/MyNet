import { useState, useEffect, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronDown, Router, CheckCircle, XCircle, Loader, Save, FlaskConical, Settings, RefreshCw, AlertTriangle, AlertCircle, Trash2, CheckSquare, Square, Plus, Copy, Check, Send, X } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import api from '../lib/api'

const COMP_STATUS: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  match:       { label: 'Match',        className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle },
  differences: { label: 'Differences', className: 'text-amber-400  bg-amber-500/10  border-amber-500/20',   icon: AlertTriangle },
  mynet_only:  { label: 'MyNet only',   className: 'text-amber-400  bg-amber-500/10  border-amber-500/20',   icon: AlertTriangle },
  unifi_only:  { label: 'UniFi only',   className: 'text-blue-400   bg-blue-500/10   border-blue-500/20',    icon: AlertCircle },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = COMP_STATUS[status] ?? COMP_STATUS.match
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${cfg.className}`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  )
}

function SummaryBar({ rows, activeKeys }: { rows: any[]; activeKeys?: Set<string> }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.06] flex-wrap">
      {Object.entries(COMP_STATUS).map(([key, cfg]) => {
        if (activeKeys && !activeKeys.has(key)) return null
        const count = rows.filter((r: any) => r.status === key).length
        if (count === 0) return null
        const Icon = cfg.icon
        return (
          <div key={key} className="flex items-center gap-1.5">
            <Icon size={11} className={cfg.className.split(' ')[0]} />
            <span className="text-xs text-white/50">{count} {cfg.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function UnifiSettings() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: saved, isLoading } = useQuery({
    queryKey: ['unifi-settings'],
    queryFn: async () => { const { data } = await api.get('/unifi/settings'); return data },
  })

  const [authType, setAuthType] = useState<'api_key' | 'credentials'>('api_key')
  const [form, setForm] = useState({ host: '', api_key: '', username: '', password: '' })
  const [writeEnabled, setWriteEnabled] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const [compView, setCompView] = useState<'networks' | 'devices'>(() => {
    return (localStorage.getItem('unifi_comp_view') as 'networks' | 'devices') ?? 'devices'
  })
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [confirmDeleteMac, setConfirmDeleteMac] = useState<string | null>(null)
  const [confirmDeleteNetworkId, setConfirmDeleteNetworkId] = useState<string | null>(null)
  const [confirmDeleteMyNetNetworkId, setConfirmDeleteMyNetNetworkId] = useState<number | null>(null)
  const [copiedMac, setCopiedMac] = useState<string | null>(null)
  const [copiedIp, setCopiedIp] = useState<string | null>(null)
  const [devStatusFilter, setDevStatusFilter] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('unifi_dev_status_filter')
      return stored ? new Set(JSON.parse(stored)) : new Set(['in_service'])
    } catch { return new Set(['in_service']) }
  })
  const [compStatusFilter, setCompStatusFilter] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('unifi_comp_status_filter')
      return stored ? new Set(JSON.parse(stored)) : new Set(['match', 'differences', 'mynet_only', 'unifi_only'])
    } catch { return new Set(['match', 'differences', 'mynet_only', 'unifi_only']) }
  })

  useEffect(() => { localStorage.setItem('unifi_comp_view', compView) }, [compView])
  useEffect(() => { localStorage.setItem('unifi_dev_status_filter', JSON.stringify([...devStatusFilter])) }, [devStatusFilter])
  useEffect(() => { localStorage.setItem('unifi_comp_status_filter', JSON.stringify([...compStatusFilter])) }, [compStatusFilter])

  function toggleFilter(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const { data: comparison, isFetching: compFetching, refetch: refetchComparison } = useQuery({
    queryKey: ['unifi-comparison'],
    queryFn: async () => { const { data } = await api.get('/unifi/comparison'); return data },
    enabled: false,
    retry: false,
  })

  const deleteMutation = useMutation({
    mutationFn: (mac: string) => api.delete(`/unifi/clients/${encodeURIComponent(mac)}`),
    onSuccess: () => { setConfirmDeleteMac(null); refetchComparison() },
    onError: () => setConfirmDeleteMac(null),
  })

  const [addToUnifiRow, setAddToUnifiRow] = useState<any | null>(null)
  const [addForm, setAddForm] = useState({ name: '', fixed_ip: '', network_id: '', note: '' })

  function openAddToUnifi(row: any) {
    setAddForm({
      name:       row.mynet_device_name ?? '',
      fixed_ip:   row.mynet_ip && row.mynet_ip !== 'DHCP' ? row.mynet_ip : '',
      network_id: '',
      note:       '',
    })
    setAddToUnifiRow(row)
    addToUnifiMutation.reset()
  }

  const addToUnifiMutation = useMutation({
    mutationFn: (payload: { mac: string; name?: string; fixed_ip?: string; network_id?: string; note?: string }) =>
      api.post('/unifi/clients', payload),
    onSuccess: () => {
      setAddToUnifiRow(null)
      refetchComparison()
    },
  })

  const [syncingKey, setSyncingKey] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [expandedMobNet, setExpandedMobNet] = useState<string | null>(null)
  const [expandedMobGrp, setExpandedMobGrp] = useState<string | null>(null)
  const [expandedMobNic, setExpandedMobNic] = useState<string | null>(null)
  const [deviceSearch, setDeviceSearch] = useState('')

  function toggleExpandedRow(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const syncToUnifiMutation = useMutation({
    mutationFn: ({ mac, field, value }: { mac: string; field: string; value: string }) =>
      api.patch(`/unifi/clients/${encodeURIComponent(mac)}/fields`, { field, value }),
    onSettled: () => { setSyncingKey(null); refetchComparison() },
  })

  const syncToMyNetMutation = useMutation({
    mutationFn: ({ nicId, field, value }: { nicId: number; field: string; value: string }) =>
      api.patch(`/unifi/mynet/nics/${nicId}/fields`, { field, value }),
    onSettled: () => { setSyncingKey(null); refetchComparison() },
  })

  const syncDeviceToMyNetMutation = useMutation({
    mutationFn: ({ deviceId, field, value }: { deviceId: number; field: string; value: string }) =>
      api.patch(`/unifi/mynet/devices/${deviceId}/fields`, { field, value }),
    onSettled: () => { setSyncingKey(null); refetchComparison() },
  })

  const deleteNetworkMutation = useMutation({
    mutationFn: (unifiNetworkId: string) => api.delete(`/unifi/networks/${encodeURIComponent(unifiNetworkId)}`),
    onSuccess: () => { setConfirmDeleteNetworkId(null); refetchComparison() },
    onError: () => setConfirmDeleteNetworkId(null),
  })

  const deleteMyNetNetworkMutation = useMutation({
    mutationFn: (networkId: number) => api.delete(`/networks/${networkId}`),
    onSuccess: () => { setConfirmDeleteMyNetNetworkId(null); refetchComparison() },
    onError: () => setConfirmDeleteMyNetNetworkId(null),
  })

  const addNetworkToUnifiMutation = useMutation({
    mutationFn: (payload: { name: string; vlan_id: number; gateway?: string; cidr?: string; dhcp_start?: string; dhcp_end?: string }) =>
      api.post('/unifi/networks', payload),
    onSuccess: () => refetchComparison(),
  })

  const syncNetworkToMyNetMutation = useMutation({
    mutationFn: ({ networkId, fields }: { networkId: number; fields: Record<string, string | number> }) =>
      api.patch(`/unifi/mynet/networks/${networkId}/fields`, { fields }),
    onSettled: () => { setSyncingKey(null); refetchComparison() },
  })

  const syncNetworkToUnifiMutation = useMutation({
    mutationFn: ({ unifiNetworkId, fields }: { unifiNetworkId: string; fields: Record<string, string | number> }) =>
      api.patch(`/unifi/networks/${encodeURIComponent(unifiNetworkId)}/fields`, { fields }),
    onSettled: () => { setSyncingKey(null); refetchComparison() },
  })

  function SyncBtn({ label, syncKey, onClick, title, variant = 'unifi', writeGuarded = false }: { label: string; syncKey: string; onClick: () => void; title?: string; variant?: 'unifi' | 'mynet'; writeGuarded?: boolean }) {
    const loading = syncingKey === syncKey
    const isDisabled = loading || syncingKey !== null || (writeGuarded && !canWrite)
    const cls = variant === 'mynet'
      ? "inline-flex items-center justify-center gap-0.5 w-16 py-0.5 rounded text-[10px] font-medium text-[#3ea99e] bg-[#3ea99e]/10 border border-[#3ea99e]/30 hover:bg-[#3ea99e]/20 hover:border-[#3ea99e]/50 hover:text-[#5bbfb5] transition-colors disabled:opacity-40"
      : "inline-flex items-center justify-center gap-0.5 w-16 py-0.5 rounded text-[10px] font-medium text-indigo-300 bg-indigo-500/20 border border-indigo-500/40 hover:bg-indigo-500/30 hover:border-indigo-400/60 hover:text-indigo-200 transition-colors disabled:opacity-40"
    return (
      <button
        type="button"
        title={writeGuarded && !canWrite ? 'Enable write access to UniFi in settings to use this' : title}
        onClick={() => { setSyncingKey(syncKey); onClick() }}
        disabled={isDisabled}
        className={cls}
      >
        {loading ? <Loader size={7} className="animate-spin" /> : null}
        {label}
      </button>
    )
  }

  // Group device rows by MyNet device; UniFi-only rows each become their own group.
  // Sorted alphabetically; filters applied for device status and comparison status.
  const filteredDeviceGroups = useMemo(() => {
    if (!comparison?.devices) return []

    const groups: { groupKey: string; deviceId: number | null; deviceName: string | null; nics: any[] }[] = []
    const seen = new Map<string, number>()

    comparison.devices.forEach((row: any, i: number) => {
      const gk = row.mynet_device_id != null
        ? `mynet-${row.mynet_device_id}`
        : `unifi-${i}-${row.unifi?.mac}`
      if (seen.has(gk)) {
        groups[seen.get(gk)!].nics.push(row)
      } else {
        seen.set(gk, groups.length)
        groups.push({
          groupKey: gk,
          deviceId: row.mynet_device_id ?? null,
          deviceName: row.mynet_device_name ?? null,
          nics: [row],
        })
      }
    })

    groups.sort((a, b) => (a.deviceName ?? '').localeCompare(b.deviceName ?? ''))

    const q = deviceSearch.trim().toLowerCase()

    return groups.filter(group => {
      if (group.deviceId !== null) {
        const devStatus = group.nics[0]?.mynet_device_status
        if (devStatus && !devStatusFilter.has(devStatus)) return false
      }
      if (!group.nics.some(nic => compStatusFilter.has(nic.status))) return false
      if (q) {
        const searchable = [
          group.deviceName,
          ...group.nics.flatMap((n: any) => [
            n.unifi?.name, n.unifi?.mac, n.unifi?.ip, n.unifi?.hostname, n.unifi?.local_dns,
            n.mynet_mac, n.mynet_ip, n.mynet_hostname, n.mynet_dns_entry, n.mynet_nic_label,
          ]),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!searchable.includes(q)) return false
      }
      return true
    })
  }, [comparison?.devices, devStatusFilter, compStatusFilter, deviceSearch])

  const PLACEHOLDER = '••••••••••••••••'

  useEffect(() => {
    if (saved) {
      setAuthType(saved.auth_type === 'credentials' ? 'credentials' : 'api_key')
      setWriteEnabled(!!saved.write_enabled)
      setForm(f => ({
        ...f,
        host:     saved.host ?? '',
        api_key:  saved.api_key_set  ? PLACEHOLDER : '',
        username: saved.username ?? '',
        password: saved.password_set ? PLACEHOLDER : '',
      }))
    }
  }, [saved])

  function update(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    setDirty(true)
    setTestResult(null)
  }

  function switchAuthType(type: 'api_key' | 'credentials') {
    setAuthType(type)
    setDirty(true)
    setTestResult(null)
  }

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/unifi/settings', {
      host:          form.host,
      auth_type:     authType,
      api_key:       authType === 'api_key'      ? (form.api_key  === PLACEHOLDER ? null : form.api_key)  : undefined,
      username:      authType === 'credentials'  ? form.username  : undefined,
      password:      authType === 'credentials'  ? (form.password === PLACEHOLDER ? null : form.password) : undefined,
      write_enabled: writeEnabled,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unifi-settings'] })
      setDirty(false)
      setShowConfig(false)
    },
  })

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const body: any = { host: form.host, auth_type: authType }
      if (authType === 'api_key') {
        body.api_key = (form.api_key === PLACEHOLDER || !form.api_key) ? null : form.api_key
      } else {
        body.username = form.username
        body.password = (form.password === PLACEHOLDER || !form.password) ? null : form.password
      }
      const { data } = await api.post('/unifi/test', body)
      if (data.ok) {
        const parts: string[] = []
        if (data.client_count != null) parts.push(`${data.client_count} clients`)
        setTestResult({
          ok: true,
          message: `Connected — ${data.site_name ?? 'default site'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`,
        })
      } else {
        setTestResult({ ok: false, message: data.error ?? 'Connection failed' })
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.response?.data?.detail ?? 'Request failed' })
    } finally {
      setTesting(false)
    }
  }

  if (isLoading) return null

  const configured = !!(saved?.host && (
    saved.auth_type === 'credentials' ? (saved.username && saved.password_set) : saved.api_key_set
  ))
  const canWrite = configured && !!saved?.write_enabled

  const canTest = authType === 'api_key'
    ? !!(form.host && (form.api_key || saved?.api_key_set))
    : !!(form.host && form.username && (form.password || saved?.password_set))

  const configPanel = (
    <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
      <GlassCard className="sm:w-2/5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
            <Router size={16} className="text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Controller Connection</p>
            <p className="text-xs text-white/40 mt-0.5">Local UniFi controller — HTTPS, no SSL verification.</p>
          </div>
        </div>

        {/* Auth type toggle */}
        <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
          {(['api_key', 'credentials'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => switchAuthType(type)}
              className={`flex-1 py-1.5 font-medium transition-colors ${
                authType === type
                  ? 'bg-indigo-600/40 text-white'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              {type === 'api_key' ? 'API Key' : 'Username & Password'}
            </button>
          ))}
        </div>

        {/* Controller IP — always shown */}
        <div>
          <label htmlFor="unifi-host" className="text-[10px] text-white/40 block mb-1">Controller IP Address</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/30 font-mono flex-shrink-0">https://</span>
            <input
              id="unifi-host"
              className="glass-input flex-1 text-sm font-mono"
              value={form.host}
              onChange={e => update('host', e.target.value)}
              placeholder="192.168.1.1"
            />
          </div>
        </div>

        {/* Auth fields */}
        {authType === 'api_key' ? (
          <div>
            <label htmlFor="unifi-api-key" className="text-[10px] text-white/40 block mb-1">API Key</label>
            <input
              id="unifi-api-key"
              className="glass-input w-full text-sm font-mono"
              type="password"
              value={form.api_key}
              onChange={e => update('api_key', e.target.value)}
              placeholder={saved?.api_key_set ? 'Leave blank to keep existing key' : 'Paste API key here'}
              autoComplete="off"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="unifi-username" className="text-[10px] text-white/40 block mb-1">Username</label>
              <input
                id="unifi-username"
                className="glass-input w-full text-sm"
                value={form.username}
                onChange={e => update('username', e.target.value)}
                placeholder="mynet"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="unifi-password" className="text-[10px] text-white/40 block mb-1">Password</label>
              <input
                id="unifi-password"
                className="glass-input w-full text-sm"
                type="password"
                value={form.password}
                onChange={e => update('password', e.target.value)}
                placeholder={saved?.password_set ? 'Leave blank to keep existing' : 'Password'}
                autoComplete="new-password"
              />
            </div>
          </div>
        )}

        {testResult && (
          <div className={`flex items-center justify-center gap-2 text-sm ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {testResult.ok ? <CheckCircle size={14} className="flex-shrink-0" /> : <XCircle size={14} className="flex-shrink-0" />}
            {testResult.message}
          </div>
        )}

        <button
          type="button"
          onClick={() => { setWriteEnabled(v => !v); setDirty(true) }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
        >
          {writeEnabled
            ? <CheckSquare size={14} className="text-indigo-400 flex-shrink-0" />
            : <Square size={14} className="text-white/30 flex-shrink-0" />}
          <div>
            <p className="text-xs font-medium text-white/80">Enable write access to UniFi</p>
            <p className="text-[10px] text-white/40 mt-0.5">When unchecked, the integration is read-only — sync buttons will be disabled.</p>
          </div>
        </button>

        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !canTest}
            className="btn-ghost flex items-center gap-2 text-sm disabled:opacity-40"
          >
            {testing ? <><Loader size={14} className="animate-spin" /> Testing…</> : <><FlaskConical size={14} /> Test Connection</>}
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || (!dirty && !form.host)}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
          >
            <Save size={14} />
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {saveMutation.isError && (
          <p className="text-xs text-red-400 text-center">{(saveMutation.error as any)?.response?.data?.detail ?? 'Save failed'}</p>
        )}
      </GlassCard>

      {/* How to connect — changes based on authType */}
      <GlassCard className="sm:w-3/5">
        <div className="flex flex-col sm:flex-row gap-5 sm:gap-6">
          <div className="flex-1 space-y-4">
            {authType === 'api_key' ? (
              <div>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">How to connect — API Key</p>
                <ol className="text-xs text-white/60 space-y-2 list-decimal list-inside">
                  <li>Enter the <span className="text-white/80 font-medium">IP address</span> of your UniFi controller (UDM, CloudKey Gen2+, or self-hosted Network Application).</li>
                  <li>In your UniFi console go to <span className="text-white/80 font-medium">Settings → Admins &amp; Users → Admins</span> and scroll to the <span className="text-white/80 font-medium">API Keys</span> section.</li>
                  <li>Click <span className="text-white/80 font-medium">Create API Key</span>, give it a name such as <span className="font-mono text-white/70">MyNet</span>, and copy the key — it is only shown once.</li>
                  <li>Paste the key above and click <span className="text-white/80 font-medium">Test Connection</span>, then <span className="text-white/80 font-medium">Save</span>.</li>
                </ol>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">How to connect — Username &amp; Password</p>
                <ol className="text-xs text-white/60 space-y-2 list-decimal list-inside">
                  <li>Enter the <span className="text-white/80 font-medium">IP address</span> of your UniFi controller.</li>
                  <li>In your UniFi console go to <span className="text-white/80 font-medium">Settings → Admins &amp; Users → Admins</span> and click <span className="text-white/80 font-medium">Add Admin</span>.</li>
                  <li>Create a new admin named <span className="font-mono text-white/70">mynet</span> (or similar) with a strong password. Assign a role appropriate to the level of access you want MyNet to have — see the limitations note opposite.</li>
                  <li>Use that username and password above — <span className="text-white/80 font-medium">do not use your personal admin credentials.</span></li>
                  <li>Click <span className="text-white/80 font-medium">Test Connection</span> to verify, then <span className="text-white/80 font-medium">Save</span>.</li>
                </ol>
              </div>
            )}
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                {authType === 'api_key' ? 'API Key — limitations' : 'Username & Password — limitations'}
              </p>
              {authType === 'api_key' ? (
                <ul className="text-xs text-white/60 space-y-1.5">
                  <li><span className="text-amber-400/80 font-medium">Active clients only</span> — the Integration API only returns currently-connected devices. Devices offline for an extended period will appear as "MyNet only" in the comparison.</li>
                  <li><span className="text-white/80 font-medium">Requires UniFi Network Application 8.1+</span> or <span className="text-white/80 font-medium">UniFi OS 3.x+</span> — older versions do not support API keys.</li>
                  <li><span className="text-emerald-400/80 font-medium">Most secure option</span> — no password stored; the key can be revoked independently at any time.</li>
                </ul>
              ) : (
                <ul className="text-xs text-white/60 space-y-1.5">
                  <li><span className="text-emerald-400/80 font-medium">Full client history</span> — accesses the legacy API which returns all devices seen in the past 30–90 days, giving a complete comparison.</li>
                  <li><span className="text-amber-400/80 font-medium">Works on all UniFi OS versions</span> — no minimum version requirement.</li>
                  <li><span className="text-amber-400/80 font-medium">Avoid using your personal admin account</span> — create a dedicated <span className="font-mono text-white/60">mynet</span> user so access can be revoked without affecting your own login.</li>
                  <li><span className="text-white/80 font-medium">Role determines capability:</span> <span className="font-medium text-emerald-400/80">Read Only</span> limits MyNet to viewing data only. <span className="font-medium text-amber-400/80">Site Admin</span> will allow MyNet to make changes to UniFi — only assign this if you intend to use write features.</li>
                </ul>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Security &amp; Privacy</p>
              <ul className="text-xs text-white/60 space-y-1">
                <li>Credentials are <span className="text-white/80 font-medium">stored encrypted</span> at rest and never returned to the browser after saving.</li>
                <li>What MyNet can do in UniFi depends on the role assigned to the user — <span className="text-white/80 font-medium">Read Only</span> restricts to viewing data; <span className="text-white/80 font-medium">Site Admin</span> permits changes.</li>
                <li><span className="text-white/80 font-medium">Local network only</span> — by design, only controllers reachable on your local network are supported.</li>
              </ul>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  )

  return (
    <>
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <button type="button" onClick={() => navigate('/settings')} className="btn-ghost flex items-center gap-1.5 text-sm flex-shrink-0">
            <ChevronLeft size={14} />
            Settings
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white">UniFi Integration</h1>
            <p className="text-sm text-white/40 mt-0.5">Connect MyNet to your local UniFi controller.</p>
          </div>
        </div>
        {configured && (
          <div className="flex items-center gap-3">
            <GlassCard className="flex-1 sm:flex-none sm:w-64 flex items-center gap-3 py-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
                <Router size={15} className="text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white font-mono truncate">{saved.host}</p>
                <p className="text-xs text-white/40">
                  {saved.auth_type === 'credentials'
                    ? `Username & password · ${saved.username}`
                    : 'HTTPS · API key'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                <span className="text-xs text-emerald-400 font-medium">Configured</span>
                <span className={`text-[10px] font-medium ${canWrite ? 'text-indigo-400' : 'text-white/30'}`}>{canWrite ? 'Read & write' : 'Read only'}</span>
              </div>
            </GlassCard>
            <button
              type="button"
              onClick={() => { setShowConfig(v => !v); setTestResult(null) }}
              className="btn-ghost flex items-center gap-2 text-sm flex-shrink-0"
            >
              <Settings size={14} />
              {showConfig ? 'Hide' : 'Configure'}
            </button>
          </div>
        )}
      </div>

      {(!configured || showConfig) && configPanel}

      {configured && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Network &amp; Device Reconciliation</h2>
                <p className="text-xs text-white/40 mt-0.5">Cross-references MyNet records against UniFi.</p>
              </div>
              <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs self-start sm:self-auto">
                {(['networks', 'devices'] as const).map(view => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => setCompView(view)}
                    className={`px-3 py-1.5 font-medium capitalize transition-colors ${
                      compView === view
                        ? 'bg-indigo-600/40 text-white'
                        : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                    }`}
                  >
                    {view}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => refetchComparison()}
              disabled={compFetching}
              className="btn-ghost flex items-center gap-2 text-sm self-start sm:self-auto"
            >
              <RefreshCw size={13} className={compFetching ? 'animate-spin' : ''} />
              {compFetching ? 'Fetching…' : 'Fetch comparison'}
            </button>
          </div>

          {comparison && comparison.status !== 'unconfigured' && (
            <>
              {/* ── Networks table ─────────────────────────────────── */}
              {compView === 'networks' && <div className="space-y-2">
                <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Networks</h3>
                <GlassCard className="p-0 overflow-hidden">
                  <SummaryBar rows={comparison.networks} />
                  {/* Mobile: expandable network cards */}
                  <div className="sm:hidden divide-y divide-white/[0.04]">
                    {comparison.networks.map((row: any) => {
                      const mobNetKey = `mob-net-${row.row_key}`
                      const isExpanded = expandedMobNet === mobNetKey
                      const diffs = new Set(row.differences ?? [])
                      const dhcpDiff = diffs.has('dhcp_start') || diffs.has('dhcp_end')
                      const subnetDiff = diffs.has('cidr') || diffs.has('gateway')
                      const unifiDhcp = (row.unifi_dhcp_start || row.unifi_dhcp_end) ? `${row.unifi_dhcp_start ?? '–'} – ${row.unifi_dhcp_end ?? '–'}` : null
                      const mynetDhcp = (row.mynet_dhcp_start || row.mynet_dhcp_end) ? `${row.mynet_dhcp_start ?? '–'} – ${row.mynet_dhcp_end ?? '–'}` : null
                      const mynetSubnetFields = {
                        ...(row.mynet_cidr       ? { cidr:       row.mynet_cidr }       : {}),
                        ...(row.mynet_gateway    ? { gateway:    row.mynet_gateway }    : {}),
                        ...(row.mynet_dhcp_start ? { dhcp_start: row.mynet_dhcp_start } : {}),
                        ...(row.mynet_dhcp_end   ? { dhcp_end:   row.mynet_dhcp_end }   : {}),
                      }
                      const unifiSubnetFields = {
                        ...(row.unifi_cidr       ? { cidr:       row.unifi_cidr }       : {}),
                        ...(row.unifi_gateway    ? { gateway:    row.unifi_gateway }    : {}),
                        ...(row.unifi_dhcp_start ? { dhcp_start: row.unifi_dhcp_start } : {}),
                        ...(row.unifi_dhcp_end   ? { dhcp_end:   row.unifi_dhcp_end }   : {}),
                      }
                      const uid = row.unifi_network_id
                      const mid = row.mynet_network_id
                      const f = (v: any, diff: boolean) => v
                        ? <span className={diff ? 'text-amber-400 font-medium' : 'text-white/60'}>{v}</span>
                        : <span className="text-white/20">—</span>
                      return (
                        <div key={row.row_key}>
                          <button type="button" onClick={() => setExpandedMobNet(prev => prev === mobNetKey ? null : mobNetKey)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors">
                            <span className="font-mono text-xs text-white/40 w-10 flex-shrink-0">{row.vlan_id ?? '—'}</span>
                            <span className="flex-1 text-sm text-white/80 truncate">{row.unifi_name ?? row.mynet_name ?? '—'}</span>
                            <StatusBadge status={row.status} />
                            <ChevronDown size={13} className={`text-white/20 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 border-t border-white/[0.05] space-y-3">
                              {/* UniFi vs MyNet two-column comparison */}
                              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                                <div className="space-y-2">
                                  <p className="text-[10px] font-semibold text-indigo-400/70 uppercase tracking-wider">UniFi</p>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">VLAN</p>{f(row.unifi_vlan_id, diffs.has('vlan_id'))}</div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">Name</p>{f(row.unifi_name, diffs.has('name'))}</div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">CIDR</p><span className="font-mono">{f(row.unifi_cidr, diffs.has('cidr'))}</span></div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">Gateway</p><span className="font-mono">{f(row.unifi_gateway, diffs.has('gateway'))}</span></div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">DHCP Range</p><span className="font-mono text-[10px]">{f(unifiDhcp, dhcpDiff)}</span></div>
                                </div>
                                <div className="space-y-2">
                                  <p className="text-[10px] font-semibold text-[#3ea99e]/70 uppercase tracking-wider">MyNet</p>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">VLAN</p>{f(row.mynet_vlan_id, diffs.has('vlan_id'))}</div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">Name</p>{f(row.mynet_name, diffs.has('name'))}</div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">CIDR</p><span className="font-mono">{f(row.mynet_cidr, diffs.has('cidr'))}</span></div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">Gateway</p><span className="font-mono">{f(row.mynet_gateway, diffs.has('gateway'))}</span></div>
                                  <div><p className="text-[10px] text-white/30 mb-0.5">DHCP Range</p><span className="font-mono text-[10px]">{f(mynetDhcp, dhcpDiff)}</span></div>
                                </div>
                              </div>
                              {/* Actions */}
                              {row.status !== 'match' && (
                                <div className="pt-2.5 border-t border-white/[0.05] flex flex-wrap gap-2">
                                  {diffs.has('name') && row.mynet_name && uid && <SyncBtn label="Name→UniFi" variant="mynet" writeGuarded title={`Set UniFi name to "${row.mynet_name}"`} syncKey={`unifi-net-name-${row.row_key}`} onClick={() => syncNetworkToUnifiMutation.mutate({ unifiNetworkId: uid, fields: { name: row.mynet_name } })} />}
                                  {diffs.has('name') && row.unifi_name && mid && <SyncBtn label="Name→MyNet" title={`Set MyNet name to "${row.unifi_name}"`} syncKey={`mynet-net-name-${row.row_key}`} onClick={() => syncNetworkToMyNetMutation.mutate({ networkId: mid, fields: { name: row.unifi_name } })} />}
                                  {subnetDiff && uid && Object.keys(mynetSubnetFields).length > 0 && <SyncBtn label="Subnet→UniFi" variant="mynet" writeGuarded title="Update UniFi subnet to MyNet values" syncKey={`unifi-net-subnet-${row.row_key}`} onClick={() => syncNetworkToUnifiMutation.mutate({ unifiNetworkId: uid, fields: mynetSubnetFields })} />}
                                  {subnetDiff && mid && Object.keys(unifiSubnetFields).length > 0 && <SyncBtn label="Subnet→MyNet" title="Update MyNet subnet to UniFi values" syncKey={`mynet-net-subnet-${row.row_key}`} onClick={() => syncNetworkToMyNetMutation.mutate({ networkId: mid, fields: unifiSubnetFields })} />}
                                  {dhcpDiff && !subnetDiff && uid && (row.mynet_dhcp_start || row.mynet_dhcp_end) && <SyncBtn label="DHCP→UniFi" variant="mynet" writeGuarded title="Update UniFi DHCP to MyNet values" syncKey={`unifi-net-dhcp-${row.row_key}`} onClick={() => syncNetworkToUnifiMutation.mutate({ unifiNetworkId: uid, fields: { ...(row.mynet_dhcp_start ? { dhcp_start: row.mynet_dhcp_start } : {}), ...(row.mynet_dhcp_end ? { dhcp_end: row.mynet_dhcp_end } : {}) } })} />}
                                  {dhcpDiff && !subnetDiff && mid && (row.unifi_dhcp_start || row.unifi_dhcp_end) && <SyncBtn label="DHCP→MyNet" title="Update MyNet DHCP to UniFi values" syncKey={`mynet-net-dhcp-${row.row_key}`} onClick={() => syncNetworkToMyNetMutation.mutate({ networkId: mid, fields: { ...(row.unifi_dhcp_start ? { dhcp_start: row.unifi_dhcp_start } : {}), ...(row.unifi_dhcp_end ? { dhcp_end: row.unifi_dhcp_end } : {}) } })} />}
                                  {row.status === 'unifi_only' && (() => {
                                    const isConfirming = confirmDeleteNetworkId === uid
                                    const isDeleting = deleteNetworkMutation.isPending && confirmDeleteNetworkId === uid
                                    return (
                                      <>
                                        <button type="button" onClick={() => { const p = new URLSearchParams(); if (row.unifi_name) p.set('name', row.unifi_name); if (row.unifi_vlan_id) p.set('vlan_id', String(row.unifi_vlan_id)); if (row.unifi_cidr) p.set('cidr', row.unifi_cidr); if (row.unifi_gateway) p.set('gateway', row.unifi_gateway); navigate(`/networks/new?${p.toString()}`) }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"><Plus size={9} />Add to MyNet</button>
                                        {isConfirming ? (
                                          <div className="flex items-center gap-1">
                                            <button type="button" onClick={() => deleteNetworkMutation.mutate(uid)} disabled={isDeleting} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 transition-colors disabled:opacity-50">{isDeleting ? <Loader size={9} className="animate-spin" /> : <Trash2 size={9} />}{isDeleting ? 'Deleting…' : 'Confirm'}</button>
                                            <button type="button" onClick={() => { deleteNetworkMutation.reset(); setConfirmDeleteNetworkId(null) }} className="px-1.5 py-1 rounded text-[10px] text-white/30 hover:text-white/50">Cancel</button>
                                          </div>
                                        ) : (
                                          <button type="button" onClick={() => { deleteNetworkMutation.reset(); setConfirmDeleteNetworkId(uid) }} disabled={!canWrite} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40"><Trash2 size={9} />Delete from UniFi</button>
                                        )}
                                      </>
                                    )
                                  })()}
                                  {row.status === 'mynet_only' && (() => {
                                    const isConfirming = confirmDeleteMyNetNetworkId === mid
                                    const isDeleting = deleteMyNetNetworkMutation.isPending && confirmDeleteMyNetNetworkId === mid
                                    return (
                                      <>
                                        <button type="button" onClick={() => addNetworkToUnifiMutation.mutate({ name: row.mynet_name, vlan_id: row.mynet_vlan_id, gateway: row.mynet_gateway ?? undefined, cidr: row.mynet_cidr ?? undefined, dhcp_start: row.mynet_dhcp_start ?? undefined, dhcp_end: row.mynet_dhcp_end ?? undefined })} disabled={addNetworkToUnifiMutation.isPending || !canWrite} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors disabled:opacity-40"><Send size={9} />Add to UniFi</button>
                                        {isConfirming ? (
                                          <div className="flex items-center gap-1">
                                            <button type="button" onClick={() => deleteMyNetNetworkMutation.mutate(mid)} disabled={isDeleting} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 transition-colors disabled:opacity-50">{isDeleting ? <Loader size={9} className="animate-spin" /> : <Trash2 size={9} />}{isDeleting ? 'Deleting…' : 'Confirm'}</button>
                                            <button type="button" onClick={() => { deleteMyNetNetworkMutation.reset(); setConfirmDeleteMyNetNetworkId(null) }} className="px-1.5 py-1 rounded text-[10px] text-white/30 hover:text-white/50">Cancel</button>
                                          </div>
                                        ) : (
                                          <button type="button" onClick={() => { deleteMyNetNetworkMutation.reset(); setConfirmDeleteMyNetNetworkId(mid) }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"><Trash2 size={9} />Delete from MyNet</button>
                                        )}
                                      </>
                                    )
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          <th className="text-left px-4 py-2 text-white/30 font-medium w-36">VLAN</th>
                          <th className="text-left px-3 py-2 text-white/30 font-medium w-16">Source</th>
                          <th className="text-left px-4 py-2 text-white/30 font-medium">Name</th>
                          <th className="text-left px-4 py-2 text-white/30 font-medium w-52">CIDR</th>
                          <th className="text-left px-4 py-2 text-white/30 font-medium w-52">Gateway</th>
                          <th className="text-left px-4 py-2 text-white/30 font-medium w-80">DHCP Range</th>
                          <th className="text-left px-4 py-2 text-white/30 font-medium">Status</th>
                          <th className="text-left px-4 py-2 text-white/30 font-medium w-px whitespace-nowrap">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.networks.map((row: any) => {
                          const diffs = new Set(row.differences ?? [])
                          const dhcpDiff = diffs.has('dhcp_start') || diffs.has('dhcp_end')
                          const subnetDiff = diffs.has('cidr') || diffs.has('gateway')
                          // DHCP shown inline only when subnet already matches; otherwise bundled into the subnet action
                          const dhcpInline = dhcpDiff && !subnetDiff

                          const val = (v: string | null, diff: boolean) => v
                            ? <span className={diff ? 'text-amber-400 font-medium' : 'text-white/60'}>{v}</span>
                            : <span className="text-white/20">—</span>
                          const unifiDhcp = row.unifi_dhcp_start || row.unifi_dhcp_end ? `${row.unifi_dhcp_start ?? '–'} – ${row.unifi_dhcp_end ?? '–'}` : null
                          const mynetDhcp = row.mynet_dhcp_start || row.mynet_dhcp_end ? `${row.mynet_dhcp_start ?? '–'} – ${row.mynet_dhcp_end ?? '–'}` : null
                          const rowKey = `net-${row.row_key}`
                          const hovered = hoveredRow === rowKey
                          const hoverProps = { onMouseEnter: () => setHoveredRow(rowKey), onMouseLeave: () => setHoveredRow(null) }
                          const vlanDiff = diffs.has('vlan_id')

                          const netCell = (value: string | null, diff: boolean, btn: React.ReactNode) => (
                            <div className="flex items-center justify-between gap-1.5">
                              {val(value, diff)}
                              {diff ? btn : <span />}
                            </div>
                          )

                          // Combined subnet fields for the Actions column (cidr + gateway + dhcp)
                          const mynetSubnetFields = {
                            ...(row.mynet_cidr    ? { cidr: row.mynet_cidr }             : {}),
                            ...(row.mynet_gateway ? { gateway: row.mynet_gateway }        : {}),
                            ...(row.mynet_dhcp_start ? { dhcp_start: row.mynet_dhcp_start } : {}),
                            ...(row.mynet_dhcp_end   ? { dhcp_end:   row.mynet_dhcp_end   } : {}),
                          }
                          const unifiSubnetFields = {
                            ...(row.unifi_cidr    ? { cidr: row.unifi_cidr }             : {}),
                            ...(row.unifi_gateway ? { gateway: row.unifi_gateway }        : {}),
                            ...(row.unifi_dhcp_start ? { dhcp_start: row.unifi_dhcp_start } : {}),
                            ...(row.unifi_dhcp_end   ? { dhcp_end:   row.unifi_dhcp_end   } : {}),
                          }

                          return (
                            <Fragment key={row.row_key}>
                              <tr className={`border-t border-white/[0.06] transition-colors ${hovered ? 'bg-white/[0.03]' : ''}`} {...hoverProps}>
                                {!vlanDiff
                                  ? <td className="pl-4 pr-2 py-1.5 font-mono text-white/40 align-middle" rowSpan={2}>{row.vlan_id ?? '—'}</td>
                                  : <td className="pl-4 pr-2 py-1.5 font-mono align-middle">
                                      {netCell(row.unifi_vlan_id != null ? String(row.unifi_vlan_id) : null, true,
                                        row.mynet_vlan_id != null && row.unifi_network_id && <SyncBtn label="Use MyNet" variant="mynet" writeGuarded title={`Update UniFi VLAN to MyNet value (${row.mynet_vlan_id})`} syncKey={`unifi-net-vlan-${row.row_key}`} onClick={() => syncNetworkToUnifiMutation.mutate({ unifiNetworkId: row.unifi_network_id, fields: { vlan_id: row.mynet_vlan_id } })} />
                                      )}
                                    </td>
                                }
                                <td className="px-3 py-1.5 text-center">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">UniFi</span>
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  {netCell(row.unifi_name, diffs.has('name'),
                                    row.mynet_name && row.unifi_network_id && <SyncBtn label="Use MyNet" variant="mynet" writeGuarded title={`Update UniFi name to MyNet value (${row.mynet_name})`} syncKey={`unifi-net-name-${row.row_key}`} onClick={() => syncNetworkToUnifiMutation.mutate({ unifiNetworkId: row.unifi_network_id, fields: { name: row.mynet_name } })} />
                                  )}
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  <span className={diffs.has('cidr') ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.unifi_cidr ?? <span className="text-white/20">—</span>}</span>
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  <span className={diffs.has('gateway') ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.unifi_gateway ?? <span className="text-white/20">—</span>}</span>
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  {dhcpInline
                                    ? netCell(unifiDhcp, dhcpDiff,
                                        (row.mynet_dhcp_start || row.mynet_dhcp_end) && row.unifi_network_id && <SyncBtn label="Use MyNet" variant="mynet" writeGuarded title="Update UniFi DHCP range to MyNet values" syncKey={`unifi-net-dhcp-${row.row_key}`} onClick={() => syncNetworkToUnifiMutation.mutate({ unifiNetworkId: row.unifi_network_id, fields: { ...(row.mynet_dhcp_start ? { dhcp_start: row.mynet_dhcp_start } : {}), ...(row.mynet_dhcp_end ? { dhcp_end: row.mynet_dhcp_end } : {}) } })} />
                                      )
                                    : <span className={dhcpDiff ? 'text-amber-400 font-medium' : 'text-white/60'}>{unifiDhcp ?? <span className="text-white/20">—</span>}</span>
                                  }
                                </td>
                                <td className="pl-4 pr-2 py-1.5 align-middle" rowSpan={2}><StatusBadge status={row.status} /></td>
                                <td className="pl-4 pr-2 py-1.5 align-middle" rowSpan={2}>
                                  <div className="flex flex-col gap-1">
                                    {row.status === 'unifi_only' && (() => {
                                      const uid = row.unifi_network_id
                                      const isConfirming = confirmDeleteNetworkId === uid
                                      const isDeleting = deleteNetworkMutation.isPending && confirmDeleteNetworkId === uid
                                      return (
                                        <>
                                          <div className="flex gap-1 items-center">
                                            <button type="button" onClick={() => { const p = new URLSearchParams(); if (row.unifi_name) p.set('name', row.unifi_name); if (row.unifi_vlan_id) p.set('vlan_id', String(row.unifi_vlan_id)); if (row.unifi_cidr) p.set('cidr', row.unifi_cidr); if (row.unifi_gateway) p.set('gateway', row.unifi_gateway); navigate(`/networks/new?${p.toString()}`) }} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40 transition-colors">
                                              <Plus size={8} />Add to MyNet
                                            </button>
                                            {isConfirming ? (
                                              <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => deleteNetworkMutation.mutate(uid)} disabled={isDeleting} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50">
                                                  {isDeleting ? <Loader size={8} className="animate-spin" /> : <Trash2 size={8} />}{isDeleting ? 'Deleting…' : 'Confirm'}
                                                </button>
                                                <button type="button" onClick={() => { deleteNetworkMutation.reset(); setConfirmDeleteNetworkId(null) }} className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-medium text-white/30 hover:text-white/50 transition-colors">Cancel</button>
                                              </div>
                                            ) : (
                                              <button type="button" onClick={() => { deleteNetworkMutation.reset(); setConfirmDeleteNetworkId(uid) }} disabled={!canWrite} title={!canWrite ? 'Enable write access to UniFi in settings to use this' : undefined} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-colors disabled:opacity-40">
                                                <Trash2 size={8} />Delete from UniFi
                                              </button>
                                            )}
                                          </div>
                                          {deleteNetworkMutation.isError && confirmDeleteNetworkId === uid && (
                                            <p className="text-[9px] text-red-400">{(deleteNetworkMutation.error as any)?.response?.data?.detail ?? 'Delete failed'}</p>
                                          )}
                                        </>
                                      )
                                    })()}
                                    {row.status === 'mynet_only' && (() => {
                                      const mid = row.mynet_network_id
                                      const isConfirming = confirmDeleteMyNetNetworkId === mid
                                      const isDeleting = deleteMyNetNetworkMutation.isPending && confirmDeleteMyNetNetworkId === mid
                                      return (
                                        <>
                                          <div className="flex gap-1 items-center">
                                            <button type="button"
                                              onClick={() => addNetworkToUnifiMutation.mutate({ name: row.mynet_name, vlan_id: row.mynet_vlan_id, gateway: row.mynet_gateway ?? undefined, cidr: row.mynet_cidr ?? undefined, dhcp_start: row.mynet_dhcp_start ?? undefined, dhcp_end: row.mynet_dhcp_end ?? undefined })}
                                              disabled={addNetworkToUnifiMutation.isPending || !canWrite}
                                              title={!canWrite ? 'Enable write access to UniFi in settings to use this' : undefined}
                                              className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 hover:border-indigo-500/40 transition-colors disabled:opacity-40">
                                              <Send size={8} />Add to UniFi
                                            </button>
                                            {isConfirming ? (
                                              <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => deleteMyNetNetworkMutation.mutate(mid)} disabled={isDeleting} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50">
                                                  {isDeleting ? <Loader size={8} className="animate-spin" /> : <Trash2 size={8} />}{isDeleting ? 'Deleting…' : 'Confirm'}
                                                </button>
                                                <button type="button" onClick={() => { deleteMyNetNetworkMutation.reset(); setConfirmDeleteMyNetNetworkId(null) }} className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-medium text-white/30 hover:text-white/50 transition-colors">Cancel</button>
                                              </div>
                                            ) : (
                                              <button type="button" onClick={() => { deleteMyNetNetworkMutation.reset(); setConfirmDeleteMyNetNetworkId(mid) }} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-colors">
                                                <Trash2 size={8} />Delete from MyNet
                                              </button>
                                            )}
                                          </div>
                                          {addNetworkToUnifiMutation.isError && (
                                            <p className="text-[9px] text-red-400">{(addNetworkToUnifiMutation.error as any)?.response?.data?.detail ?? 'Add to UniFi failed'}</p>
                                          )}
                                          {deleteMyNetNetworkMutation.isError && confirmDeleteMyNetNetworkId === mid && (
                                            <p className="text-[9px] text-red-400">{(deleteMyNetNetworkMutation.error as any)?.response?.data?.detail ?? 'Delete failed'}</p>
                                          )}
                                        </>
                                      )
                                    })()}
                                    {row.status === 'differences' && subnetDiff && (
                                      <div className="flex gap-1 items-center">
                                        {row.unifi_network_id && Object.keys(mynetSubnetFields).length > 0 &&
                                          <SyncBtn label="Use MyNet" variant="mynet" writeGuarded title="Update UniFi subnet (CIDR, gateway & DHCP) to MyNet values" syncKey={`unifi-net-subnet-${row.row_key}`} onClick={() => syncNetworkToUnifiMutation.mutate({ unifiNetworkId: row.unifi_network_id, fields: mynetSubnetFields })} />
                                        }
                                        {row.mynet_network_id && Object.keys(unifiSubnetFields).length > 0 &&
                                          <SyncBtn label="Use UniFi" title="Update MyNet subnet (CIDR, gateway & DHCP) to UniFi values" syncKey={`mynet-net-subnet-${row.row_key}`} onClick={() => syncNetworkToMyNetMutation.mutate({ networkId: row.mynet_network_id, fields: unifiSubnetFields })} />
                                        }
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              <tr className={`border-b border-white/[0.08] transition-colors ${hovered ? 'bg-white/[0.03]' : ''}`} {...hoverProps}>
                                {vlanDiff && <td className="pl-4 pr-2 py-1.5 font-mono align-middle">
                                  {netCell(row.mynet_vlan_id != null ? String(row.mynet_vlan_id) : null, true,
                                    row.unifi_vlan_id != null && row.mynet_network_id && <SyncBtn label="Use UniFi" title={`Update MyNet VLAN to UniFi value (${row.unifi_vlan_id})`} syncKey={`mynet-net-vlan-${row.row_key}`} onClick={() => syncNetworkToMyNetMutation.mutate({ networkId: row.mynet_network_id, fields: { vlan_id: row.unifi_vlan_id } })} />
                                  )}
                                </td>}
                                <td className="px-3 py-1.5 text-center">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#3ea99e]/10 text-[#3ea99e] border border-[#3ea99e]/30">MyNet</span>
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  {netCell(row.mynet_name, diffs.has('name'),
                                    row.unifi_name && row.mynet_network_id && <SyncBtn label="Use UniFi" title={`Update MyNet name to UniFi value (${row.unifi_name})`} syncKey={`mynet-net-name-${row.row_key}`} onClick={() => syncNetworkToMyNetMutation.mutate({ networkId: row.mynet_network_id, fields: { name: row.unifi_name } })} />
                                  )}
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  <span className={diffs.has('cidr') ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.mynet_cidr ?? <span className="text-white/20">—</span>}</span>
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  <span className={diffs.has('gateway') ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.mynet_gateway ?? <span className="text-white/20">—</span>}</span>
                                </td>
                                <td className="pl-4 pr-2 py-1.5 font-mono">
                                  {dhcpInline
                                    ? netCell(mynetDhcp, dhcpDiff,
                                        (row.unifi_dhcp_start || row.unifi_dhcp_end) && row.mynet_network_id && <SyncBtn label="Use UniFi" title="Update MyNet DHCP range to UniFi values" syncKey={`mynet-net-dhcp-${row.row_key}`} onClick={() => syncNetworkToMyNetMutation.mutate({ networkId: row.mynet_network_id, fields: { ...(row.unifi_dhcp_start ? { dhcp_start: row.unifi_dhcp_start } : {}), ...(row.unifi_dhcp_end ? { dhcp_end: row.unifi_dhcp_end } : {}) } })} />
                                      )
                                    : <span className={dhcpDiff ? 'text-amber-400 font-medium' : 'text-white/60'}>{mynetDhcp ?? <span className="text-white/20">—</span>}</span>
                                  }
                                </td>
                              </tr>
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>
              </div>}

              {/* ── Devices table ──────────────────────────────────── */}
              {compView === 'devices' && <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
                  <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider flex-shrink-0 hidden sm:block">Devices</h3>
                  <input
                    type="search"
                    value={deviceSearch}
                    onChange={e => setDeviceSearch(e.target.value)}
                    placeholder="Search devices…"
                    className="glass-input text-xs py-1 w-full sm:w-72"
                  />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4">
                    {([
                      { key: 'in_service',     label: 'In Service'     },
                      { key: 'stock',          label: 'Stock'          },
                      { key: 'undeployed',     label: 'Undeployed'     },
                      { key: 'decommissioned', label: 'Decommissioned' },
                    ] as const).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
                        <button type="button" onClick={() => toggleFilter(setDevStatusFilter, key)} className={devStatusFilter.has(key) ? 'text-indigo-400' : 'text-white/25'}>
                          {devStatusFilter.has(key) ? <CheckSquare size={13} /> : <Square size={13} />}
                        </button>
                        <span className="text-xs text-white/50">{label}</span>
                      </label>
                    ))}
                  </div>
                  <span className="hidden sm:block text-white/15 text-sm">|</span>
                  <div className="flex flex-wrap items-end gap-x-3 gap-y-2 sm:gap-4">
                    {([
                      { key: 'match',       label: 'Match'      },
                      { key: 'differences', label: 'Mismatch'   },
                      { key: 'mynet_only',  label: 'MyNet only' },
                      { key: 'unifi_only',  label: 'UniFi only' },
                    ] as const).map(({ key, label }) => {
                      const cfg = COMP_STATUS[key]
                      const Icon = cfg.icon
                      const count = comparison?.devices?.filter((r: any) => r.status === key).length ?? 0
                      return (
                        <div key={key} className="flex flex-col items-start gap-0.5">
                          <div className={`flex items-center gap-1 text-[10px] ${cfg.className.split(' ')[0]}`}>
                            <Icon size={10} />
                            <span>{count}</span>
                          </div>
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <button type="button" onClick={() => toggleFilter(setCompStatusFilter, key)} className={compStatusFilter.has(key) ? 'text-indigo-400' : 'text-white/25'}>
                              {compStatusFilter.has(key) ? <CheckSquare size={13} /> : <Square size={13} />}
                            </button>
                            <span className="text-xs text-white/50">{label}</span>
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <GlassCard className="p-0 overflow-hidden">
                  <SummaryBar rows={comparison.devices} activeKeys={compStatusFilter} />
                  {/* Mobile: device group cards */}
                  <div className="sm:hidden divide-y divide-white/[0.04]">
                    {filteredDeviceGroups.map(group => {
                      const mobGrpKey = `mob-grp-${group.groupKey}`
                      const grpExpanded = expandedMobGrp === mobGrpKey
                      const worstStatus = ['differences', 'mynet_only', 'unifi_only'].find(s =>
                        group.nics.some((n: any) => n.status === s)
                      ) ?? 'match'
                      return (
                        <div key={group.groupKey}>
                          {/* Device group header */}
                          <div className={`flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors ${grpExpanded ? 'border-b border-white/[0.04]' : ''}`}>
                            {group.deviceId
                              ? <button type="button" onClick={() => navigate(`/devices/${group.deviceId}`)} className="flex-1 text-sm font-medium text-indigo-400 hover:text-indigo-300 text-left truncate">{group.deviceName}</button>
                              : <span className="flex-1 text-sm text-white/40 italic truncate">UniFi only</span>
                            }
                            {group.nics.length > 1 && <span className="text-xs text-white/30 flex-shrink-0">{group.nics.length} NICs</span>}
                            <StatusBadge status={worstStatus} />
                            <button type="button" onClick={() => setExpandedMobGrp(prev => prev === mobGrpKey ? null : mobGrpKey)} className="p-1 text-white/20 hover:text-white/50 transition-colors flex-shrink-0">
                              <ChevronDown size={13} className={`transition-transform ${grpExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                          {/* Per-NIC rows */}
                          {grpExpanded && group.nics.map((row: any, nicIdx: number) => {
                            const nicKey = `${group.groupKey}-nic-${nicIdx}`
                            const nicExpanded = expandedMobNic === nicKey
                            const diffs = new Set((row.differences ?? []).map((d: any) => d.field))
                            const macDiff = diffs.has('MAC Address')
                            const ipDiff = diffs.has('IP Address')
                            const dnsDiff = diffs.has('DNS Entry')
                            const hostnameDiff = diffs.has('Hostname')
                            const hasActions = row.status !== 'match'
                            const displayIp = row.mynet_ip ?? row.unifi?.ip
                            const displayMac = row.mynet_mac ?? row.unifi?.mac
                            const shortMac = displayMac ? displayMac.slice(0, 8) + '…' : '—'
                            return (
                              <div key={nicKey} className={`border-b border-white/[0.03] last:border-0 ${row.mynet_nic_disabled ? 'opacity-40' : ''}`}>
                                {/* NIC row */}
                                <button type="button" onClick={() => setExpandedMobNic(prev => prev === nicKey ? null : nicKey)}
                                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                                  <span className="font-mono text-xs text-white/60 flex-1 truncate">{displayIp ?? <span className="text-white/25">No IP</span>}</span>
                                  <span className="font-mono text-[10px] text-white/30 flex-shrink-0">{shortMac}</span>
                                  <StatusBadge status={row.status} />
                                  <ChevronDown size={12} className={`text-white/20 transition-transform flex-shrink-0 ${nicExpanded ? 'rotate-180' : ''}`} />
                                </button>
                                {/* NIC expanded detail */}
                                {nicExpanded && (
                                  <div className="px-5 pb-3 pt-2 border-t border-white/[0.03] bg-white/[0.015]">
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
                                      <div className="space-y-2">
                                        <p className="text-[10px] font-semibold text-indigo-400/70 uppercase tracking-wider">UniFi</p>
                                        {row.unifi ? (
                                          <>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">Alias</p><p className="text-white/60 truncate">{row.unifi.name ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">MAC</p><p className={`font-mono text-[10px] truncate ${macDiff ? 'text-amber-400' : 'text-white/50'}`}>{row.unifi.mac ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">IP</p><p className={`font-mono truncate ${ipDiff ? 'text-amber-400' : 'text-white/60'}`}>{row.unifi.ip ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">Hostname</p><p className={`font-mono text-[10px] truncate ${hostnameDiff ? 'text-amber-400' : 'text-white/60'}`}>{row.unifi.hostname ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">DNS</p><p className={`font-mono text-[10px] truncate ${dnsDiff ? 'text-amber-400' : 'text-white/60'}`}>{row.unifi.local_dns ?? <span className="text-white/20">—</span>}</p></div>
                                          </>
                                        ) : <p className="text-white/25 text-[10px] italic mt-1">Not in UniFi</p>}
                                      </div>
                                      <div className="space-y-2">
                                        <p className="text-[10px] font-semibold text-[#3ea99e]/70 uppercase tracking-wider">MyNet</p>
                                        {(row.mynet_nic_id || row.mynet_device_id) ? (
                                          <>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">NIC Label</p><p className="text-white/60 truncate">{row.mynet_nic_label ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">MAC</p><p className={`font-mono text-[10px] truncate ${macDiff ? 'text-amber-400' : 'text-white/50'}`}>{row.mynet_mac ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">IP</p><p className={`font-mono truncate ${ipDiff ? 'text-amber-400' : 'text-white/60'}`}>{row.mynet_ip ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">Hostname</p><p className={`font-mono text-[10px] truncate ${hostnameDiff ? 'text-amber-400' : 'text-white/60'}`}>{row.mynet_hostname ?? <span className="text-white/20">—</span>}</p></div>
                                            <div><p className="text-[10px] text-white/30 mb-0.5">DNS</p><p className={`font-mono text-[10px] truncate ${dnsDiff ? 'text-amber-400' : 'text-white/60'}`}>{row.mynet_dns_entry ?? <span className="text-white/20">—</span>}</p></div>
                                          </>
                                        ) : <p className="text-white/25 text-[10px] italic mt-1">Not in MyNet</p>}
                                      </div>
                                    </div>
                                    {hasActions && (
                                      <div className="pt-2.5 border-t border-white/[0.05] flex flex-wrap gap-2">
                                        {macDiff && row.mynet_mac && row.unifi?.mac && <SyncBtn label="MAC→UniFi" variant="mynet" writeGuarded title={`Set UniFi MAC to ${row.mynet_mac}`} syncKey={`unifi-mac-${row.unifi.mac}`} onClick={() => syncToUnifiMutation.mutate({ mac: row.unifi.mac, field: 'mac', value: row.mynet_mac })} />}
                                        {macDiff && row.unifi?.mac && row.mynet_nic_id && <SyncBtn label="MAC→MyNet" title={`Set MyNet MAC to ${row.unifi.mac}`} syncKey={`mynet-mac-${row.mynet_nic_id}`} onClick={() => syncToMyNetMutation.mutate({ nicId: row.mynet_nic_id, field: 'mac', value: row.unifi.mac })} />}
                                        {ipDiff && row.mynet_ip && row.unifi?.mac && <SyncBtn label="IP→UniFi" variant="mynet" writeGuarded title={`Set UniFi IP to ${row.mynet_ip}`} syncKey={`unifi-ip-${row.unifi.mac}`} onClick={() => syncToUnifiMutation.mutate({ mac: row.unifi.mac, field: 'ip', value: row.mynet_ip })} />}
                                        {ipDiff && row.unifi?.ip && row.mynet_nic_id && <SyncBtn label="IP→MyNet" title={`Set MyNet IP to ${row.unifi.ip}`} syncKey={`mynet-ip-${row.mynet_nic_id}`} onClick={() => syncToMyNetMutation.mutate({ nicId: row.mynet_nic_id, field: 'ip', value: row.unifi.ip })} />}
                                        {hostnameDiff && row.unifi?.hostname && row.mynet_device_id && <SyncBtn label="Host→MyNet" title={`Set MyNet hostname to ${row.unifi.hostname}`} syncKey={`mynet-host-${row.mynet_device_id}`} onClick={() => syncDeviceToMyNetMutation.mutate({ deviceId: row.mynet_device_id, field: 'hostname', value: row.unifi.hostname })} />}
                                        {dnsDiff && row.mynet_dns_entry && row.unifi?.mac && <SyncBtn label="DNS→UniFi" variant="mynet" writeGuarded title={`Set UniFi DNS to ${row.mynet_dns_entry}`} syncKey={`unifi-dns-${row.unifi.mac}`} onClick={() => syncToUnifiMutation.mutate({ mac: row.unifi.mac, field: 'dns', value: row.mynet_dns_entry })} />}
                                        {dnsDiff && row.unifi?.local_dns && row.mynet_nic_id && <SyncBtn label="DNS→MyNet" title={`Set MyNet DNS to ${row.unifi.local_dns}`} syncKey={`mynet-dns-${row.mynet_nic_id}`} onClick={() => syncToMyNetMutation.mutate({ nicId: row.mynet_nic_id, field: 'dns', value: row.unifi.local_dns })} />}
                                        {row.status === 'unifi_only' && (() => {
                                          const mac = row.unifi?.mac
                                          const isInfra = row.unifi?.is_infrastructure
                                          const isConfirming = confirmDeleteMac === mac
                                          const isDeleting = deleteMutation.isPending && confirmDeleteMac === mac
                                          return (
                                            <>
                                              <button type="button" onClick={() => { const params = new URLSearchParams(); if (row.unifi?.name) params.set('name', row.unifi.name); if (row.unifi?.mac) params.set('mac', row.unifi.mac); if (row.unifi?.ip) params.set('ip', row.unifi.ip); if (row.unifi?.hostname) params.set('hostname', row.unifi.hostname); if (row.unifi?.local_dns) params.set('dns_entry', row.unifi.local_dns); if (row.unifi?.is_wireless) params.set('is_wireless', 'true'); if (row.unifi?.ssid) params.set('ssid', row.unifi.ssid); navigate(`/devices/new?${params.toString()}`) }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"><Plus size={9} />Add to MyNet</button>
                                              {!isInfra && (isConfirming ? (
                                                <div className="flex items-center gap-1">
                                                  <button type="button" onClick={() => deleteMutation.mutate(mac)} disabled={isDeleting} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 transition-colors disabled:opacity-50">{isDeleting ? <Loader size={9} className="animate-spin" /> : <Trash2 size={9} />}{isDeleting ? '…' : 'Confirm'}</button>
                                                  <button type="button" onClick={() => { deleteMutation.reset(); setConfirmDeleteMac(null) }} className="px-1.5 py-1 rounded text-[10px] text-white/30 hover:text-white/50">Cancel</button>
                                                </div>
                                              ) : (
                                                <button type="button" onClick={() => { deleteMutation.reset(); setConfirmDeleteMac(mac) }} disabled={!canWrite} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40"><Trash2 size={9} />Delete from UniFi</button>
                                              ))}
                                            </>
                                          )
                                        })()}
                                        {row.status === 'mynet_only' && (
                                          <button type="button" onClick={() => row.mynet_mac && openAddToUnifi(row)} disabled={!row.mynet_mac || !canWrite} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"><Send size={9} />Add to UniFi</button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-xs [&_td]:align-middle [&_th]:align-middle">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-36">Device</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-64">Alias</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-px whitespace-nowrap">Source</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-px whitespace-nowrap">NIC</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-40">MAC</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-40">IP</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-44">Hostname</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-px whitespace-nowrap">DNS Entry</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-px whitespace-nowrap">Connection</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium w-px whitespace-nowrap">Status</th>
                          <th className="text-center px-4 py-2 text-white/30 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const dash = <span className="text-white/20">—</span>
                          const na = <td className="pl-4 pr-2 py-1.5 text-center text-white/20 text-[10px]">N/A</td>

                          return filteredDeviceGroups.map(group => {
                            const groupHoverKey = group.groupKey
                            const hovered = hoveredRow === groupHoverKey
                            const hoverProps = { onMouseEnter: () => setHoveredRow(groupHoverKey), onMouseLeave: () => setHoveredRow(null) }
                            const expandedNicCount = group.nics.filter((_: any, i: number) => expandedRows.has(`${group.groupKey}-nic-${i}`)).length
                            const totalRows = group.nics.length * 2 + expandedNicCount

                            return group.nics.map((row: any, nicIdx: number) => {
                              const rowKey = `${group.groupKey}-nic-${nicIdx}`
                              const isExpanded = expandedRows.has(rowKey)
                              const diffs = new Set((row.differences ?? []).map((d: any) => d.field))
                              const macDiff = diffs.has('MAC Address')
                              const ipDiff = diffs.has('IP Address')
                              const connDiff = diffs.has('Connection Type')
                              const dnsDiff = diffs.has('DNS Entry')
                              const hostnameDiff = diffs.has('Hostname')
                              const hasActions = row.status !== 'match'
                              const unifiConn = row.unifi
                                ? (row.unifi.is_wireless ? `Wireless${row.unifi.ssid ? ` · ${row.unifi.ssid}` : ''}` : 'Wired')
                                : null
                              const mynetConn = row.mynet_nic_type
                                ? (row.mynet_nic_type === 'WIFI' ? 'Wireless' : 'Wired')
                                : null
                              const isFirstNic = nicIdx === 0
                              const isLastNic = nicIdx === group.nics.length - 1
                              return (
                                <Fragment key={rowKey}>
                                  {/* ── UniFi row ── */}
                                  <tr className={`border-t transition-colors ${isFirstNic ? 'border-white/[0.08]' : 'border-white/[0.03]'} ${hovered ? 'bg-white/[0.03]' : ''}`} {...hoverProps}>
                                    {isFirstNic && (
                                      <td className="pl-4 pr-2 py-1.5 align-top w-36 text-center" rowSpan={totalRows}>
                                        {group.deviceId
                                          ? <button type="button" onClick={() => navigate(`/devices/${group.deviceId}`)} className="text-indigo-400 hover:text-indigo-300 transition-colors font-medium">{group.deviceName}</button>
                                          : dash}
                                      </td>
                                    )}
                                    <td className="pl-4 pr-2 py-1.5 text-white/60">{row.unifi?.name ?? dash}</td>
                                    <td className="pl-2 pr-2 py-1.5 text-center w-px whitespace-nowrap">
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">UniFi</span>
                                    </td>
                                    <td className="pl-4 pr-2 py-1.5 text-center text-white/20 text-[10px] w-px whitespace-nowrap">N/A</td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono text-[10px]">
                                      {row.unifi?.mac
                                        ? <span className={`inline-flex items-center gap-1 ${macDiff ? 'text-amber-400 font-medium' : 'text-white/40'}`}>{row.unifi.mac}<button type="button" onClick={() => copyMac(row.unifi.mac, setCopiedMac)} className="text-white/50 hover:text-white/80 transition-colors">{copiedMac === row.unifi.mac ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}</button></span>
                                        : dash}
                                    </td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono">
                                      {row.unifi?.ip
                                        ? <span className={`inline-flex items-center gap-1 ${ipDiff ? 'text-amber-400 font-medium' : 'text-white/60'}`}>{row.unifi.ip}<button type="button" onClick={() => copyMac(row.unifi.ip, setCopiedIp)} className="text-white/50 hover:text-white/80 transition-colors">{copiedIp === row.unifi.ip ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}</button></span>
                                        : dash}
                                    </td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono text-[10px]"><span className={hostnameDiff ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.unifi?.hostname ?? dash}</span></td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono text-[10px] whitespace-nowrap"><span className={dnsDiff ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.unifi?.local_dns ?? dash}</span></td>
                                    <td className="pl-4 pr-2 py-1.5 text-center w-px whitespace-nowrap"><span className={connDiff ? 'text-amber-400 font-medium' : 'text-white/50'}>{unifiConn ?? dash}</span></td>
                                    <td className="pl-4 pr-2 py-1.5 align-middle text-center w-px" rowSpan={2}>
                                      <StatusBadge status={row.status} />
                                    </td>
                                    <td className="pl-4 pr-2 py-1.5 align-middle text-center w-px" rowSpan={2}>
                                      {hasActions && (
                                        <button
                                          type="button"
                                          onClick={() => toggleExpandedRow(rowKey)}
                                          className={`flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap border transition-colors ${isExpanded ? 'bg-white/[0.08] text-white/60 border-white/20 hover:bg-white/[0.12]' : 'text-white/60 border-white/25 hover:text-white/80 hover:bg-white/[0.06] hover:border-white/40'}`}
                                        >
                                          {isExpanded ? 'Hide' : 'Show'}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                  {/* ── MyNet row ── */}
                                  <tr className={`transition-colors ${isLastNic && !isExpanded ? 'border-b border-white/[0.08]' : ''} ${hovered ? (row.mynet_nic_disabled ? 'bg-white/[0.08]' : 'bg-white/[0.03]') : ''} ${row.mynet_nic_disabled ? 'opacity-40' : ''}`} {...hoverProps}>
                                    {na}
                                    <td className="pl-2 pr-2 py-1.5 text-center w-px whitespace-nowrap">
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#3ea99e]/10 text-[#3ea99e] border border-[#3ea99e]/30">MyNet</span>
                                    </td>
                                    <td className="pl-4 pr-2 py-1.5 text-white/50 w-px whitespace-nowrap text-center">{row.mynet_nic_label ?? dash}</td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono text-[10px]">
                                      {row.mynet_mac
                                        ? <span className={`inline-flex items-center gap-1 ${macDiff ? 'text-amber-400 font-medium' : 'text-white/40'}`}>{row.mynet_mac}<button type="button" onClick={() => copyMac(row.mynet_mac, setCopiedMac)} className="text-white/50 hover:text-white/80 transition-colors">{copiedMac === row.mynet_mac ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}</button></span>
                                        : dash}
                                    </td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono">
                                      {row.mynet_ip
                                        ? <span className={`inline-flex items-center gap-1 ${ipDiff ? 'text-amber-400 font-medium' : 'text-white/60'}`}>{row.mynet_ip}<button type="button" onClick={() => copyMac(row.mynet_ip, setCopiedIp)} className="text-white/50 hover:text-white/80 transition-colors">{copiedIp === row.mynet_ip ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}</button></span>
                                        : dash}
                                    </td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono text-[10px]"><span className={hostnameDiff ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.mynet_hostname ?? dash}</span></td>
                                    <td className="pl-4 pr-2 py-1.5 font-mono text-[10px] whitespace-nowrap"><span className={dnsDiff ? 'text-amber-400 font-medium' : 'text-white/60'}>{row.mynet_dns_entry ?? dash}</span></td>
                                    <td className="pl-4 pr-2 py-1.5 text-center w-px whitespace-nowrap"><span className={connDiff ? 'text-amber-400 font-medium' : 'text-white/50'}>{mynetConn ?? dash}</span></td>
                                  </tr>
                                  {/* ── Action row (expanded) ── */}
                                  {isExpanded && (
                                    <tr className={`bg-white/[0.02] transition-colors ${isLastNic ? 'border-b border-white/[0.08]' : ''}`}>
                                      {/* Device cell already spanned — skip */}
                                      {/* Alias */}
                                      <td className="pl-4 pr-2 py-1.5" />
                                      {/* Source */}
                                      <td className="pl-4 pr-2 py-1.5" />
                                      {/* NIC (grey block) */}
                                      <td className="pl-4 pr-2 py-1.5 text-center text-white/20 text-[10px] w-px whitespace-nowrap">N/A</td>
                                      {/* MAC */}
                                      <td className="pl-4 pr-2 py-1.5 font-mono text-[10px] text-center">
                                        {macDiff && <div className="flex gap-1 justify-center">
                                          {row.mynet_mac && row.unifi?.mac && <SyncBtn label="Use MyNet" variant="mynet" writeGuarded title={`Update UniFi MAC to MyNet value (${row.mynet_mac})`} syncKey={`unifi-mac-${row.unifi.mac}`} onClick={() => syncToUnifiMutation.mutate({ mac: row.unifi.mac, field: 'mac', value: row.mynet_mac })} />}
                                          {row.unifi?.mac && row.mynet_nic_id && <SyncBtn label="Use UniFi" title={`Update MyNet MAC to UniFi value (${row.unifi.mac})`} syncKey={`mynet-mac-${row.mynet_nic_id}`} onClick={() => syncToMyNetMutation.mutate({ nicId: row.mynet_nic_id, field: 'mac', value: row.unifi.mac })} />}
                                        </div>}
                                      </td>
                                      {/* IP */}
                                      <td className="pl-4 pr-2 py-1.5 text-center">
                                        {ipDiff && <div className="flex gap-1 justify-center">
                                          {row.mynet_ip && row.unifi?.mac && <SyncBtn label="Use MyNet" variant="mynet" writeGuarded title={`Update UniFi fixed IP to MyNet value (${row.mynet_ip})`} syncKey={`unifi-ip-${row.unifi.mac}`} onClick={() => syncToUnifiMutation.mutate({ mac: row.unifi.mac, field: 'ip', value: row.mynet_ip })} />}
                                          {row.unifi?.ip && row.mynet_nic_id && <SyncBtn label="Use UniFi" title={`Update MyNet IP to UniFi value (${row.unifi.ip})`} syncKey={`mynet-ip-${row.mynet_nic_id}`} onClick={() => syncToMyNetMutation.mutate({ nicId: row.mynet_nic_id, field: 'ip', value: row.unifi.ip })} />}
                                        </div>}
                                      </td>
                                      {/* Hostname */}
                                      <td className="pl-4 pr-2 py-1.5 text-center">
                                        {hostnameDiff && row.unifi?.hostname && row.mynet_device_id && (
                                          <SyncBtn label="Use UniFi" title={`Update MyNet hostname to UniFi value (${row.unifi.hostname})`} syncKey={`mynet-host-${row.mynet_device_id}`} onClick={() => syncDeviceToMyNetMutation.mutate({ deviceId: row.mynet_device_id, field: 'hostname', value: row.unifi.hostname })} />
                                        )}
                                      </td>
                                      {/* DNS Entry */}
                                      <td className="pl-4 pr-2 py-1.5 text-center whitespace-nowrap">
                                        {dnsDiff && <div className="flex gap-1 justify-center">
                                          {row.mynet_dns_entry && row.unifi?.mac && <SyncBtn label="Use MyNet" variant="mynet" writeGuarded title={`Update UniFi DNS entry to MyNet value (${row.mynet_dns_entry})`} syncKey={`unifi-dns-${row.unifi.mac}`} onClick={() => syncToUnifiMutation.mutate({ mac: row.unifi.mac, field: 'dns', value: row.mynet_dns_entry })} />}
                                          {row.unifi?.local_dns && row.mynet_nic_id && <SyncBtn label="Use UniFi" title={`Update MyNet DNS entry to UniFi value (${row.unifi.local_dns})`} syncKey={`mynet-dns-${row.mynet_nic_id}`} onClick={() => syncToMyNetMutation.mutate({ nicId: row.mynet_nic_id, field: 'dns', value: row.unifi.local_dns })} />}
                                        </div>}
                                      </td>
                                      {/* Connection */}
                                      <td className="pl-4 pr-2 py-1.5 w-px" />
                                      {/* Status + Actions — merged */}
                                      <td className="pl-4 pr-2 py-1.5" colSpan={2}>
                                        {row.status === 'unifi_only' && (() => {
                                          const mac = row.unifi?.mac
                                          const isInfra = row.unifi?.is_infrastructure
                                          const isConfirming = confirmDeleteMac === mac
                                          const isDeleting = deleteMutation.isPending && confirmDeleteMac === mac
                                          return (
                                            <div className="flex gap-1 justify-center">
                                              <button type="button" onClick={() => {
                                                const params = new URLSearchParams()
                                                if (row.unifi?.name)       params.set('name',       row.unifi.name)
                                                if (row.unifi?.mac)        params.set('mac',        row.unifi.mac)
                                                if (row.unifi?.ip)         params.set('ip',         row.unifi.ip)
                                                if (row.unifi?.hostname)   params.set('hostname',   row.unifi.hostname)
                                                if (row.unifi?.local_dns)  params.set('dns_entry',  row.unifi.local_dns)
                                                if (row.unifi?.is_wireless) params.set('is_wireless', 'true')
                                                if (row.unifi?.ssid)       params.set('ssid',       row.unifi.ssid)
                                                navigate(`/devices/new?${params.toString()}`)
                                              }} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40 transition-colors">
                                                <Plus size={8} />Add to MyNet
                                              </button>
                                              {!isInfra && (isConfirming ? (
                                                <div className="flex items-center gap-1">
                                                  <button type="button" onClick={() => deleteMutation.mutate(mac)} disabled={isDeleting} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50">
                                                    {isDeleting ? <Loader size={8} className="animate-spin" /> : <Trash2 size={8} />}{isDeleting ? 'Deleting…' : 'Confirm'}
                                                  </button>
                                                  <button type="button" onClick={() => { deleteMutation.reset(); setConfirmDeleteMac(null) }} className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-medium text-white/30 hover:text-white/50 transition-colors">Cancel</button>
                                                </div>
                                              ) : (
                                                <button type="button" onClick={() => { deleteMutation.reset(); setConfirmDeleteMac(mac) }} disabled={!canWrite} title={!canWrite ? 'Enable write access to UniFi in settings to use this' : undefined} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-colors disabled:opacity-40">
                                                  <Trash2 size={8} />Delete from UniFi
                                                </button>
                                              ))}
                                              {deleteMutation.isError && confirmDeleteMac === mac && (
                                                <p className="text-[9px] text-red-400">{(deleteMutation.error as any)?.response?.data?.detail ?? 'Delete failed'}</p>
                                              )}
                                            </div>
                                          )
                                        })()}
                                        {row.status === 'mynet_only' && (
                                          <div className="flex justify-center">
                                            <button type="button" onClick={() => row.mynet_mac && openAddToUnifi(row)} disabled={!row.mynet_mac || !canWrite} title={!canWrite ? 'Enable write access to UniFi in settings to use this' : !row.mynet_mac ? 'No MAC address set in MyNet' : undefined} className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 hover:border-indigo-500/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                                              <Send size={8} />Add to UniFi
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })
                          })
                        })()}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>
              </div>}
            </>
          )}
        </div>
      )}
    </div>
    {/* ── Add to UniFi modal ────────────────────────────────────────── */}
    {addToUnifiRow && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60" onClick={() => setAddToUnifiRow(null)} />
        <div className="relative w-full max-w-md glass-card p-6 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
                <Send size={15} className="text-indigo-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Add to UniFi</h2>
                <p className="text-xs text-white/40 mt-0.5 font-mono">{addToUnifiRow.mynet_mac}</p>
              </div>
            </div>
            <button type="button" onClick={() => setAddToUnifiRow(null)} className="text-white/30 hover:text-white/70 transition-colors mt-0.5">
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-white/40 block mb-1">Name / Alias</label>
              <input
                className="glass-input w-full text-sm"
                value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. James's iPhone"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] text-white/40 block mb-1">Fixed IP <span className="text-white/20">(optional — leave blank for DHCP)</span></label>
              <input
                className="glass-input w-full text-sm font-mono"
                value={addForm.fixed_ip}
                onChange={e => setAddForm(f => ({ ...f, fixed_ip: e.target.value }))}
                placeholder="e.g. 192.168.1.100"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/40 block mb-1">Network ID <span className="text-white/20">(optional — leave blank for default)</span></label>
              <input
                className="glass-input w-full text-sm font-mono"
                value={addForm.network_id}
                onChange={e => setAddForm(f => ({ ...f, network_id: e.target.value }))}
                placeholder="UniFi network _id"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/40 block mb-1">Note <span className="text-white/20">(optional)</span></label>
              <input
                className="glass-input w-full text-sm"
                value={addForm.note}
                onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Added via MyNet"
              />
            </div>
          </div>

          {addToUnifiMutation.isError && (
            <p className="text-xs text-red-400">{(addToUnifiMutation.error as any)?.response?.data?.detail ?? 'Failed to add to UniFi'}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setAddToUnifiRow(null)} className="btn-ghost text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={addToUnifiMutation.isPending || !canWrite}
              onClick={() => addToUnifiMutation.mutate({
                mac:        addToUnifiRow.mynet_mac,
                name:       addForm.name       || undefined,
                fixed_ip:   addForm.fixed_ip   || undefined,
                network_id: addForm.network_id || undefined,
                note:       addForm.note       || undefined,
              })}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
            >
              {addToUnifiMutation.isPending
                ? <><Loader size={13} className="animate-spin" /> Adding…</>
                : <><Send size={13} /> Add to UniFi</>}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function copyMac(mac: string, setCopied: (v: string | null) => void) {
  const done = () => { setCopied(mac); setTimeout(() => setCopied(null), 1500) }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(mac).then(done).catch(() => fallbackCopy(mac, done))
  } else {
    fallbackCopy(mac, done)
  }
}

function fallbackCopy(text: string, done: () => void) {
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
  done()
}
