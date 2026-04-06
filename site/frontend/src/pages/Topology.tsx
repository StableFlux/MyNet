import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useResolvedTheme } from '../store/themeStore'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  BackgroundVariant, MarkerType,
  Handle, Position,
  useNodes, useEdges,
  type Node, type Edge, type EdgeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from '@dagrejs/dagre'
import { Wifi, Eye, EyeOff } from 'lucide-react'
import { HARDWARE_TYPE_CATEGORY } from '../components/DeviceTypeIcon'
import clsx from 'clsx'
import api from '../lib/api'

// ---------------------------------------------------------------------------
// Node components — uniform size, invisible handles on all 4 sides
// ---------------------------------------------------------------------------
const NODE_W = 260
const NODE_H = 110

/** Invisible handles on every side so FloatingEdge can connect to the closest one */
function AllHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top}    id="t-top"    style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Left}   id="t-left"   style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Right}  id="t-right"  style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Top}    id="s-top"    style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Left}   id="s-left"   style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right}  id="s-right"  style={{ opacity: 0, pointerEvents: 'none' }} />
    </>
  )
}

function InfraNode({ data }: { data: any }) {
  const nc = data.network_color ?? '#64748b'
  return (
    // eslint-disable-next-line react/forbid-component-props
    <div
      className="topology-node rounded-xl px-4 py-3 text-white text-center select-none overflow-hidden"
      style={{ '--nc-bg': `${nc}28`, '--nc-border': `${nc}99` } as React.CSSProperties}
    >
      <AllHandles />
      <p className="text-[10px] uppercase tracking-widest opacity-40 mb-1 truncate">{data.device_type_category ?? HARDWARE_TYPE_CATEGORY[data.hardware_type]}</p>
      <p className="text-[14px] font-bold truncate leading-snug">{data.label}</p>
      {data.ip && <p className="font-mono text-[11px] opacity-55 mt-1 truncate">{data.ip}</p>}
      {data.location && <p className="text-[10px] opacity-30 truncate mt-0.5">{data.location}</p>}
      {data.monitoring_enabled && <div className="w-2 h-2 rounded-full bg-emerald-400 mx-auto mt-1.5 animate-pulse" />}
    </div>
  )
}

function DeviceNode({ data }: { data: any }) {
  const nc = data.network_color ?? '#64748b'
  return (
    // eslint-disable-next-line react/forbid-component-props
    <div
      className="topology-node rounded-xl px-4 py-3 text-white text-center select-none overflow-hidden"
      style={{ '--nc-bg': `${nc}18`, '--nc-border': `${nc}55` } as React.CSSProperties}
    >
      <AllHandles />
      <p className="text-[10px] uppercase tracking-widest opacity-30 mb-1 truncate">{data.device_type_category ?? HARDWARE_TYPE_CATEGORY[data.hardware_type]}</p>
      <p className="text-[14px] font-semibold truncate leading-snug">{data.label}</p>
      {data.ip && <p className="font-mono text-[11px] opacity-45 mt-1 truncate">{data.ip}</p>}
      {data.has_wifi && data.wifi_ssids?.length > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] text-indigo-300/60 mt-1">
          <Wifi size={9} />{data.wifi_ssids[0]}
        </span>
      )}
      {data.monitoring_enabled && <div className="w-2 h-2 rounded-full bg-emerald-400 mx-auto mt-1.5 animate-pulse" />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Routing — clean orthogonal L-shape per edge
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number }
interface ORect { x1: number; y1: number; x2: number; y2: number }

function toORect(n: Node): ORect {
  const p = 8
  return {
    x1: n.position.x - p, y1: n.position.y - p,
    x2: n.position.x + (n.width  ?? NODE_W) + p,
    y2: n.position.y + (n.height ?? NODE_H) + p,
  }
}

const ncx = (n: Node) => n.position.x + (n.width  ?? NODE_W) / 2
const ncy = (n: Node) => n.position.y + (n.height ?? NODE_H) / 2

function segHits(a: Pt, b: Pt, r: ORect): boolean {
  if (Math.abs(a.y - b.y) < 0.5) {
    const y = a.y, xl = Math.min(a.x, b.x), xh = Math.max(a.x, b.x)
    return y > r.y1 && y < r.y2 && xh > r.x1 && xl < r.x2
  }
  const x = a.x, yl = Math.min(a.y, b.y), yh = Math.max(a.y, b.y)
  return x > r.x1 && x < r.x2 && yh > r.y1 && yl < r.y2
}

function waypointsToSvg(raw: Pt[]): string {
  if (raw.length < 2) return ''
  const pts: Pt[] = [raw[0]]
  for (let i = 1; i < raw.length - 1; i++) {
    const a = pts[pts.length - 1], b = raw[i], c = raw[i + 1]
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 0.5) pts.push(b)
  }
  pts.push(raw[raw.length - 1])
  const R = 10
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1]
    const d1 = Math.hypot(c.x - p.x, c.y - p.y) || 1
    const d2 = Math.hypot(n.x - c.x, n.y - c.y) || 1
    const r  = Math.min(R, d1 / 2, d2 / 2)
    const bx = c.x - r * (c.x - p.x) / d1, by = c.y - r * (c.y - p.y) / d1
    const ax = c.x + r * (n.x - c.x) / d2, ay = c.y + r * (n.y - c.y) / d2
    d += ` L ${bx.toFixed(1)} ${by.toFixed(1)} Q ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`
  }
  d += ` L ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`
  return d
}

