import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Pencil, Trash2, Check, X, ChevronDown, ChevronRight, Lock, Monitor, ChevronLeft } from 'lucide-react'
import api from '../lib/api'
import { useColorSettings } from '../hooks/useColorSettings'
import { LOCATION_TYPE_ICON } from '../components/DeviceTypeIcon'
import { useAuthStore } from '../store/authStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LocationNode {
  id: number
  name: string
  type: string | null
  parent_id: number | null
  device_count: number
  is_permanent: boolean
  children: LocationNode[]
}

interface FlatItem {
  id: number
  name: string
  type: string | null
  parent_id: number | null
  device_count: number
  is_permanent: boolean
}

interface NodeForm { name: string; type: string; parent_id: number | null }
type EditMode = { kind: 'new'; parentId: number | null } | { kind: 'edit'; id: number } | null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function flattenTree(nodes: LocationNode[]): FlatItem[] {
  const result: FlatItem[] = []
  const walk = (n: LocationNode) => {
    result.push({ id: n.id, name: n.name, type: n.type, parent_id: n.parent_id, device_count: n.device_count, is_permanent: n.is_permanent })
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return result
}

function flattenNode(node: LocationNode): FlatItem[] {
  return flattenTree([node])
}

function getPath(id: number | null, byId: Record<number, FlatItem>): string {
  const parts: string[] = []
  let cur = id ? byId[id] : null
  while (cur) { parts.unshift(cur.name); cur = cur.parent_id ? byId[cur.parent_id] : null }
  return parts.join(' › ')
}

function countNodes(nodes: LocationNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0)
}

