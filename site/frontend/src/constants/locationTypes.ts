export const LOCATION_TYPE_PALETTE: Record<string, { text: string; bg: string; border: string; hex: string }> = {
  'Room':      { text: 'text-indigo-300/80',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/25', hex: 'rgba(165,180,252,0.8)'  },
  'Area':      { text: 'text-emerald-300/80', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', hex: 'rgba(110,231,183,0.8)' },
  'Premises':  { text: 'text-violet-300/80',  bg: 'bg-violet-500/10',  border: 'border-violet-500/25', hex: 'rgba(196,181,253,0.8)'  },
  'Building':  { text: 'text-sky-300/80',     bg: 'bg-sky-500/10',     border: 'border-sky-500/25',    hex: 'rgba(125,211,252,0.8)'  },
  'Draw':      { text: 'text-amber-300/80',   bg: 'bg-amber-500/10',   border: 'border-amber-500/25',  hex: 'rgba(252,211,77,0.8)'   },
  'Container': { text: 'text-orange-300/80',  bg: 'bg-orange-500/10',  border: 'border-orange-500/25', hex: 'rgba(253,186,116,0.8)'  },
  'Storage':   { text: 'text-slate-300/70',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20',  hex: 'rgba(203,213,225,0.7)'  },
  'Shelf':     { text: 'text-cyan-300/80',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/25',   hex: 'rgba(103,232,249,0.8)'  },
  'Rack':      { text: 'text-rose-300/80',    bg: 'bg-rose-500/10',    border: 'border-rose-500/25',   hex: 'rgba(253,164,175,0.8)'  },
}

export const LOCATION_TYPE_DEFAULT = {
  text: 'text-white/35',
  bg: 'bg-white/[0.04]',
  border: 'border-white/[0.09]',
  hex: 'rgba(255,255,255,0.35)',
}
