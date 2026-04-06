import ipaddress
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.network import Network
from models.user import User
from services.auth import require_editor, require_viewer
from services.events import log_event
from models.event import EventType

router = APIRouter(prefix="/api/networks", tags=["networks"])


class NetworkIn(BaseModel):
    name: str
    vlan_id: Optional[int] = None
    cidr: Optional[str] = None

    @field_validator('cidr', mode='before')
    @classmethod
    def validate_cidr(cls, v):
        if v is None or v == '':
            return None
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError:
            raise ValueError(f'"{v}" is not a valid CIDR notation (e.g. 192.168.1.0/24)')
        return v
    gateway: Optional[str] = None
    dhcp_range_start: Optional[str] = None
    dhcp_range_end: Optional[str] = None
    dns_auto: bool = False
    dns_primary: Optional[str] = None
    dns_secondary: Optional[str] = None
    dns_extra: Optional[list[str]] = None
    purpose: Optional[str] = None
    ssids: Optional[list] = None  # list of {ssid, password, hidden} objects
    color: str = "#6366f1"
    icon: Optional[str] = None
    inter_vlan_rules: Optional[list[dict]] = None
    notes: Optional[str] = None


class NetworkOut(NetworkIn):
    id: int
    class Config:
        from_attributes = True


@router.get("", response_model=list[NetworkOut])
def list_networks(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return db.query(Network).order_by(Network.vlan_id).all()


@router.get("/{network_id}", response_model=NetworkOut)
def get_network(network_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    n = db.get(Network, network_id)
    if not n:
        raise HTTPException(404, "Network not found")
    return n


@router.post("", response_model=NetworkOut, status_code=201)
def create_network(
    body: NetworkIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    n = Network(**body.model_dump())
    db.add(n)
    db.flush()
    log_event(db, EventType.network_created, f"Network '{n.name}' created",
              entity_type="network", entity_id=n.id, entity_name=n.name,
              username=current_user.username, user_id=current_user.id,
              detail=body.model_dump())
    db.commit()
    db.refresh(n)
    return n


@router.put("/{network_id}", response_model=NetworkOut)
def update_network(
    network_id: int,
    body: NetworkIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    n = db.get(Network, network_id)
    if not n:
        raise HTTPException(404, "Network not found")
    old = {
        c.key: (v.isoformat() if hasattr(v := getattr(n, c.key), 'isoformat') else v)
        for c in n.__table__.columns
    }
    for k, v in body.model_dump().items():
        setattr(n, k, v)
    log_event(db, EventType.network_updated, f"Network '{n.name}' updated",
              entity_type="network", entity_id=n.id, entity_name=n.name,
              username=current_user.username, user_id=current_user.id,
              detail={"old_values": old, "new_values": body.model_dump()})
    db.commit()
    db.refresh(n)
    return n


class NetworkColorIn(BaseModel):
    color: str


@router.patch("/{network_id}/color", response_model=NetworkOut)
def update_network_color(
    network_id: int,
    body: NetworkColorIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    n = db.get(Network, network_id)
    if not n:
        raise HTTPException(404, "Network not found")
    old_color = n.color
    n.color = body.color
    log_event(db, EventType.network_updated, f"Network '{n.name}' colour updated",
              entity_type="network", entity_id=n.id, entity_name=n.name,
              username=current_user.username, user_id=current_user.id,
              detail={"old_values": {"color": old_color}, "new_values": {"color": body.color}})
    db.commit()
    db.refresh(n)
    return n


@router.delete("/{network_id}", status_code=204)
def delete_network(
    network_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    n = db.get(Network, network_id)
    if not n:
        raise HTTPException(404, "Network not found")
    # Null out NIC references before deleting — no cascade on Nic.network_id
    from models.nic import Nic
    db.query(Nic).filter(Nic.network_id == network_id).update(
        {"network_id": None}, synchronize_session=False
    )
    log_event(db, EventType.network_deleted, f"Network '{n.name}' deleted",
              entity_type="network", entity_id=n.id, entity_name=n.name,
              username=current_user.username, user_id=current_user.id)
    db.delete(n)
    db.commit()


@router.get("/{network_id}/subnet-map")
def subnet_map(
    network_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Returns a list of IP entries for the subnet map view.
    Each entry: {ip, status: 'occupied'|'reserved'|'dhcp'|'free', device_id?, device_name?, category?}
    """
    import ipaddress
    n = db.get(Network, network_id)
    if not n:
        raise HTTPException(404, "Network not found")
    if not n.cidr:
        return {"network_id": network_id, "entries": []}

    from models.nic import Nic
    from models.device import Device
    from models.switch_port import SwitchPort
    from sqlalchemy.orm import joinedload

    try:
        network = ipaddress.ip_network(n.cidr, strict=False)
    except ValueError:
        return {"network_id": network_id, "entries": []}

    # Build IP → device map
    nics = (
        db.query(Nic)
        .join(Device, Nic.device_id == Device.id)
        .filter(Nic.network_id == network_id)
        .options(
            joinedload(Nic.device).joinedload(Device.device_type),
            joinedload(Nic.switch_port_rel).joinedload(SwitchPort.device),
        )
        .all()
    )
    ip_map = {}
    for nic in nics:
        if nic.ip_address and nic.ip_address != "DHCP":
            try:
                ip_obj = ipaddress.ip_address(nic.ip_address)
                if ip_obj in network:
                    sp = nic.switch_port_rel
                    ip_map[str(ip_obj)] = {
                        "device_id": nic.device_id,
                        "device_name": nic.device.name,
                        "category": nic.device.device_type.name if nic.device.device_type else None,
                        "device_type_color": nic.device.device_type.color if nic.device.device_type else None,
                        "device_status": nic.device.status.value,
                        "nic_type": nic.nic_type.value if nic.nic_type else None,
                        "address_type": nic.address_type.value if nic.address_type else None,
                        "dns_entry": nic.dns_entry,
                        "mac": nic.mac,
                        "nic_label": nic.label,
                        "switch_device_name": sp.device.name if sp and sp.device else None,
                        "switch_port_label": sp.label if sp else None,
                        "is_active": nic.is_active,
                        "location": nic.device.location,
                        "brand": nic.device.brand,
                        "model": nic.device.model,
                    }
            except ValueError:
                pass

    # Determine DHCP range
    dhcp_start = dhcp_end = None
    try:
        if n.dhcp_range_start:
            dhcp_start = ipaddress.ip_address(n.dhcp_range_start)
        if n.dhcp_range_end:
            dhcp_end = ipaddress.ip_address(n.dhcp_range_end)
    except ValueError:
        pass

    # Determine gateway
    gateway_ip = None
    try:
        if n.gateway:
            gateway_ip = ipaddress.ip_address(n.gateway)
    except ValueError:
        pass

    HOST_LIMIT = 1024
    all_hosts = list(network.hosts())
    truncated = len(all_hosts) > HOST_LIMIT
    hosts = all_hosts[:HOST_LIMIT]

    entries = []
    for ip_obj in hosts:
        ip_str = str(ip_obj)
        if ip_str in ip_map:
            entry = {"ip": ip_str, "status": "occupied", **ip_map[ip_str]}
        elif gateway_ip and ip_obj == gateway_ip:
            entry = {"ip": ip_str, "status": "gateway"}
        elif dhcp_start and dhcp_end and dhcp_start <= ip_obj <= dhcp_end:
            entry = {"ip": ip_str, "status": "dhcp"}
        else:
            entry = {"ip": ip_str, "status": "free"}
        entries.append(entry)

    return {"network_id": network_id, "cidr": n.cidr, "entries": entries, "truncated": truncated, "total_hosts": len(all_hosts)}
