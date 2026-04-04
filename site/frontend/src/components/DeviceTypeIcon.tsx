import {
  HelpCircle, LucideProps, LucideIcon,
  Home, Building2, DoorOpen, Server, Layers, Inbox, Box, Archive, Database,
  Wrench, Car, TreePine, FlaskConical, MapPin, Package,
  CheckCircle, XCircle, Clock,
  // Hardware type icons
  CircuitBoard, Monitor, Laptop, MonitorDot,
  Network, Router, Wifi, Shield, Cable,
  Smartphone, Tablet, Watch,
  Volume2, Bot, ToggleRight, Plug, Activity, Cpu,
  Camera, HardDrive, Tv, Projector,
  Printer, Scan, BatteryCharging,
  PcCase,
} from 'lucide-react'

// Static lookup replaces `import * as LucideIcons` — enables tree-shaking.
// Add an entry here whenever a new icon name is used in HARDWARE_TYPE_ICON.
const HARDWARE_ICON_MAP: Record<string, LucideIcon> = {
  'circuit-board':    CircuitBoard,
  'pc-case':          PcCase,
  'monitor':          Monitor,
  'laptop':           Laptop,
  'server':           Server,
  'monitor-dot':      MonitorDot,
  'network':          Network,
  'router':           Router,
  'wifi':             Wifi,
  'shield':           Shield,
  'cable':            Cable,
  'database':         Database,
  'archive':          Archive,
  'smartphone':       Smartphone,
  'tablet':           Tablet,
  'watch':            Watch,
  'volume-2':         Volume2,
  'bot':              Bot,
  'toggle-right':     ToggleRight,
  'plug':             Plug,
  'activity':         Activity,
  'cpu':              Cpu,
  'camera':           Camera,
  'hard-drive':       HardDrive,
  'tv':               Tv,
  'projector':        Projector,
  'printer':          Printer,
  'layers':           Layers,
  'scan':             Scan,
  'battery-charging': BatteryCharging,
}

export const HARDWARE_TYPE_ICON: Record<string, string> = {
  // ── Compute ───────────────────────────────────────────────────────────────
  'SBC': 'circuit-board',    // matches SBC (Raspberry Pi) sub-type
  'Mini PC': 'pc-case',       // no sub-type; dedicated PC case icon
  'Desktop': 'monitor',      // matches Windows/Mac/Linux PC (Desktop) sub-types
  'Laptop': 'laptop',        // matches all Laptop sub-types
  'Server': 'server',        // matches Server sub-types
  'Workstation': 'monitor-dot', // no sub-type; dot distinguishes from plain Desktop
  'Thin Client': 'monitor',  // no sub-type equivalent
  // ── Networking ────────────────────────────────────────────────────────────
  'Network Switch': 'network',  // matches Network Switch sub-type
  'Router': 'router',           // matches Router / Gateway sub-type
  'Wireless AP': 'wifi',        // matches Access Point sub-type
  'Firewall': 'shield',         // matches Firewall sub-type
  'Modem': 'cable',             // no sub-type equivalent
  // ── Storage ───────────────────────────────────────────────────────────────
  'NAS': 'database',     // matches NAS sub-type
  'DAS': 'archive',      // no sub-type; archive distinguishes from NAS
  // ── Mobile / Wearable ─────────────────────────────────────────────────────
  'Mobile': 'smartphone',  // matches Phone sub-type
  'Tablet': 'tablet',      // matches Tablet sub-type
  'Wearable': 'watch',     // matches Watch sub-type
  // ── Smart Home / IoT ──────────────────────────────────────────────────────
  'Smart Speaker': 'volume-2',    // matches Smart Speaker (IoT) sub-type
  'Smart Assistant': 'bot',       // no sub-type equivalent
  'Smart Switch': 'toggle-right', // matches Switch / Plug (IoT) sub-type
  'Smart Plug': 'plug',           // semantically distinct from switch
  'Sensor': 'activity',           // matches Sensor (IoT) sub-type
  'Microcontroller': 'cpu',       // matches Microcontroller sub-type
  // ── A/V ───────────────────────────────────────────────────────────────────
  'Camera': 'camera',      // matches IP Camera / Camera sub-types
  'NVR': 'hard-drive',     // matches NVR sub-type
  'Media Player': 'tv',    // matches Media Player (IoT) sub-type
  'Display': 'monitor',    // matches Display (IoT) sub-type
  'Projector': 'projector',// matches Projector sub-type
  // ── Peripherals ───────────────────────────────────────────────────────────
  'Printer': 'printer',    // matches Printer (Document) sub-type
  '3D Printer': 'layers',  // matches Printer (3D) sub-type
  'Scanner': 'scan',       // matches Scanner sub-type
  'UPS': 'battery-charging', // matches UPS sub-type
}

export const HARDWARE_TYPE_CATEGORY: Record<string, string> = {
  'SBC': 'Compute',
  'Mini PC': 'Compute',
  'Desktop': 'Compute',
  'Laptop': 'Compute',
  'Server': 'Compute',
  'Workstation': 'Compute',
  'Thin Client': 'Compute',
  'Network Switch': 'Networking',
  'Router': 'Networking',
  'Wireless AP': 'Networking',
  'Firewall': 'Networking',
  'Modem': 'Networking',
  'NAS': 'Storage',
  'DAS': 'Storage',
  'Mobile': 'Mobile / Wearable',
  'Tablet': 'Mobile / Wearable',
  'Wearable': 'Mobile / Wearable',
  'Smart Speaker': 'Smart Home',
  'Smart Assistant': 'Smart Home',
  'Smart Switch': 'Smart Home',
  'Smart Plug': 'Smart Home',
  'Sensor': 'Smart Home',
  'Microcontroller': 'IoT / Embedded',
  'Camera': 'A/V',
  'NVR': 'A/V',
  'Media Player': 'A/V',
  'Display': 'A/V',
  'Projector': 'A/V',
  'Printer': 'Peripherals',
  '3D Printer': 'Peripherals',
  'Scanner': 'Peripherals',
  'UPS': 'Peripherals',
}

export const LOCATION_TYPE_ICON: Record<string, LucideIcon> = {
  'Home':        Home,
  'House':       Home,
  'Building':    Building2,
  'Office':      Building2,
  'Site':        MapPin,
  'Campus':      MapPin,
  'Floor':       Layers,
  'Room':        DoorOpen,
  'Closet':      DoorOpen,
  'Corridor':    DoorOpen,
  'Garage':      Car,
  'Garden':      TreePine,
  'Outdoor':     TreePine,
  'Workshop':    Wrench,
  'Lab':         FlaskConical,
  'Laboratory':  FlaskConical,
  'Data Center': Database,
  'Datacentre':  Database,
  'Server Room': Server,
  'Rack':        Server,
  'Cabinet':     Server,
  'Storage':     Package,
  'Shelf':       Archive,
  'Shelving':    Archive,
  'Drawer':      Inbox,
  'Box':         Box,
  'Bin':         Box,
  'Cupboard':    Package,
}

export const STATUS_ICON: Record<string, LucideIcon> = {
  in_service:     CheckCircle,
  stock:          Package,
  undeployed:     Clock,
  decommissioned: XCircle,
}

export function DeviceTypeIcon({ name, ...props }: { name?: string } & LucideProps) {
  if (!name) return <HelpCircle {...props} />
  const Icon = HARDWARE_ICON_MAP[name]
  return Icon ? <Icon {...props} /> : <HelpCircle {...props} />
}