// ---------------------------------------------------------------------------
// Type badge — uses hex color from settings
// ---------------------------------------------------------------------------
function TypeBadge({ type, color }: { type: string | null; color?: string }) {
  if (!type) return null
  const hex = color ?? '#6b7280'
  const Icon = LOCATION_TYPE_ICON[type] ?? MapPin
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium border"
      style={{ color: hex, backgroundColor: hex + '1a', borderColor: hex + '40' }}>
      <Icon size={9} className="flex-shrink-0" />
      {type}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Inline form
// ---------------------------------------------------------------------------
function InlineForm({ form, onChange, knownTypes, listId, onSave, onCancel, saving, saveError, label, locationTypeColors }: {
  form: NodeForm; onChange: (f: NodeForm) => void; knownTypes: string[]
  listId: string; onSave: () => void; onCancel: () => void
  saving: boolean; saveError: string | null; label: string
  locationTypeColors: Record<string, string>
}) {
  return (
    <div className="mx-3 mb-2 mt-1 p-3 rounded-xl border border-indigo-500/20 space-y-2.5"
      style={{ background: 'linear-gradient(135deg, color-mix(in srgb, #6366f1 8%, var(--card-base-deepest)) 0%, var(--card-base-deepest) 100%)' }}>
      <p className="text-[10px] font-semibold text-indigo-300/60 uppercase tracking-widest">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-white/35 mb-1">Name</label>
          <input autoFocus className="glass-input text-sm w-full" placeholder="e.g. Shelf A"
            value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }} />
        </div>
        <div>
          <label className="block text-[10px] text-white/35 mb-1">Type</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(locationTypeColors).map((type) => {
              const hex = locationTypeColors[type] ?? '#6b7280'
              const isSelected = form.type === type
              return (
                <button key={type} type="button"
                  onClick={() => onChange({ ...form, type: isSelected ? '' : type })}
                  className="text-[10px] px-1.5 py-0.5 rounded border transition-all"
                  style={isSelected
                    ? { color: hex, backgroundColor: hex + '1a', borderColor: hex + '40', outline: `1px solid ${hex}60`, outlineOffset: '1px' }
                    : { color: 'var(--inline-inactive-text)', backgroundColor: 'var(--inline-inactive-bg)', borderColor: 'var(--inline-inactive-border)' }}>
                  {type}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={!form.name.trim() || saving} onClick={onSave}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed py-1 px-3">
          <Check size={11} /> Add
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost text-xs py-1">Cancel</button>
        {!form.name.trim() && <span className="text-[10px] text-white/25 italic">Enter a name first</span>}
        {saveError && <span className="text-[10px] text-red-400">{saveError}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tree node (recursive)
// ---------------------------------------------------------------------------
function TreeNode({ node, allItems, byId, knownTypes, editMode, setEditMode, form, setForm,
  onSave, onDelete, saving, saveError, collapsed, toggleCollapse, locationTypeColors, canEdit }: {
  node: LocationNode; allItems: FlatItem[]; byId: Record<number, FlatItem>; knownTypes: string[]
  editMode: EditMode; setEditMode: (m: EditMode) => void
  form: NodeForm; setForm: (f: NodeForm) => void
  onSave: (mode: EditMode) => void; onDelete: (id: number) => void
  saving: boolean; saveError: string | null
  collapsed: Set<number>; toggleCollapse: (id: number) => void
  locationTypeColors: Record<string, string>
  canEdit: boolean
}) {
  const isEditing = editMode?.kind === 'edit' && editMode.id === node.id
  const isAddingChild = editMode?.kind === 'new' && editMode.parentId === node.id
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)

  return (
    <div>
      <div className="flex items-center gap-2 px-2 py-[5px] mx-2 rounded-lg group
                      hover:bg-indigo-500/[0.05] transition-colors duration-150">

        {/* Collapse toggle */}
        <button type="button" onClick={() => toggleCollapse(node.id)}
          className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded transition-colors
            ${hasChildren
              ? 'text-white/20 hover:text-indigo-300/60 hover:bg-indigo-500/10'
              : 'text-transparent pointer-events-none'}`}>
          {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>

        {isEditing ? (
          <div className="flex items-center gap-2 flex-1 flex-wrap py-0.5">
            <input autoFocus className="glass-input text-sm w-36 min-w-0" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(editMode); if (e.key === 'Escape') setEditMode(null) }} />
            <input className="glass-input text-sm w-24" placeholder="Type" value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              list={`loc-types-edit-${node.id}`}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(editMode); if (e.key === 'Escape') setEditMode(null) }} />
            <datalist id={`loc-types-edit-${node.id}`}>{knownTypes.map((t) => <option key={t} value={t} />)}</datalist>
            <button type="button" disabled={!form.name.trim() || saving} onClick={() => onSave(editMode)}
              className="btn-primary p-1.5 disabled:opacity-40"><Check size={12} /></button>
            <button type="button" onClick={() => setEditMode(null)} className="btn-ghost p-1.5"><X size={12} /></button>
          </div>
        ) : (
          <>
            <span className="text-[13px] text-white/65 flex-1 min-w-0 truncate leading-tight group-hover:text-white/85 transition-colors duration-150">
              {node.name}
            </span>
            {node.is_permanent && <Lock size={9} className="text-white/15 flex-shrink-0" />}

            {/* Right-side: metadata + sliding actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-[52px] flex justify-end">
                  <TypeBadge type={node.type} color={node.type ? locationTypeColors[node.type] : undefined} />
                </div>
                <div className="w-[40px] flex justify-end">
                  {node.device_count > 0 && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-[9px] text-white/30 tabular-nums leading-none">
                      <Monitor size={8} className="opacity-70 flex-shrink-0" />
                      {node.device_count}
                    </span>
                  )}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-0.5 overflow-hidden max-w-0 group-hover:max-w-[68px] opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                  <button type="button" aria-label="Add child"
                    onClick={() => { setForm({ name: '', type: '', parent_id: node.id }); setEditMode({ kind: 'new', parentId: node.id }) }}
                    className="btn-ghost p-1 text-white/20 hover:text-indigo-300 flex-shrink-0"><Plus size={11} /></button>
                  {!node.is_permanent && (
                    <button type="button" aria-label={`Edit ${node.name}`}
                      onClick={() => { setForm({ name: node.name, type: node.type ?? '', parent_id: node.parent_id }); setEditMode({ kind: 'edit', id: node.id }) }}
                      className="btn-ghost p-1 text-white/20 hover:text-white flex-shrink-0"><Pencil size={11} /></button>
                  )}
                  {!node.is_permanent && (
                    <button type="button" aria-label={`Delete ${node.name}`}
                      onClick={() => onDelete(node.id)}
                      className="btn-ghost p-1 text-white/20 hover:text-red-400 flex-shrink-0"><Trash2 size={11} /></button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {isAddingChild && (
        <InlineForm form={form} onChange={setForm} knownTypes={knownTypes}
          listId={`loc-types-new-${node.id}`}
          onSave={() => onSave(editMode)} onCancel={() => setEditMode(null)}
          saving={saving} saveError={saveError} label="Add child location"
          locationTypeColors={locationTypeColors} />
      )}

      {!isCollapsed && node.children.length > 0 && (
        <div className="ml-5 border-l border-white/[0.06] my-0.5">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child}
              allItems={allItems} byId={byId} knownTypes={knownTypes}
              editMode={editMode} setEditMode={setEditMode}
              form={form} setForm={setForm}
              onSave={onSave} onDelete={onDelete}
              saving={saving} saveError={saveError}
              collapsed={collapsed} toggleCollapse={toggleCollapse}
              locationTypeColors={locationTypeColors} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Locations() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'editor'
  const { locationTypeColors } = useColorSettings()
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [form, setForm] = useState<NodeForm>({ name: '', type: '', parent_id: null })
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [topExpanded, setTopExpanded] = useState<Set<number>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)

  const toggleTopExpanded = (id: number) =>
    setTopExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const { data: tree = [] } = useQuery<LocationNode[]>({
    queryKey: ['locations'],
    queryFn: async () => { const { data } = await api.get('/locations'); return data },
  })

  const allItems = useMemo(() => flattenTree(tree), [tree])
  const byId = useMemo(() => Object.fromEntries(allItems.map((i) => [i.id, i])), [allItems])
  const totalCount = useMemo(() => countNodes(tree), [tree])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['locations'] })

  const saveMutation = useMutation({
    mutationFn: (mode: EditMode) => {
      if (!mode) throw new Error()
      const body = { name: form.name, type: form.type || null, parent_id: form.parent_id }
      return mode.kind === 'new'
        ? api.post('/locations', body)
        : api.put(`/locations/${mode.id}`, body)
    },
    onSuccess: () => { setSaveError(null); invalidate(); setEditMode(null) },
    onError: (err: any) => setSaveError(err.response?.data?.detail || err.message || 'Save failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/locations/${id}`),
    onSuccess: invalidate,
    onError: (err: any) => setSaveError(err?.response?.data?.detail ?? err?.message ?? 'Delete failed'),
  })

  const toggleCollapse = (id: number) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const commonNodeProps = {
    allItems, byId,
    editMode, setEditMode, form, setForm,
    onSave: (mode: EditMode) => saveMutation.mutate(mode),
    onDelete: (id: number) => deleteMutation.mutate(id),
    saving: saveMutation.isPending, saveError, collapsed, toggleCollapse,
    locationTypeColors, canEdit,
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/settings')} className="btn-ghost flex items-center gap-1.5 text-sm">
            <ChevronLeft size={14} />
            Settings
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Locations</h1>
            <p className="text-sm text-white/40 mt-0.5">{totalCount} location{totalCount !== 1 ? 's' : ''}</p>
          </div>
        </div>
        {canEdit && (
          <button type="button"
            onClick={() => { setSaveError(null); setForm({ name: '', type: '', parent_id: null }); setEditMode({ kind: 'new', parentId: null }) }}
            className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Add Location
          </button>
        )}
      </div>

      {/* Root new-location form */}
      {editMode?.kind === 'new' && editMode.parentId === null && (
        <div className="rounded-xl border border-indigo-500/30 p-4 space-y-3"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, #6366f1 8%, var(--card-base-deep)) 0%, var(--card-base-deepest) 100%)' }}>
          <p className="text-xs font-semibold text-indigo-300">New Top-Level Location</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Name</label>
              <input autoFocus className="glass-input text-sm w-full" placeholder="e.g. Home"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveMutation.mutate(editMode); if (e.key === 'Escape') setEditMode(null) }} />
            </div>
            <div>
              <label className="block text-[10px] text-white/40 mb-1">Type</label>
              <input className="glass-input text-sm w-full" placeholder="e.g. Building, Premises"
                value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                list="loc-type-root-suggestions"
                onKeyDown={(e) => { if (e.key === 'Enter') saveMutation.mutate(editMode); if (e.key === 'Escape') setEditMode(null) }} />
              <datalist id="loc-type-root-suggestions">
                {[...new Set(allItems.map(i => i.type).filter((t): t is string => !!t))].map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!form.name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate(editMode)}
              className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Check size={13} /> Create
            </button>
            <button type="button" onClick={() => { setSaveError(null); setEditMode(null) }} className="btn-ghost text-sm">Cancel</button>
            {!form.name.trim() && <span className="text-[10px] text-white/25 italic">Enter a name first</span>}
            {saveError && <span className="text-[10px] text-red-400">{saveError}</span>}
          </div>
        </div>
      )}

      {/* Empty state */}
      {tree.length === 0 && editMode === null && (
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
            <MapPin size={22} className="text-indigo-400/50" />
          </div>
          <p className="text-sm text-white/40">No locations yet</p>
          <p className="text-xs mt-1 text-white/20">Add a location and give it a type like "Room" or "Building"</p>
        </div>
      )}

      {/* Top-level location cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {tree.map((node) => {
          const cardItems = flattenNode(node)
          const cardById = Object.fromEntries(cardItems.map(i => [i.id, i]))
          const cardTypes = [...new Set(cardItems.map(i => i.type).filter((t): t is string => !!t))]
          const isTopExpanded = topExpanded.has(node.id)
          const isEditingHeader = editMode?.kind === 'edit' && editMode.id === node.id
          const typeHex = node.type ? (locationTypeColors[node.type] ?? '#6b7280') : '#6366f1'

          return (
            <div key={node.id} className="glass-card overflow-hidden"
              style={{ borderTopColor: typeHex + '40' }}>

              {/* Card header */}
              {isEditingHeader ? (
                <div className="px-4 py-3 space-y-3 border-b border-white/[0.06]">
                  <p className="text-[10px] font-semibold text-indigo-300/60 uppercase tracking-widest">Edit location</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-white/35 mb-1">Name</label>
                      <input autoFocus className="glass-input text-sm w-full" value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveMutation.mutate(editMode); if (e.key === 'Escape') setEditMode(null) }} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/35 mb-1">Type</label>
                      <input className="glass-input text-sm w-full" placeholder="e.g. Building"
                        value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                        list={`loc-types-hdr-${node.id}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveMutation.mutate(editMode); if (e.key === 'Escape') setEditMode(null) }} />
                      <datalist id={`loc-types-hdr-${node.id}`}>{cardTypes.map(t => <option key={t} value={t} />)}</datalist>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={!form.name.trim() || saveMutation.isPending}
                      onClick={() => saveMutation.mutate(editMode)}
                      className="btn-primary text-xs flex items-center gap-1 disabled:opacity-40 py-1 px-3">
                      <Check size={11} /> Save
                    </button>
                    <button type="button" onClick={() => { setSaveError(null); setEditMode(null) }} className="btn-ghost text-xs py-1">Cancel</button>
                    {saveError && <span className="text-[10px] text-red-400">{saveError}</span>}
                  </div>
                </div>
              ) : (
                <div className="flex group"
                  style={{ borderBottom: isTopExpanded ? '1px solid var(--glass-border)' : 'none' }}>

                  {/* Chevron handle */}
                  <button type="button" onClick={() => toggleTopExpanded(node.id)}
                    className="flex items-center justify-center w-10 flex-shrink-0 border-r border-white/[0.06]
                               hover:bg-white/[0.03] transition-colors duration-150">
                    {isTopExpanded
                      ? <ChevronDown size={13} className="text-white/25" />
                      : <ChevronRight size={13} className="text-white/25" />}
                  </button>

                  {/* Header content */}
                  <div className="flex-1 flex items-center gap-3 px-3 py-2.5 min-w-0">
                    {/* Icon box */}
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 border"
                      style={{ backgroundColor: typeHex + '1a', borderColor: typeHex + '40' }}>
                      <MapPin size={12} style={{ color: typeHex }} />
                    </div>

                    <span className="text-sm font-semibold text-white flex-1 min-w-0 truncate">{node.name}</span>
                    {node.is_permanent && <Lock size={10} className="text-white/20 flex-shrink-0" />}

                    {/* Metadata */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-[52px] flex justify-end">
                        <TypeBadge type={node.type} color={node.type ? locationTypeColors[node.type] : undefined} />
                      </div>
                      <div className="w-[40px] flex justify-end">
                        {node.device_count > 0 && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-[9px] text-white/30 tabular-nums leading-none">
                            <Monitor size={8} className="opacity-70 flex-shrink-0" />
                            {node.device_count}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {canEdit && (confirmDeleteId === node.id ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[11px] text-white/40">Delete?</span>
                        <button type="button"
                          onClick={() => { deleteMutation.mutate(node.id); setConfirmDeleteId(null) }}
                          className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors">
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)}
                          className="btn-ghost p-1 text-white/30"><X size={11} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 overflow-hidden max-w-0 group-hover:max-w-[68px] opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out flex-shrink-0">
                        <button type="button" aria-label="Add child"
                          onClick={() => { toggleTopExpanded(node.id); setForm({ name: '', type: '', parent_id: node.id }); setEditMode({ kind: 'new', parentId: node.id }) }}
                          className="btn-ghost p-1 text-white/25 hover:text-indigo-300 flex-shrink-0"><Plus size={11} /></button>
                        {!node.is_permanent && (
                          <button type="button" aria-label={`Edit ${node.name}`}
                            onClick={() => { setForm({ name: node.name, type: node.type ?? '', parent_id: node.parent_id }); setEditMode({ kind: 'edit', id: node.id }) }}
                            className="btn-ghost p-1 text-white/25 hover:text-white flex-shrink-0"><Pencil size={11} /></button>
                        )}
                        {!node.is_permanent && (
                          <button type="button" aria-label={`Delete ${node.name}`}
                            onClick={() => setConfirmDeleteId(node.id)}
                            className="btn-ghost p-1 text-white/25 hover:text-red-400 flex-shrink-0"><Trash2 size={11} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Children tree */}
              {isTopExpanded && (node.children.length > 0 || (editMode?.kind === 'new' && editMode.parentId === node.id)) && (
                <div className="pt-1.5 pb-2">
                  {node.children.map((child) => (
                    <TreeNode key={child.id} node={child}
                      {...commonNodeProps} allItems={cardItems} byId={cardById} knownTypes={cardTypes} />
                  ))}
                  {editMode?.kind === 'new' && editMode.parentId === node.id && (
                    <InlineForm form={form} onChange={setForm} knownTypes={cardTypes}
                      listId={`loc-types-card-${node.id}`}
                      onSave={() => saveMutation.mutate(editMode)}
                      onCancel={() => { setSaveError(null); setEditMode(null) }}
                      saving={saveMutation.isPending} saveError={saveError}
                      label="Add child location" locationTypeColors={locationTypeColors} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
