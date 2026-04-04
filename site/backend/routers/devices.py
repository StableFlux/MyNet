import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.audit import AuditAction
from models.device import Device, DeviceStatus
from models.device_type import DeviceType
from models.nic import Nic
from models.switch_port import SwitchPort
from models.user import User
from services.audit import log as audit_log
from services.auth import require_editor, require_viewer
from services.encryption import encrypt, decrypt, is_locked
from services.monitoring_scheduler import unschedule_device, schedule_device_nics, resolve_monitor_ips
from services.port_utils import resolve_port

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/devices", tags=["devices"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class NicIn(BaseModel):
    label: Optional[str] = None
    nic_type: str
    mac: Optional[str] = None
    ip_address: Optional[str] = None
    dns_entry: Optional[str] = None
    network_id: Optional[int] = None
    address_type: Optional[str] = "reserved"
    gateway: Optional[str] = None
    subnet_mask: Optional[str] = None
    dns_server_1: Optional[str] = None
    dns_server_2: Optional[str] = None
    switch_port: Optional[str] = None
    switch_port_id: Optional[int] = None
    poe_enabled: Optional[bool] = False
    ssid: Optional[str] = None
    band: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True


class NicOut(NicIn):
    id: int
    device_id: int
    class Config:
        from_attributes = True


class DeviceIn(BaseModel):
    name: str
    use: Optional[str] = None
    device_type_id: Optional[int] = None
    hardware_type: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    cpu: Optional[str] = None
    ram: Optional[str] = None
    gpu: Optional[str] = None
    os: Optional[str] = None
    os_version: Optional[str] = None
    hostname: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None          # plaintext in, encrypted in DB
    ssh_enabled: bool = False
    ssh_port: int = 22
    ssh_key: Optional[str] = None
    status: DeviceStatus = DeviceStatus.in_service
    location: Optional[str] = None
    storage_location: Optional[str] = None
    storage_location_id: Optional[int] = None
    purchase_date: Optional[str] = None
    url: Optional[str] = None
    service_name: Optional[str] = None
    service_port: Optional[int] = None
    hypervisor_device_id: Optional[int] = None
    firmware_type: Optional[str] = None
    bed_size: Optional[str] = None
    mcu_board: Optional[str] = None
    ha_entity_id: Optional[str] = None
    pihole_enabled: bool = False
    pihole_nic_id: Optional[int] = None
    pihole_password: Optional[str] = None    # plaintext in, encrypted in DB
    drives: list = []
    services: list = []
    wol_enabled: bool = False
    monitoring_enabled: bool = False
    monitor_interval_secs: int = 60
    monitor_target_nic_id: Optional[int] = None
    monitor_nic_ids: Optional[list[int]] = None
    notes: Optional[str] = None
    nics: list[NicIn] = []
    uplink_port_id: Optional[int] = None
    upstream_device_id: Optional[int] = None
    upstream_port_id: Optional[int] = None
    port_display_rows: int = 2
    port_numbering: str = 'alternating'


class DeviceOut(BaseModel):
    id: int
    name: str
    use: Optional[str]
    device_type_id: Optional[int]
    hardware_type: Optional[str] = None
    brand: Optional[str]
    model: Optional[str]
    cpu: Optional[str]
    ram: Optional[str]
    gpu: Optional[str]
    os: Optional[str]
    os_version: Optional[str]
    hostname: Optional[str]
    username: Optional[str]
    has_password: bool = False  # overridden in _device_to_out; not a DB column
    ssh_enabled: bool
    ssh_port: Optional[int]
    status: str
    location: Optional[str]
    location_id: Optional[int] = None
    storage_location: Optional[str]
    storage_location_id: Optional[int] = None
    purchase_date: Optional[str]
    url: Optional[str]
    service_name: Optional[str]
    service_port: Optional[int]
    hypervisor_device_id: Optional[int]
    firmware_type: Optional[str]
    bed_size: Optional[str]
    mcu_board: Optional[str]
    ha_entity_id: Optional[str]
    pihole_enabled: bool = False
    pihole_nic_id: Optional[int] = None
    pihole_password_set: bool = False   # never expose plaintext
    drives: list = []
    services: list = []
    wol_enabled: bool
    monitoring_enabled: bool
    monitor_interval_secs: int
    monitor_target_nic_id: Optional[int]
    monitor_nic_ids: Optional[list[int]] = None
    notes: Optional[str]
    nics: list[NicOut]
    uplink_port_id: Optional[int] = None
    upstream_device_id: Optional[int] = None
    upstream_port_id: Optional[int] = None
    port_display_rows: int = 2
    port_numbering: str = 'alternating'

    @field_validator('drives', 'services', mode='before')
    @classmethod
    def coerce_none_to_list(cls, v):
        return v if v is not None else []

    class Config:
        from_attributes = True


