"""
Unified port resolution — single source of truth for all port display data.

Rules:
  1. downstream_devices (Device.upstream_port_id) is the sole authority for downlinks.
     A port is a downlink if and only if a device has registered this port as its upstream_port_id.
     VLAN/color enrichment priority:
       a. NIC from the same device physically linked to this port (switch_port_id match).
       b. Any NIC on the downstream device that has a network assigned (fallback — covers
          the common case where upstream_port_id is set but the NIC's switch_port_id isn't).
  2. If no downstream_devices but a NIC is connected: the port shows as a connected device.
     Device type is irrelevant — a management port with a NIC is just a port with a NIC.
"""


def _enrich_vlan(base: dict, dev) -> None:
    """Populate connected_vlan_id / connected_network_color from a device's NICs."""
    for nic in dev.nics:
        if nic.network:
            base["connected_vlan_id"]       = nic.network.vlan_id
            base["connected_network_color"] = nic.network.color
            return


def resolve_port(p) -> dict:
    base = {
        "id":                     p.id,
        "device_id":              p.device_id,
        "port_number":            p.port_number,
        "port_name":              p.port_name,
        "port_type":              p.port_type.value,
        "poe_enabled":            p.poe_enabled,
        "poe_budget_w":           p.poe_budget_w,
        "speed":                  p.speed,
        "notes":                  p.notes,
        "label":                  p.label,
        "is_management":          p.is_management,
        "connected_device_id":    None,
        "connected_device_name":  None,
        "connected_nic_label":    None,
        "connected_vlan_id":      None,
        "connected_network_color": None,
        "is_downlink":            False,
        "remote_port_number":     None,
        "remote_port_name":       None,
        "mgmt_network_id":        p.mgmt_network_id,
        "mgmt_ip_address":        p.mgmt_ip_address,
        "mgmt_network_name":      p.mgmt_network.name if p.mgmt_network_id and hasattr(p, 'mgmt_network') and p.mgmt_network else None,
    }

    # Uplink port — this port is the device's own uplink to its upstream switch
    if p.device.uplink_port_id == p.id:
        upstream = p.device.upstream_device
        upstream_port = p.device.upstream_port
        base["connected_device_name"] = upstream.name if upstream else "Upstream switch"
        base["connected_device_id"]   = upstream.id if upstream else -1
        base["connected_nic_label"]   = "Uplink connection"
        if upstream_port:
            base["remote_port_number"] = upstream_port.port_number
            base["remote_port_name"]   = upstream_port.port_name
        _enrich_vlan(base, p.device)
        return base

    # Management port — check for OOB switch connection or IP-based management
    if p.is_management:
        if p.mgmt_network_id or p.mgmt_ip_address:
            base["connected_device_name"] = p.mgmt_ip_address or "Management"
            base["connected_device_id"]   = -1   # sentinel: in use but not a device
            base["connected_nic_label"]   = "OOB management"
            return base
        # Check device's own NICs for a NIC that plugs into a different switch
        # (the management NIC's switch_port_id points to the OOB management switch)
        for nic in p.device.nics:
            sp = nic.switch_port_rel
            if sp and sp.device_id != p.device_id:
                oob_switch = sp.device
                base["connected_device_id"]   = oob_switch.id if oob_switch else -1
                base["connected_device_name"] = oob_switch.name if oob_switch else "OOB Switch"
                base["connected_nic_label"]   = "OOB management"
                base["remote_port_number"]    = sp.port_number
                base["remote_port_name"]      = sp.port_name
                return base
        return base  # management port with no connection configured

    if p.downstream_devices:
        # Downstream device registered this port as its upstream — it is a downlink.
        dev = p.downstream_devices[0]
        base["connected_device_id"]   = dev.id
        base["connected_device_name"] = dev.name
        base["connected_nic_label"]   = "Uplink"
        base["is_downlink"]           = True
        # The remote port is the uplink port on the downstream switch
        if dev.uplink_port:
            base["remote_port_number"] = dev.uplink_port.port_number
            base["remote_port_name"]   = dev.uplink_port.port_name
        # Try exact NIC match (same device, NIC physically linked to this port) first.
        enriched = False
        for nic in p.nics:
            if nic.device_id == dev.id and nic.network:
                base["connected_vlan_id"]       = nic.network.vlan_id
                base["connected_network_color"] = nic.network.color
                enriched = True
                break
        # Fall back to any NIC on the downstream device that has a network assigned.
        if not enriched:
            _enrich_vlan(base, dev)

    elif p.nics:
        # A NIC is plugged into this port — show as connected device regardless of device type.
        nic = p.nics[0]
        dev = nic.device
        base["connected_device_id"]    = nic.device_id
        base["connected_device_name"]  = dev.name if dev else None
        base["connected_nic_label"]    = nic.label or nic.nic_type.value
        base["connected_vlan_id"]      = nic.network.vlan_id if nic.network else None
        base["connected_network_color"] = nic.network.color if nic.network else None

    return base
