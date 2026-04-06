import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import Optional

from database import get_db
from models.device import Device
from models.nic import Nic
from models.switch_port import SwitchPort, PortType
from models.user import User
from models.event import EventType
from services.auth import require_editor, require_viewer
from services.events import log_event
from services.port_utils import resolve_port

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/switch-ports", tags=["switch-ports"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SwitchPortIn(BaseModel):
    port_number: int
    port_name: Optional[str] = None
    port_type: PortType = PortType.eth
    poe_enabled: bool = False
    poe_budget_w: Optional[float] = None
    speed: Optional[str] = None
    notes: Optional[str] = None
    port_mode: str = "lan"
    is_management: bool = False
    mgmt_network_id: Optional[int] = None
    mgmt_ip_address: Optional[str] = None


class SwitchPortOut(SwitchPortIn):
    id: int
    device_id: int
    label: str
    connected_device_id: Optional[int] = None
    connected_device_name: Optional[str] = None
    connected_nic_label: Optional[str] = None
    connected_vlan_id: Optional[int] = None
    connected_network_color: Optional[str] = None
    is_downlink: bool = False
    mgmt_network_name: Optional[str] = None

    class Config:
        from_attributes = True


class BulkCreateIn(BaseModel):
    ports: list[SwitchPortIn]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Routes — list/create ports on a device
# ---------------------------------------------------------------------------

@router.get("/switches")
def list_switch_devices(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """Return all devices that have switch ports, with their port data."""
    from services.port_utils import resolve_port
    from models.device import DeviceStatus
    devices = (
        db.query(Device)
        .join(Device.switch_ports)
        .filter(Device.status == DeviceStatus.in_service)
        .distinct()
        .order_by(Device.name)
        .options(
            joinedload(Device.upstream_device),
            joinedload(Device.upstream_port),
            selectinload(Device.nics).joinedload(Nic.network),
            selectinload(Device.switch_ports).options(
                joinedload(SwitchPort.mgmt_network),
                selectinload(SwitchPort.nics).joinedload(Nic.device),
                selectinload(SwitchPort.nics).joinedload(Nic.network),
                selectinload(SwitchPort.downstream_devices).options(
                    joinedload(Device.uplink_port),
                    selectinload(Device.nics).joinedload(Nic.network),
                ),
            ),
        )
        .all()
    )
    result = []
    for d in devices:
        result.append({
            "id": d.id,
            "name": d.name,
            "location": d.location,
            "port_display_rows": d.port_display_rows,
            "port_numbering": d.port_numbering,
            "uplink_port_id": d.uplink_port_id,
            "upstream_device_id": d.upstream_device_id,
            "upstream_device_name": d.upstream_device.name if d.upstream_device else None,
            "switch_ports": [resolve_port(p) for p in sorted(d.switch_ports, key=lambda p: p.port_number)],
        })
    return result


@router.get("/device/{device_id}", response_model=list[SwitchPortOut])
def list_ports(
    device_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    return [resolve_port(p) for p in device.switch_ports]


@router.post("/device/{device_id}", status_code=201)
def create_port(
    device_id: int,
    body: SwitchPortIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    port = SwitchPort(device_id=device_id, **body.model_dump())
    db.add(port)
    db.flush()
    log_event(db, EventType.device_updated, f"Port {port.port_number} added to '{device.name}'",
              entity_type="device", entity_id=device_id, entity_name=device.name,
              username=current_user.username, user_id=current_user.id)
    db.commit()
    db.refresh(port)
    return resolve_port(port)


@router.post("/device/{device_id}/bulk", status_code=201)
def bulk_create_ports(
    device_id: int,
    body: BulkCreateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    """Replace all ports on a device with the supplied list."""
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")

    # Remove existing ports that are no longer in the list (by port_number)
    incoming_numbers = {p.port_number for p in body.ports}
    for existing in list(device.switch_ports):
        if existing.port_number not in incoming_numbers:
            db.delete(existing)

    existing_by_num = {p.port_number: p for p in device.switch_ports}

    for port_in in body.ports:
        data = port_in.model_dump()
        if port_in.port_number in existing_by_num:
            # Update existing
            for k, v in data.items():
                setattr(existing_by_num[port_in.port_number], k, v)
        else:
            db.add(SwitchPort(device_id=device_id, **data))

    db.commit()
    db.refresh(device)
    return [resolve_port(p) for p in device.switch_ports]


# ---------------------------------------------------------------------------
# Routes — single port operations
# ---------------------------------------------------------------------------

@router.put("/{port_id}")
def update_port(
    port_id: int,
    body: SwitchPortIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    port = db.get(SwitchPort, port_id)
    if not port:
        raise HTTPException(404, "Port not found")
    for k, v in body.model_dump().items():
        setattr(port, k, v)
    log_event(db, EventType.device_updated, f"Port {port.port_number} updated on device {port.device_id}",
              entity_type="device", entity_id=port.device_id,
              username=current_user.username, user_id=current_user.id)
    db.commit()
    db.refresh(port)
    return resolve_port(port)


@router.delete("/{port_id}", status_code=204)
def delete_port(
    port_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    port = db.get(SwitchPort, port_id)
    if not port:
        raise HTTPException(404, "Port not found")
    log_event(db, EventType.device_updated, f"Port {port.port_number} deleted from device {port.device_id}",
              entity_type="device", entity_id=port.device_id,
              username=current_user.username, user_id=current_user.id)
    # WanConfig has no cascade — delete explicitly before port
    from models.wan_config import WanConfig
    db.query(WanConfig).filter(WanConfig.switch_port_id == port_id).delete(synchronize_session=False)
    db.delete(port)
    db.commit()


# ---------------------------------------------------------------------------
# Assign a NIC to a port
# ---------------------------------------------------------------------------

@router.patch("/{port_id}/assign/{nic_id}")
def assign_nic(
    port_id: int,
    nic_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    from models.nic import Nic
    port = db.get(SwitchPort, port_id)
    if not port:
        raise HTTPException(404, "Port not found")
    nic = db.get(Nic, nic_id)
    if not nic:
        raise HTTPException(404, "NIC not found")
    nic.switch_port_id = port_id
    db.commit()
    db.refresh(port)
    return resolve_port(port)


@router.patch("/{port_id}/unassign")
def unassign_port(
    port_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    port = db.get(SwitchPort, port_id)
    if not port:
        raise HTTPException(404, "Port not found")
    for nic in port.nics:
        nic.switch_port_id = None
    db.commit()
    db.refresh(port)
    return resolve_port(port)