const LANE = 12

function FloatingEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const nodes = useNodes()
  const edges = useEdges()
  const src = nodes.find(n => n.id === source)
  const tgt = nodes.find(n => n.id === target)
  if (!src || !tgt) return null

  const colour = (style?.stroke as string) ?? '#94a3b8'
  const srcH = src.height ?? NODE_H
  const tgtH = tgt.height ?? NODE_H
  const goDown = ncy(tgt) >= ncy(src)

  // Rules 2 & 3: all edges from this source in the same vertical direction share a face.
  // Same colour → same lane → same exit (sx,sy) → paths overlap forming a trunk.
  // Different colour → different lane → always separate.
  const facePeers = edges.filter(e => {
    if (e.source !== source) return false
    const t = nodes.find(n => n.id === e.target)
    if (!t) return false
    return goDown ? ncy(t) >= ncy(src) : ncy(t) < ncy(src)
  })
  const colours = [...new Set(facePeers.map(e => (e.style?.stroke as string) ?? '#94a3b8'))].sort()
  const offset  = (colours.indexOf(colour) - (colours.length - 1) / 2) * LANE

  // Always exit/enter the vertical face (bottom when going down, top when going up).
  // This keeps all connections out of the horizontal sibling band (Rule 1).
  const sx = ncx(src) + offset
  const sy = goDown ? src.position.y + srcH : src.position.y
  const tx = ncx(tgt) + offset
  const ty = goDown ? tgt.position.y : tgt.position.y + tgtH

  // 3-segment via midY: the midpoint falls in the dagre inter-rank gap → clear of all nodes (Rule 1).
  const midY = (sy + ty) / 2
  const obs   = nodes.filter(n => n.id !== source && n.id !== target).map(toORect)
  const hits  = (pts: Pt[]) => pts.some((p, i) => i < pts.length - 1 && obs.some(r => segHits(p, pts[i+1], r)))
  const cand: Pt[] = [{ x: sx, y: sy }, { x: sx, y: midY }, { x: tx, y: midY }, { x: tx, y: ty }]

  let pts: Pt[]
  if (!hits(cand)) {
    pts = cand
  } else {
    // Rule 1 hard fallback: bypass above or below all nodes
    const allR  = nodes.map(toORect)
    const above = Math.min(...allR.map(r => r.y1)) - 30
    const below = Math.max(...allR.map(r => r.y2)) + 30
    const bypassY = Math.abs(sy - above) <= Math.abs(sy - below) ? above : below
    pts = [{ x: sx, y: sy }, { x: sx, y: bypassY }, { x: tx, y: bypassY }, { x: tx, y: ty }]
  }

  return (
    // eslint-disable-next-line react/forbid-component-props
    <path id={id} className="react-flow__edge-path" d={waypointsToSvg(pts)} markerEnd={markerEnd} style={style} fill="none" />
  )
}

const nodeTypes = { infraNode: InfraNode, deviceNode: DeviceNode }
const edgeTypes = { floatingEdge: FloatingEdge }

// ---------------------------------------------------------------------------
// Tree layout — dagre top-down for everything
// Only used for nodes that have no saved position (first run or new devices).
// ---------------------------------------------------------------------------
function buildLayout(nodes: Node[], edges: Edge[], showWifi: boolean): Node[] {
  const visible = showWifi ? nodes : nodes.filter(n => !n.data.is_wifi_only)
  const ids     = new Set(visible.map(n => n.id))

  const g = new dagre.graphlib.Graph({ multigraph: false })
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 140, marginx: 80, marginy: 80 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of visible) g.setNode(n.id, { width: NODE_W, height: NODE_H })

  const seen = new Set<string>()
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    const key = `${e.source}|${e.target}`
    if (!seen.has(key)) { seen.add(key); g.setEdge(e.source, e.target) }
  }

  dagre.layout(g)

  return visible.map(n => {
    const nd = g.node(n.id)
    return {
      ...n,
      type: n.data.has_switch_ports ? 'infraNode' : 'deviceNode',
      position: nd ? { x: nd.x - NODE_W / 2, y: nd.y - NODE_H / 2 } : { x: 0, y: 0 },
    }
  })
}

