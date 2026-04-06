/** Network accent colours — keyed by VLAN ID */
export const VLAN_COLORS: Record<number, string> = {
  1: '#6366f1',    // Core — indigo
  20: '#3b82f6',   // Trusted — blue
  40: '#f59e0b',   // IoT — amber
  75: '#ef4444',   // Pentest — red
  254: '#8b5cf6',  // DMZ — violet
}

export const DEFAULT_NETWORK_COLOR = '#64748b'  // slate

/** Device type colours */
export const DEVICE_TYPE_COLORS: Record<string, string> = {
  'Windows PC': '#3b82f6',
  'Mac': '#a855f7',
  'Linux PC': '#f97316',
  'SBC (Raspberry Pi)': '#ef4444',
  'Microcontroller': '#10b981',
  'Phone': '#06b6d4',
  'Tablet': '#06b6d4',
  'Watch': '#64748b',
  'IoT Device': '#f59e0b',
  'Smart Speaker': '#f59e0b',
  '3D Printer': '#8b5cf6',
  'Label Printer': '#64748b',
  'Network Switch': '#0ea5e9',
  'Router / Gateway': '#0ea5e9',
  'Access Point': '#0ea5e9',
  'Access Point - With Switch': '#0ea5e9',
  'Server': '#6366f1',
  'Virtual Machine': '#6366f1',
  'Games Console': '#ec4899',
  'Dock / Peripheral': '#64748b',
  'Energy Monitor': '#f59e0b',
}

export const STATUS_COLORS = {
  in_service: '#10b981',
  undeployed: '#f59e0b',
  stock: '#64748b',
  decommissioned: '#ef4444',
}

export const SEVERITY_COLORS: Record<string, string> = {
  system: '#64748b',
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#ef4444',
}

export const CATEGORY_LABELS: Record<string, string> = {
  device: 'Device',
  network: 'Network',
  monitoring: 'Monitoring',
  conflict: 'Conflict',
  security: 'Security',
  system: 'System',
}