class DeviceSummary(BaseModel):
    id: int
    name: str
    use: Optional[str]
    status: str
    location: Optional[str]
    location_id: Optional[int] = None
    storage_location: Optional[str] = None
    purchase_date: Optional[str] = None
    brand: Optional[str]
    model: Optional[str]
    cpu: Optional[str] = None
    ram: Optional[str] = None
    os: Optional[str] = None
    hostname: Optional[str] = None
    device_type_id: Optional[int]
    device_type_name: Optional[str] = None
    device_type_category: Optional[str] = None
    hardware_type: Optional[str] = None
    monitoring_enabled: bool
    monitor_nic_ids: Optional[list[int]] = None
    nics: list[NicOut]
    services: list = []

    @field_validator('services', mode='before')
    @classmethod
    def coerce_none_to_list(cls, v):
        return v if v is not None else []

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _nic_to_dict(nic) -> dict:
    net = nic.network
    sp = nic.switch_port_rel
    return {
        "id": nic.id,
        "device_id": nic.device_id,
        "label": nic.label,
        "nic_type": nic.nic_type.value if nic.nic_type else None,
        "mac": nic.mac,
        "ip_address": nic.ip_address,
        "dns_entry": nic.dns_entry,
        "network_id": nic.network_id,
        "network_name": net.name if net else None,
        "network_color": net.color if net else None,
        "vlan_id": net.vlan_id if net else None,
        "address_type": nic.address_type.value if nic.address_type else None,
        "gateway": nic.gateway,
        "subnet_mask": nic.subnet_mask,
        "dns_server_1": nic.dns_server_1,
        "dns_server_2": nic.dns_server_2,
        "network_dns_primary": net.dns_primary if net else None,
        "network_dns_secondary": net.dns_secondary if net else None,
        "switch_port": nic.switch_port,
        "switch_port_id": sp.id if sp else None,
        "switch_port_label": sp.label if sp else None,
        "switch_device_id": sp.device_id if sp else None,
        "switch_device_name": sp.device.name if sp else None,
        "poe_enabled": nic.poe_enabled,
        "ssid": nic.ssid,
        "band": nic.band.value if nic.band else None,
        "notes": nic.notes,
        "is_active": nic.is_active,
    }


def _device_to_out(device: Device, db: Session = None) -> dict:
    d = DeviceOut.model_validate(device).model_dump()
    d["has_password"] = bool(device.password)
    d["pihole_password_set"] = bool(device.pihole_password)
    d["device_type_name"] = device.device_type.name if device.device_type else None
    d["device_type_category"] = device.device_type.category if device.device_type else None
    d["device_type_icon"] = device.device_type.icon if device.device_type else None
    d["hypervisor_name"] = device.hypervisor.name if device.hypervisor else None
    if device.location_rel:
        parts, cur = [], device.location_rel
        while cur:
            parts.insert(0, cur.name)
            cur = cur.parent
        d["location_path"] = " › ".join(parts)
        d["location_type"] = device.location_rel.type
    else:
        d["location_path"] = device.location
        d["location_type"] = None
    stor_loc = device.storage_location_rel
    if stor_loc:
        parts, cur = [], stor_loc
        while cur:
            parts.insert(0, cur.name)
            cur = cur.parent
        d["storage_location_path"] = " › ".join(parts)
        d["storage_location_type"] = stor_loc.type
    elif device.storage_location:
        d["storage_location_path"] = device.storage_location
        d["storage_location_type"] = None
    else:
        d["storage_location_path"] = device.storage_location
        d["storage_location_type"] = None
    d["nics"] = sorted([_nic_to_dict(n) for n in device.nics], key=lambda n: 0 if n["nic_type"] == "ETH" else 1)
    # For infra devices, annotate management NIC with upstream switch info when not set via FK
    if device.switch_ports and d["nics"] and device.upstream_device:
        mgmt = d["nics"][0]
        if not mgmt.get("switch_device_name"):
            mgmt["switch_device_name"] = device.upstream_device.name
        if not mgmt.get("switch_port_label") and not mgmt.get("switch_port") and device.upstream_port:
            mgmt["switch_port_label"] = device.upstream_port.label
    d["switch_ports"] = [resolve_port(p) for p in device.switch_ports]
    d["uplink_port_label"]     = device.uplink_port.label  if device.uplink_port     else None
    d["upstream_device_name"]  = device.upstream_device.name if device.upstream_device else None
    d["upstream_port_label"]   = device.upstream_port.label if device.upstream_port   else None
    d["vm_guests"] = [
        {
            "id": vm.id,
            "name": vm.name,
            "status": vm.status.value if hasattr(vm.status, 'value') else vm.status,
            "device_type_name": vm.device_type.name if vm.device_type else None,
            "primary_ip": next((n.ip_address for n in vm.nics if n.ip_address), None),
        }
        for vm in device.vm_guests
    ]
    pc = device.pihole_cache
    d["pihole_cache"] = {
        "queries_today": pc.queries_today,
        "blocked_today": pc.blocked_today,
        "last_polled": pc.last_polled.isoformat() if pc.last_polled else None,
    } if pc else None
    return d