// ---------------------------------------------------------------------------
// Edge styles — use floatingEdge renderer
// ---------------------------------------------------------------------------
function styleEdges(edges: any[]): Edge[] {
  return edges.map((e: any) => {
    const isVm     = e.type === 'vmEdge'
    const isUplink = e.type === 'uplinkEdge'
    const color = isVm
      ? '#a78bfa'
      : isUplink
        ? '#e2e8f0'
        : e.data?.network_color ?? '#94a3b8'
    return {
      ...e,
      type: 'floatingEdge',
      markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color },
      style: {
        stroke: color,
        strokeOpacity: isVm ? 0.5 : 0.8,
        strokeDasharray: isVm ? '6,4' : undefined,
        strokeWidth: isUplink ? 2.5 : 1.5,
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Layout persistence — localStorage keyed by node id (= device id string)
// ---------------------------------------------------------------------------
const POSITIONS_KEY = 'mynet-topology-positions'

function loadPositions(): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}') } catch { return {} }
}

function persistPositions(nodes: Node[]) {
  const out: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) out[n.id] = n.position
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(out))
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Topology() {
  const navigate   = useNavigate()
  const [showWifi, setShowWifi] = useState(false)
  const isDark = useResolvedTheme() === 'dark'

  const { data: graphData, isLoading } = useQuery({
    queryKey: ['topology', 'device-graph'],
    queryFn: async () => { const { data } = await api.get('/topology/device-graph'); return data },
  })

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Build layout, but only for nodes with no saved position.
  // Any node the user has manually placed keeps its saved position — forever.
  useEffect(() => {
    if (!graphData) return
    const styledEdges = styleEdges(graphData.edges ?? [])
    const saved       = loadPositions()
    const hasSaved    = Object.keys(saved).length > 0

    let finalNodes: Node[]
    if (hasSaved) {
      // User has a manual layout: run auto-layout only for brand-new nodes
      // (those not yet in localStorage), preserve everything else unchanged.
      const autoNodes = buildLayout(graphData.nodes ?? [], styledEdges, showWifi)
      finalNodes = autoNodes.map(n => saved[n.id] ? { ...n, position: saved[n.id] } : n)
    } else {
      // First ever load — no saved positions — apply full tree layout.
      finalNodes = buildLayout(graphData.nodes ?? [], styledEdges, showWifi)
    }

    setNodes(finalNodes)
    setEdges(styledEdges)
  }, [graphData, showWifi])

  // Persist positions 400 ms after the user stops dragging
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes)
    const hasDrag = changes.some(c => c.type === 'position')
    if (!hasDrag) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setNodes(current => { persistPositions(current); return current })
    }, 400)
  }, [onNodesChange])

  const onNodeClick = useCallback((_: any, node: any) => {
    navigate(`/devices/${node.data.device_id}`)
  }, [navigate])

  const wifiOnlyCount = (graphData?.nodes ?? []).filter((n: any) => n.data?.is_wifi_only).length

  if (isLoading) return (
    <div className="flex flex-col h-full gap-5">
      <h1 className="text-xl font-bold text-white">Topology</h1>
      <div className="glass-card flex-1 min-h-0 animate-pulse" />
    </div>
  )

  return (
    <div className="flex flex-col h-full gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Network Topology</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {(graphData?.nodes ?? []).filter((n: any) => !n.data?.is_wifi_only).length} wired devices
            {wifiOnlyCount > 0 && ` · ${wifiOnlyCount} WiFi-only`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {wifiOnlyCount > 0 && (
            <button
              type="button"
              onClick={() => setShowWifi(v => !v)}
              className={clsx(
                'flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-colors',
                showWifi
                  ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                  : 'btn-ghost border-glass-border text-white/40',
              )}
            >
              {showWifi ? <Eye size={14} /> : <EyeOff size={14} />}
              WiFi-only
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/10">{wifiOnlyCount}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(POSITIONS_KEY)
              const styledEdges = styleEdges(graphData?.edges ?? [])
              setNodes(buildLayout(graphData?.nodes ?? [], styledEdges, showWifi))
            }}
            className="btn-ghost border border-glass-border text-sm text-white/40 px-3 py-1.5"
            title="Clear saved positions and restore auto layout"
          >
            Reset layout
          </button>
        </div>
      </div>

      <div className="glass-card flex-1 min-h-0 p-0 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesConnectable={false}
          snapToGrid
          snapGrid={[20, 20]}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          className="bg-transparent"
          minZoom={0.05}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} color={isDark ? '#ffffff0d' : '#00000012'} gap={24} />
          <Controls className="bg-surface-raised border-glass-border" />
          <MiniMap
            nodeColor={(n) => n.data?.network_color ?? '#64748b'}
            className="bg-surface-raised border border-glass-border rounded-lg"
            maskColor="rgba(0,0,0,0.7)"
            position="top-right"
            style={{ width: 100, height: 75 }}
          />
        </ReactFlow>
      </div>

      <div className="flex items-center gap-5 text-xs text-white/30">
        <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-white/50" /> Uplink</span>
        <span className="flex items-center gap-1.5"><span className="w-5 h-px bg-white/25" /> Switch port</span>
        <span className="flex items-center gap-1.5"><span className="w-5 h-px border-t border-dashed border-violet-400/60" /> VM</span>
        <span className="flex items-center gap-1.5"><Wifi size={11} className="text-indigo-400/60" /> Has WiFi NIC</span>
      </div>
    </div>
  )
}
