"""
WAN Configuration router.
One WAN config per switch port designated as WAN mode.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from database import get_db
from models.wan_config import WanConfig
from models.switch_port import SwitchPort
from models.event import EventType
from services.auth import require_editor, require_viewer
from services.events import log_event

router = APIRouter(prefix="/api/wan-configs", tags=["wan-configs"])


class WanConfigIn(BaseModel):
    isp_name: Optional[str] = None
    connection_type: Optional[str] = None  # dhcp, static, pppoe, 4g-lte, ds-lite
    vlan_id: Optional[int] = None
    ip_address: Optional[str] = None
    subnet_mask: Optional[str] = None
    gateway: Optional[str] = None
    pppoe_username: Optional[str] = None
    pppoe_password: Optional[str] = None
    mtu: Optional[int] = None
    dns_primary: Optional[str] = None
    dns_secondary: Optional[str] = None
    notes: Optional[str] = None
    speed_down: Optional[str] = None
    speed_up: Optional[str] = None
    wan_ping_target: Optional[str] = None
    wan_monitoring_enabled: Optional[bool] = None


class WanConfigOut(WanConfigIn):
    id: int
    device_id: int
    switch_port_id: int
    port_number: Optional[int] = None
    port_name: Optional[str] = None

    class Config:
        from_attributes = True


def _to_out(wc: WanConfig) -> dict:
    return {
        "id": wc.id,
        "device_id": wc.device_id,
        "switch_port_id": wc.switch_port_id,
        "port_number": wc.switch_port.port_number if wc.switch_port else None,
        "port_name": wc.switch_port.port_name if wc.switch_port else None,
        "isp_name": wc.isp_name,
        "connection_type": wc.connection_type,
        "vlan_id": wc.vlan_id,
        "ip_address": wc.ip_address,
        "subnet_mask": wc.subnet_mask,
        "gateway": wc.gateway,
        "pppoe_username": wc.pppoe_username,
        "pppoe_password": wc.pppoe_password,
        "mtu": wc.mtu,
        "dns_primary": wc.dns_primary,
        "dns_secondary": wc.dns_secondary,
        "notes": wc.notes,
        "speed_down": wc.speed_down,
        "speed_up": wc.speed_up,
        "wan_ping_target": wc.wan_ping_target or "1.1.1.1",
        "wan_monitoring_enabled": wc.wan_monitoring_enabled if wc.wan_monitoring_enabled is not None else True,
    }


@router.get("")
def list_all_wan_configs(
    db: Session = Depends(get_db),
    _=Depends(require_viewer),
):
    """Return all WAN configs across all devices."""
    configs = db.query(WanConfig).options(joinedload(WanConfig.switch_port)).all()
    return [_to_out(wc) for wc in configs]


@router.get("/device/{device_id}")
def list_wan_configs(
    device_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_viewer),
):
    """Return all WAN configs for a device."""
    configs = db.query(WanConfig).options(joinedload(WanConfig.switch_port)).filter(WanConfig.device_id == device_id).all()
    return [_to_out(wc) for wc in configs]


@router.put("/port/{switch_port_id}", status_code=200)
def upsert_wan_config(
    switch_port_id: int,
    body: WanConfigIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_editor),
):
    """Create or update the WAN config for a specific port."""
    port = db.get(SwitchPort, switch_port_id)
    if not port:
        raise HTTPException(404, "Port not found")
    if port.port_mode != "wan":
        raise HTTPException(400, "WAN configuration can only be set on ports with port_mode='wan'")

    wc = db.query(WanConfig).filter(WanConfig.switch_port_id == switch_port_id).first()
    if not wc:
        wc = WanConfig(device_id=port.device_id, switch_port_id=switch_port_id)
        db.add(wc)

    is_new = wc.id is None
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(wc, k, v)

    action = "created" if is_new else "updated"
    log_event(db, EventType.device_updated, f"WAN config {action} for port {switch_port_id}",
              entity_type="device", entity_id=port.device_id,
              username=current_user.username, user_id=current_user.id)
    db.commit()
    db.refresh(wc)
    return _to_out(wc)


@router.delete("/port/{switch_port_id}", status_code=204)
def delete_wan_config(
    switch_port_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_editor),
):
    """Delete the WAN config for a port (e.g. when port mode switches back to LAN)."""
    wc = db.query(WanConfig).filter(WanConfig.switch_port_id == switch_port_id).first()
    if wc:
        log_event(db, EventType.device_updated, f"WAN config deleted for port {switch_port_id}",
                  entity_type="device", entity_id=wc.device_id,
                  username=current_user.username, user_id=current_user.id)
        db.delete(wc)
        db.commit()
