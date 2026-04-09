export interface Network {
  id: number
  name: string
  vlan_id: number | null
  cidr: string | null
  gateway: string | null
  dhcp_range_start: string | null
  dhcp_range_end: string | null
  dns_primary: string | null
  dns_secondary: string | null
  purpose: string | null
  ssids: string[] | null
  color: string
  icon: string | null
  notes: string | null
}

export interface ServiceEntry {
  name: string
  url: string | null
  port: number | null
}

export interface DriveEntry {
  label: string
  capacity: string | null
  type: string | null
}

export interface VmGuest {
  id: number
  name: string
  status: string
  device_type_name: string | null
  primary_ip: string | null
}

export interface ResolvedPort {
  id: number
  device_id: number
  port_number: number
  port_name: string | null
  port_type: string
  poe_enabled: boolean
  poe_budget_w: number | null
  speed: string | null
  notes: string | null
  label: string
  is_management: boolean
  connected_device_id: number | null
  connected_device_name: string | null
  connected_nic_label: string | null
  connected_vlan_id: number | null
  connected_network_color: string | null
  is_downlink: boolean
  remote_port_number: number | null
  remote_port_name: string | null
}

export interface Nic {
  id: number
  device_id: number
  label: string | null
  nic_type: 'ETH' | 'WIFI' | 'VIRT' | 'SFP' | 'QSFP' | 'WAN'
  mac: string | null
  ip_address: string | null
  dns_entry: string | null
  network_id: number | null
  address_type: 'reserved' | 'static' | 'dhcp' | null
  switch_port: string | null
  switch_port_id: number | null
  switch_port_label: string | null
  switch_device_id: number | null
  switch_device_name: string | null
  poe_enabled: boolean | null
  ssid: string | null
  band: string | null
  notes: string | null
  is_active: boolean
  // Joined
  network_name?: string
  network_color?: string
  vlan_id?: number | null
}

export interface Device {
  id: number
  name: string
  use: string | null
  device_type_id: number | null
  device_type_name: string | null
  device_type_category: string | null
  device_type_icon: string | null
  hardware_type: string | null
  brand: string | null
  model: string | null
  cpu: string | null
  ram: string | null
  gpu: string | null
  os: string | null
  os_version: string | null
  hostname: string | null
  username: string | null
  has_password: boolean
  ssh_enabled: boolean
  ssh_port: number | null
  status: 'in_service' | 'undeployed' | 'stock' | 'decommissioned'
  location: string | null
  location_id: number | null
  storage_location: string | null
  purchase_date: string | null
  url: string | null
  service_name: string | null
  service_port: number | null
  hypervisor_device_id: number | null
  hypervisor_name: string | null
  firmware_type: string | null
  bed_size: string | null
  mcu_board: string | null
  ha_entity_id: string | null
  pihole_enabled: boolean
  pihole_nic_id: number | null
  pihole_password_set: boolean
  drives: DriveEntry[]
  services: ServiceEntry[]
  wol_enabled: boolean
  monitoring_enabled: boolean
  monitor_interval_secs: number
  monitor_target_nic_id: number | null
  monitor_nic_ids: number[] | null
  notes: string | null
  nics: Nic[]
  switch_ports: ResolvedPort[]
  uplink_port_id: number | null
  uplink_port_label: string | null
  upstream_device_id: number | null
  upstream_device_name: string | null
  upstream_port_id: number | null
  upstream_port_label: string | null
  port_display_rows: number
  port_numbering: 'alternating' | 'sequential'
  vm_guests: VmGuest[]
}

export interface DeviceType {
  id: number
  name: string
  icon: string | null
  color: string
  fields_schema: Record<string, boolean>
  is_system: boolean
}

export interface User {
  id: number
  username: string
  display_name: string
  email: string | null
  role: 'admin' | 'editor' | 'viewer'
  is_active: boolean
  last_login: string | null
}

export interface AuditEntry {
  id: number
  entity_type: string
  entity_id: number | null
  entity_name: string | null
  action: string
  changed_fields: string[] | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  username: string | null
  timestamp: string
}

export interface Alert {
  id: number
  alert_type: string
  device_id: number | null
  message: string
  severity: 'info' | 'warning' | 'critical'
  created_at: string
  acknowledged_at: string | null
}

export interface MonitoringStatus {
  device_id: number
  current_status: 'up' | 'down' | 'timeout' | 'unknown'
  current_latency: number | null
  last_checked: string | null
}

export interface SubnetEntry {
  ip: string
  status: 'occupied' | 'reserved' | 'dhcp' | 'free'
  device_id?: number
  device_name?: string
  category?: string
}