def _cleanup_infra_data(device: Device, db: Session):
    """Remove all infra-specific data when a device is no longer an infra type."""
    device.uplink_port_id = None
    device.upstream_device_id = None
    device.upstream_port_id = None

    port_ids = [p.id for p in device.switch_ports]
    if not port_ids:
        return

    # Null switch_port references on NICs from other devices connected to these ports
    db.query(Nic).filter(Nic.switch_port_id.in_(port_ids)).update(
        {"switch_port_id": None, "switch_port": None}, synchronize_session=False
    )
    # Null uplink/upstream references on other devices pointing at these ports or this device
    db.query(Device).filter(Device.uplink_port_id.in_(port_ids)).update(
        {"uplink_port_id": None}, synchronize_session=False
    )
    db.query(Device).filter(Device.upstream_port_id.in_(port_ids)).update(
        {"upstream_port_id": None}, synchronize_session=False
    )
    db.query(Device).filter(Device.upstream_device_id == device.id).update(
        {"upstream_device_id": None, "upstream_port_id": None}, synchronize_session=False
    )
    # Delete this device's switch ports
    db.query(SwitchPort).filter(SwitchPort.device_id == device.id).delete(
        synchronize_session=False
    )


def _apply_device(device: Device, body: DeviceIn, db: Session):
    for field in [
        "name", "use", "device_type_id", "hardware_type", "brand", "model", "cpu", "ram", "gpu",
        "os", "os_version", "hostname", "username", "ssh_enabled", "ssh_port", "ssh_key",
        "status", "location", "storage_location", "purchase_date", "url",
        "service_name", "service_port", "hypervisor_device_id",
        "firmware_type", "bed_size", "mcu_board", "ha_entity_id", "pihole_enabled", "pihole_nic_id", "drives", "services",
        # Note: pihole_password handled separately below (needs encryption)
        "wol_enabled", "monitoring_enabled", "monitor_interval_secs",
        "monitor_target_nic_id", "monitor_nic_ids", "notes",
        "uplink_port_id", "upstream_device_id", "upstream_port_id",
        "port_display_rows", "port_numbering",
    ]:
        setattr(device, field, getattr(body, field))
    if body.password is not None:
        try:
            device.password = encrypt(body.password)
        except ValueError as e:
            raise HTTPException(status_code=423, detail=str(e))
    if body.pihole_password is not None:
        try:
            device.pihole_password = encrypt(body.pihole_password) if body.pihole_password else None
        except ValueError as e:
            raise HTTPException(status_code=423, detail=str(e))
    # Resolve location string to FK — keeps location_id in sync with location name
    if body.location:
        from models.location import Location
        loc = db.query(Location).filter(Location.name == body.location).first()
        device.location_id = loc.id if loc else None
    else:
        device.location_id = None


