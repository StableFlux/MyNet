from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from services.auth import require_viewer
from services.path_tracer import trace_path

router = APIRouter(prefix="/api/topology", tags=["topology"])


# ---------------------------------------------------------------------------
# Auto-derived device graph (from actual device connections)
# ---------------------------------------------------------------------------

@router.get("/device-graph")
def device_graph(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    """
    Builds a topology graph purely from device connection data:
      - Device.upstream_device_id  (switch/device uplinks)
      - Nic.switch_port_id         (end-device → switch connections)
      - Device.hypervisor_device_id (VMs → hypervisor)
    Only includes in_service devices.
    """
    from models.device import Device, DeviceStatus

    devices = db.query(Device).filter(Device.status == DeviceStatus.in_service).all()

    nodes = []
    edges = []
    edge_set: set[str] = set()

    for d in devices:
        primary_nic = next(
            (n for n in d.nics if n.ip_address and n.ip_address not in ("DHCP", "")), None
        )
        wifi_nics = [n for n in d.nics if n.nic_type.value == "WIFI"]
        eth_nics  = [n for n in d.nics if n.nic_type.value == "ETH" and n.switch_port_id]
        has_eth_conn = bool(eth_nics) or bool(d.upstream_device_id) or bool(d.hypervisor_device_id)

        nodes.append({
            "id": str(d.id),
            "type": "deviceNode",
            "data": {
                "device_id": d.id,
                "label": d.name,
                "device_type": d.device_type.name if d.device_type else None,
                "device_type_category": d.device_type.category if d.device_type else None,
                "device_type_icon": d.device_type.icon if d.device_type else None,
                "hardware_type": d.hardware_type,
                "location": d.location,
                "ip": primary_nic.ip_address if primary_nic else None,
                "network_color": primary_nic.network.color if primary_nic and primary_nic.network else "#64748b",
                "monitoring_enabled": d.monitoring_enabled,
                "has_switch_ports": len(d.switch_ports) > 0,
                "is_vm": d.hypervisor_device_id is not None,
                "has_wifi": bool(wifi_nics),
                "wifi_ssids": list({n.ssid for n in wifi_nics if n.ssid}),
                "is_wifi_only": bool(wifi_nics) and not has_eth_conn,
            },
            "position": {"x": 0, "y": 0},
        })

        if d.upstream_device_id:
            eid = f"uplink-{d.upstream_device_id}-{d.id}"
            if eid not in edge_set:
                edge_set.add(eid)
                edges.append({
                    "id": eid,
                    "source": str(d.upstream_device_id),
                    "target": str(d.id),
                    "type": "uplinkEdge",
                    "data": {
                        "connection_type": "uplink",
                        "port_label": d.upstream_port.label if d.upstream_port else None,
                    },
                })

        if d.hypervisor_device_id:
            eid = f"vm-{d.hypervisor_device_id}-{d.id}"
            if eid not in edge_set:
                edge_set.add(eid)
                edges.append({
                    "id": eid,
                    "source": str(d.hypervisor_device_id),
                    "target": str(d.id),
                    "type": "vmEdge",
                    "data": {"connection_type": "vm"},
                })

    device_uplinks = {d.id: d.upstream_device_id for d in devices}

    for d in devices:
        connected_switches: set[int] = set()
        if device_uplinks.get(d.id):
            connected_switches.add(device_uplinks[d.id])

        for nic in d.nics:
            if nic.switch_port_id and nic.switch_port_rel:
                switch_id = nic.switch_port_rel.device_id
                if switch_id == d.id or switch_id in connected_switches:
                    continue
                connected_switches.add(switch_id)
                eid = f"switch-{switch_id}-{d.id}"
                if eid not in edge_set:
                    edge_set.add(eid)
                    edges.append({
                        "id": eid,
                        "source": str(switch_id),
                        "target": str(d.id),
                        "type": "switchEdge",
                        "data": {
                            "connection_type": "access",
                            "port_label": nic.switch_port_rel.label,
                            "network_color": nic.network.color if nic.network else None,
                        },
                    })

    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# Path tracer
# ---------------------------------------------------------------------------

@router.get("/path")
def path_trace(
    source_id: int,
    target_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    return trace_path(db, source_id, target_id)
