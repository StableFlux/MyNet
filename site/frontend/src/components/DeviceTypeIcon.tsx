import {
  HelpCircle, LucideProps, LucideIcon,
  Home, Building2, DoorOpen, Server, Layers, Inbox, Box, Archive, Database,
  Wrench, Car, TreePine, FlaskConical, MapPin, Package,
  CheckCircle, XCircle, Clock,
  // Compute
  CircuitBoard, Monitor, Laptop, MonitorDot, PcCase,
  // Networking
  Network, Router, Wifi, Shield, ShieldAlert, Cable, Globe, Signal,
  // Storage
  HardDrive,
  // Mobile / Wearable
  Smartphone, Tablet, Watch,
  // Smart Home / IoT
  Volume2, Bot, ToggleRight, Plug, Activity, Cpu,
  Lightbulb, Thermometer, Lock, Droplets, Wind, Sun, Filter,
  // A/V / Entertainment
  Camera, Tv, Tv2, Projector, Film, Cast, Music, Headphones, Radio, PlayCircle,
  // Peripherals
  Printer, Scan, ScanLine, BatteryCharging, Battery, PenTool, Tag,
  // Power
  Zap, ZapOff, Gauge, PlugZap, Power, PowerSquare,
  // Servers & VMs
  Terminal, GitBranch, Loader,
  // Security
  Bell, PhoneCall,
  // Misc
  BookOpen, Gamepad2,
} from 'lucide-react'

// Static lookup replaces `import * as LucideIcons` — enables tree-shaking.
// Add an entry here whenever a new icon name appears in the backend seed data.
const HARDWARE_ICON_MAP: Record<string, LucideIcon> = {
  // ── Compute ─────────────────────────────────────────────────────────────────
  'circuit-board':  CircuitBoard,
  'pc-case':        PcCase,
  'monitor':        Monitor,
  'monitor-dot':    MonitorDot,
  'laptop':         Laptop,
  'server':         Server,
  'terminal':       Terminal,
  'git-branch':     GitBranch,
  'loader':         Loader,
  // ── Networking ───────────────────────────────────────────────────────────────
  'network':        Network,
  'router':         Router,
  'wifi':           Wifi,
  'shield':         Shield,
  'shield-alert':   ShieldAlert,
  'cable':          Cable,
  'signal':         Signal,
  // ── Storage ───────────────────────────────────────────────────────────────────
  'database':       Database,
  'archive':        Archive,
  'hard-drive':     HardDrive,
  // ── Mobile / Wearable ─────────────────────────────────────────────────────────
  'smartphone':     Smartphone,
  'tablet':         Tablet,
  'watch':          Watch,
  // ── Smart Home / IoT ──────────────────────────────────────────────────────────
  'volume-2':       Volume2,
  'bot':            Bot,
  'toggle-right':   ToggleRight,
  'plug':           Plug,
  'activity':       Activity,
  'cpu':            Cpu,
  'lightbulb':      Lightbulb,
  'thermometer':    Thermometer,
  'lock':           Lock,
  'droplets':       Droplets,
  'wind':           Wind,
  'sun':            Sun,
  'filter':         Filter,
  // ── A/V / Entertainment ───────────────────────────────────────────────────────
  'camera':         Camera,
  'tv':             Tv,
  'tv-2':           Tv2,
  'projector':      Projector,
  'film':           Film,
  'cast':           Cast,
  'music':          Music,
  'headphones':     Headphones,
  'radio':          Radio,
  'play-circle':    PlayCircle,
  // ── Peripherals ───────────────────────────────────────────────────────────────
  'printer':        Printer,
  'scan':           Scan,
  'scan-line':      ScanLine,
  'layers':         Layers,
  'battery-charging': BatteryCharging,
  'battery':        Battery,
  'pen-tool':       PenTool,
  'tag':            Tag,
  // ── Power ─────────────────────────────────────────────────────────────────────
  'zap':            Zap,
  'zap-off':        ZapOff,
  'gauge':          Gauge,
  'plug-zap':       PlugZap,
  'power':          Power,
  'power-square':   PowerSquare,
  'car':            Car,
  'wrench':         Wrench,
  // ── Security ──────────────────────────────────────────────────────────────────
  'bell':           Bell,
  'phone-call':     PhoneCall,
  // ── Misc ──────────────────────────────────────────────────────────────────────
  'book-open':      BookOpen,
  'gamepad-2':      Gamepad2,
  'box':            Box,
  'globe':          Globe,
  'layout':         Layers,   // 'layout' legacy name — map to Layers as closest equivalent
  'package':        Package,
}

export const HARDWARE_TYPE_ICON: Record<string, string> = {
  // ── Compute ───────────────────────────────────────────────────────────────
  'SBC': 'circuit-board',
  'Mini PC': 'pc-case',
  'Desktop': 'monitor',
  'Laptop': 'laptop',
  'Server': 'server',
  'Workstation': 'monitor-dot',
  'Thin Client': 'monitor',
  // ── Networking ────────────────────────────────────────────────────────────
  'Network Switch': 'network',
  'Router': 'router',
  'Wireless AP': 'wifi',
  'Firewall': 'shield',
  'Modem': 'cable',
  // ── Storage ───────────────────────────────────────────────────────────────
  'NAS': 'database',
  'DAS': 'archive',
  // ── Mobile / Wearable ─────────────────────────────────────────────────────
  'Mobile': 'smartphone',
  'Tablet': 'tablet',
  'Wearable': 'watch',
  // ── Smart Home / IoT ──────────────────────────────────────────────────────
  'Smart Speaker': 'volume-2',
  'Smart Assistant': 'bot',
  'Smart Switch': 'toggle-right',
  'Smart Plug': 'plug',
  'Sensor': 'activity',
  'Microcontroller': 'cpu',
  // ── A/V ───────────────────────────────────────────────────────────────────
  'Camera': 'camera',
  'NVR': 'hard-drive',
  'Media Player': 'tv',
  'Display': 'monitor',
  'Projector': 'projector',
  // ── Peripherals ───────────────────────────────────────────────────────────
  'Printer': 'printer',
  '3D Printer': 'layers',
  'Scanner': 'scan',
  // ── Power ─────────────────────────────────────────────────────────────────
  'UPS': 'battery-charging',
  'PDU': 'power-square',
  'Power Strip': 'plug',
  'USB Charger': 'plug-zap',
  'PoE Injector': 'zap',
  'EV Charger': 'car',
  'Solar Inverter': 'sun',
  'Generator': 'zap-off',
  // ── Maker & Projects ──────────────────────────────────────────────────────
  'FPGA': 'cpu',
  // ── Other ─────────────────────────────────────────────────────────────────
  'Other': 'package',
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
  // ── Power ─────────────────────────────────────────────────────────────────
  'UPS': 'Power',
  'PDU': 'Power',
  'Power Strip': 'Power',
  'USB Charger': 'Power',
  'PoE Injector': 'Power',
  'EV Charger': 'Power',
  'Solar Inverter': 'Power',
  'Generator': 'Power',
  // ── Maker & Projects ──────────────────────────────────────────────────────
  'FPGA': 'Maker & Projects',
  // ── Other ─────────────────────────────────────────────────────────────────
  'Other': 'Other',
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

export const NIC_TYPE_ICON: Record<string, LucideIcon> = {
  ETH:  Cable,
  WIFI: Wifi,
  VIRT: Layers,
  SFP:  Cable,
  QSFP: Cable,
  WAN:  Globe,
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