def _sync_nics(device: Device, nic_data: list[NicIn], db: Session):
    # Capture old NIC id → (type, ip) before deletion for monitor_nic_ids remapping
    old_nic_signatures = {n.id: (n.nic_type, n.ip_address) for n in device.nics}

    # Remove all existing NICs and replace (simple approach for PUT)
    for nic in list(device.nics):
        db.delete(nic)
    db.flush()

    new_nics = []
    for n in nic_data:
        data = n.model_dump()
        # Coerce empty strings to None for enum-backed fields to avoid SAEnum validation errors
        for field in ('band', 'ssid', 'switch_port', 'mac', 'ip_address', 'dns_entry', 'notes', 'gateway', 'subnet_mask', 'dns_server_1', 'dns_server_2'):
            if data.get(field) == '':
                data[field] = None
        nic = Nic(device_id=device.id, **data)
        db.add(nic)
        new_nics.append((nic, n))
    db.flush()

    # Remap monitor_nic_ids from old NIC ids to new NIC ids by matching type+ip signature
    if device.monitor_nic_ids:
        monitored_signatures = {
            sig for old_id, sig in old_nic_signatures.items()
            if old_id in device.monitor_nic_ids
        }
        device.monitor_nic_ids = [
            nic.id for nic, n in new_nics
            if (n.nic_type, n.ip_address or None) in monitored_signatures
               or (n.nic_type, None) in monitored_signatures
        ] or None

    # Remap monitor_target_nic_id to the new NIC id by matching type+ip signature
    if device.monitor_target_nic_id and device.monitor_target_nic_id in old_nic_signatures:
        target_sig = old_nic_signatures[device.monitor_target_nic_id]
        device.monitor_target_nic_id = next(
            (nic.id for nic, n in new_nics
             if (n.nic_type, n.ip_address or None) == target_sig
             or (n.nic_type, None) == target_sig),
            None,
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
def list_devices(
    status: Optional[str] = Query(None),
    device_type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    from sqlalchemy.orm import joinedload
    q = db.query(Device).options(
        joinedload(Device.device_type),
        joinedload(Device.nics),
    )
    if status:
        q = q.filter(Device.status == status)
    if device_type_id:
        q = q.filter(Device.device_type_id == device_type_id)
    devices = q.order_by(Device.name).all()
    results = []
    for d in devices:
        row = DeviceSummary.model_validate(d).model_dump()
        row["device_type_name"] = d.device_type.name if d.device_type else None
        row["device_type_category"] = d.device_type.category if d.device_type else None
        results.append(row)
    return results


@router.get("/{device_id}")
def get_device(
    device_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    return _device_to_out(device, db)


@router.get("/{device_id}/password")
def get_device_password(
    device_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    """Returns decrypted password — editor+ only."""
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    if is_locked():
        return {"password": None, "locked": True}
    return {"password": decrypt(device.password), "locked": False}


@router.post("", status_code=201)
def create_device(
    body: DeviceIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    device = Device()
    _apply_device(device, body, db)
    if device.status in (DeviceStatus.stock, DeviceStatus.undeployed, DeviceStatus.decommissioned):
        device.monitoring_enabled = False
    db.add(device)
    db.flush()
    _sync_nics(device, body.nics, db)
    audit_log(db, "device", device.id, device.name, AuditAction.create,
              current_user.id, current_user.username, new_values={"name": body.name})
    db.commit()
    db.refresh(device)

    if device.monitoring_enabled:
        _try_schedule(device)

    return _device_to_out(device, db)


@router.put("/{device_id}")
def update_device(
    device_id: int,
    body: DeviceIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    old = {"name": device.name, "status": str(device.status), "location": device.location}
    _apply_device(device, body, db)
    # If switching to a non-infra type, clean up all switch/port data
    new_type = db.get(DeviceType, device.device_type_id) if device.device_type_id else None
    if not new_type or not new_type.is_infrastructure:
        _cleanup_infra_data(device, db)
    if device.status in (DeviceStatus.stock, DeviceStatus.undeployed, DeviceStatus.decommissioned):
        device.monitoring_enabled = False
    _sync_nics(device, body.nics, db)
    new = {"name": device.name, "status": str(device.status), "location": device.location}
    audit_log(db, "device", device.id, device.name, AuditAction.update,
              current_user.id, current_user.username, old_values=old, new_values=new)
    db.commit()
    db.refresh(device)

    if device.monitoring_enabled:
        _try_schedule(device)
    else:
        unschedule_device(device.id)

    return _device_to_out(device, db)


@router.delete("/{device_id}", status_code=204)
def delete_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    unschedule_device(device_id)

    # Null out self-referencing FKs on this device before cascade-deleting NICs/ports,
    # otherwise SQLite's FK checks block the NIC/port deletes.
    device.monitor_target_nic_id = None
    device.uplink_port_id = None
    device.upstream_device_id = None
    device.upstream_port_id = None
    db.flush()

    # Null out references from other devices pointing at this device or its ports
    port_ids = [p.id for p in device.switch_ports]
    if port_ids:
        db.query(Device).filter(Device.uplink_port_id.in_(port_ids)).update(
            {"uplink_port_id": None}, synchronize_session=False
        )
        db.query(Device).filter(Device.upstream_port_id.in_(port_ids)).update(
            {"upstream_port_id": None}, synchronize_session=False
        )
        db.query(Nic).filter(Nic.switch_port_id.in_(port_ids)).update(
            {"switch_port_id": None}, synchronize_session=False
        )
    db.query(Device).filter(Device.upstream_device_id == device_id).update(
        {"upstream_device_id": None, "upstream_port_id": None}, synchronize_session=False
    )
    db.query(Device).filter(Device.hypervisor_device_id == device_id).update(
        {"hypervisor_device_id": None}, synchronize_session=False
    )
    # Delete alerts referencing this device (no cascade relationship defined on Device)
    from models.alert import Alert
    db.query(Alert).filter(Alert.device_id == device_id).delete(synchronize_session=False)
    db.flush()

    audit_log(db, "device", device.id, device.name, AuditAction.delete,
              current_user.id, current_user.username)
    db.delete(device)
    db.commit()


# ---------------------------------------------------------------------------
# Deploy wizard (F13)
# ---------------------------------------------------------------------------

class DeployRequest(BaseModel):
    name: str
    device_type_id: Optional[int] = None
    hostname: Optional[str] = None
    network_id: Optional[int] = None
    ip_address: Optional[str] = None
    location: Optional[str] = None


@router.post("/{device_id}/deploy")
def deploy_device(
    device_id: int,
    req: DeployRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    old_status = device.status.value
    device.name = req.name
    device.device_type_id = req.device_type_id
    device.hostname = req.hostname
    device.location = req.location
    device.status = DeviceStatus.in_service

    if req.network_id and req.ip_address:
        # Update or create the primary NIC IP/network
        primary_nic = next((n for n in device.nics if n.ip_address), None)
        if primary_nic:
            primary_nic.network_id = req.network_id
            primary_nic.ip_address = req.ip_address

    audit_log(
        db, "device", device.id, device.name, AuditAction.deploy,
        current_user.id, current_user.username,
        old_values={"status": old_status},
        new_values={"status": "in_service", "name": req.name},
    )
    db.commit()
    db.refresh(device)
    return _device_to_out(device, db)


# ---------------------------------------------------------------------------
# Monitoring toggle
# ---------------------------------------------------------------------------

@router.patch("/{device_id}/monitoring")
def set_monitoring(
    device_id: int,
    enabled: bool,
    interval_secs: int = 60,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    if device.status in (DeviceStatus.stock, DeviceStatus.undeployed, DeviceStatus.decommissioned):
        raise HTTPException(400, "Cannot enable monitoring for a device that is not in service")
    device.monitoring_enabled = enabled
    device.monitor_interval_secs = interval_secs
    db.commit()
    if enabled:
        _try_schedule(device)
    else:
        unschedule_device(device_id)
    return {"monitoring_enabled": enabled}


class MonitorNicsIn(BaseModel):
    nic_ids: list[int]


@router.patch("/{device_id}/monitor-nics")
def set_monitor_nics(
    device_id: int,
    body: MonitorNicsIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    device.monitor_nic_ids = body.nic_ids if body.nic_ids else None
    db.commit()
    db.refresh(device)
    if device.monitoring_enabled:
        _try_schedule(device)
    return {"monitor_nic_ids": device.monitor_nic_ids}


def _try_schedule(device: Device):
    ips = resolve_monitor_ips(device)
    if ips:
        schedule_device_nics(device.id, ips, device.monitor_interval_secs or 60)


# ---------------------------------------------------------------------------
# Wake on LAN (F10)
# ---------------------------------------------------------------------------

def _send_magic_packet(mac: str) -> None:
    """Send a WoL magic packet to the broadcast address."""
    import wakeonlan
    wakeonlan.send_magic_packet(mac)


@router.post("/{device_id}/wol")
def wake_on_lan(
    device_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    if not device.wol_enabled:
        raise HTTPException(400, "Wake on LAN is not enabled for this device")

    # Find the best ETH MAC to use
    mac = None
    for nic in device.nics:
        if nic.nic_type and nic.nic_type.value == "ETH" and nic.mac:
            mac = nic.mac
            break
    if not mac:
        for nic in device.nics:
            if nic.mac:
                mac = nic.mac
                break

    if not mac:
        raise HTTPException(400, "No MAC address found for this device")

    try:
        _send_magic_packet(mac)
        log.info(f"WoL magic packet sent to {device.name} ({mac})")
        return {"sent": True, "mac": mac, "device": device.name}
    except Exception as e:
        log.error(f"WoL failed for {device.name}: {e}")
        raise HTTPException(500, f"Failed to send magic packet: {e}")
