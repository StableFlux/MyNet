"""
Network path tracer — BFS walk of actual device connections.
Builds adjacency graph from:
  - Device.upstream_device_id  (switch/device uplinks)
  - Nic.switch_port_id         (end-device → switch connections)
  - Device.hypervisor_device_id (VMs → hypervisor)
Returns an ordered list of hops between two devices.
"""
from collections import deque
from typing import Optional
from sqlalchemy.orm import Session, joinedload, selectinload

from models.device import Device


def trace_path(db: Session, source_id: int, target_id: int) -> dict:
    """
    Returns:
      {
        "found": bool,
        "hops": [
          {
            "device_id": int, "device_name": str, "device_type": str,
            "location": str, "connection_type": str,
            "exit_port": str | None,   # port leaving the PREVIOUS hop
            "entry_port": str | None,  # port arriving at THIS hop
            "vlan_ids": [...], "current_vlan": int | None, "is_vlan_boundary": bool
          }
        ],
        "incomplete": bool
      }
    """
    devices = (
        db.query(Device)
        .options(
            joinedload(Device.device_type),
            joinedload(Device.uplink_port),
            joinedload(Device.upstream_port),
            selectinload(Device.nics).joinedload("switch_port_rel"),
            selectinload(Device.nics).joinedload("network"),
        )
        .all()
    )
    device_map = {d.id: d for d in devices}

    if source_id not in device_map or target_id not in device_map:
        return {"found": False, "hops": [], "incomplete": False}

    # Build adjacency map with directional port info.
    # Each entry: {to, connection_type, exit_port, entry_port, vlan_ids}
    # exit_port  = the port on the SENDING device
    # entry_port = the port on the RECEIVING device
    adj: dict[int, list[dict]] = {}
    seen_pairs: set[tuple] = set()

    def add_edge(a: int, b: int, connection_type: str,
                 exit_port_a=None, entry_port_b=None, vlan_ids=None, conn_color=None):
        key = (min(a, b), max(a, b), connection_type, exit_port_a, entry_port_b)
        if key in seen_pairs:
            return
        seen_pairs.add(key)
        adj.setdefault(a, []).append({
            "to": b, "connection_type": connection_type,
            "exit_port": exit_port_a, "entry_port": entry_port_b,
            "vlan_ids": vlan_ids or [], "conn_color": conn_color,
        })
        # Reverse direction: exit/entry are swapped
        adj.setdefault(b, []).append({
            "to": a, "connection_type": connection_type,
            "exit_port": entry_port_b, "entry_port": exit_port_a,
            "vlan_ids": vlan_ids or [], "conn_color": conn_color,
        })

    for d in devices:
        # Uplink: uplink_port is the port on THIS device, upstream_port is the port on the upstream device.
        if d.upstream_device_id and d.upstream_device_id in device_map:
            exit_port = d.uplink_port.label   if d.uplink_port   else None
            entry     = d.upstream_port.label if d.upstream_port else None
            add_edge(d.id, d.upstream_device_id, "uplink",
                     exit_port_a=exit_port, entry_port_b=entry)

        # VM → hypervisor: no physical ports
        if d.hypervisor_device_id and d.hypervisor_device_id in device_map:
            add_edge(d.id, d.hypervisor_device_id, "vm")

        # NIC → switch: NIC label is exit, switch port label is entry
        for nic in d.nics:
            if nic.switch_port_id and nic.switch_port_rel:
                switch_id = nic.switch_port_rel.device_id
                if switch_id and switch_id in device_map and switch_id != d.id:
                    vlan_ids = [nic.network.vlan_id] if nic.network and nic.network.vlan_id else []
                    add_edge(d.id, switch_id, "access",
                             exit_port_a=nic.label or None,
                             entry_port_b=nic.switch_port_rel.label or None,
                             vlan_ids=vlan_ids)

    # WiFi NIC → AP edges.
    # APs identified by device type name containing "access point" (case-insensitive).
    # The AP's management NIC is typically on a different VLAN than the WiFi client,
    # so we can't match on network_id — we just connect to all APs and let BFS find the shortest path.
    ap_devices = [
        d for d in devices
        if d.device_type and 'access point' in d.device_type.name.lower()
    ]
    for d in devices:
        for nic in d.nics:
            if nic.nic_type.value != "WIFI" or nic.is_active is False:
                continue
            vlan_ids = [nic.network.vlan_id] if nic.network and nic.network.vlan_id else []
            for ap in ap_devices:
                if ap.id == d.id:
                    continue
                add_edge(d.id, ap.id, "wifi",
                         exit_port_a=nic.ssid or nic.label or None,
                         entry_port_b=None,
                         vlan_ids=vlan_ids,
                         conn_color=nic.network.color if nic.network else None)

    # BFS
    visited = {source_id}
    queue = deque([[source_id]])
    path_edges: dict[int, Optional[dict]] = {source_id: None}

    found = False
    while queue:
        path = queue.popleft()
        node = path[-1]
        if node == target_id:
            found = True
            break
        for edge in adj.get(node, []):
            nxt = edge["to"]
            if nxt not in visited:
                visited.add(nxt)
                path_edges[nxt] = {"from": node, **edge}
                queue.append(path + [nxt])

    if not found:
        return {"found": False, "hops": [], "incomplete": False}

    # Reconstruct path
    node = target_id
    reversed_path = []
    while node is not None:
        edge = path_edges[node]
        reversed_path.append((node, edge))
        node = edge["from"] if edge else None

    reversed_path.reverse()

    def get_vlan_for_device(dev: Device) -> tuple[Optional[int], Optional[str]]:
        for nic in dev.nics:
            if nic.network_id and nic.network:
                return nic.network.vlan_id, nic.network.color
        return None, None

    hops = []
    prev_vlan = None
    for device_id, edge in reversed_path:
        dev = device_map.get(device_id)
        if not dev:
            continue
        vlan, vlan_color = get_vlan_for_device(dev)
        is_vlan_boundary = prev_vlan is not None and vlan is not None and vlan != prev_vlan
        hops.append({
            "device_id": device_id,
            "device_name": dev.name,
            "device_type": dev.device_type.name if dev.device_type else None,
            "device_type_icon": dev.device_type.icon if dev.device_type else None,
            "hardware_type": dev.hardware_type,
            "location": dev.location,
            "connection_type": edge["connection_type"] if edge else None,
            "exit_port":  edge["exit_port"]  if edge else None,
            "entry_port": edge["entry_port"] if edge else None,
            "vlan_ids": edge["vlan_ids"] if edge else [],
            "conn_color": edge["conn_color"] if edge else None,
            "current_vlan": vlan,
            "current_vlan_color": vlan_color,
            "is_vlan_boundary": is_vlan_boundary,
        })
        if vlan is not None:
            prev_vlan = vlan

    return {"found": True, "hops": hops, "incomplete": False}
