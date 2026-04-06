from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, func, String
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models.device import Device
from models.nic import Nic
from models.network import Network
from models.user import User
from services.auth import require_viewer
from routers.devices import _nic_to_dict

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(
    q: str = Query("", min_length=0),
    network_id: int | None = Query(None),
    device_type_id: int | None = Query(None),
    device_type_category: str | None = Query(None),
    status: str | None = Query(None),
    location: str | None = Query(None),
    nic_type: str | None = Query(None),
    limit: int = Query(500, le=1000),
    exclude_in_service: bool = Query(False),
    exclude_stock: bool = Query(True),
    exclude_undeployed: bool = Query(True),
    exclude_decommissioned: bool = Query(True),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Full-text search across all meaningful device/NIC fields.
    Returns devices matching the query + filters.
    """
    q = q.strip()

    base = db.query(Device)

    if q:
        term = f"%{q}%"
        # Search on Device fields
        device_match = or_(
            Device.name.ilike(term),
            Device.use.ilike(term),
            Device.hostname.ilike(term),
            Device.brand.ilike(term),
            Device.model.ilike(term),
            Device.location.ilike(term),
            Device.os.ilike(term),
            Device.url.ilike(term),
            Device.notes.ilike(term),
        )
        # Search on NIC fields via subquery
        nic_match_ids = (
            db.query(Nic.device_id)
            .filter(
                or_(
                    Nic.mac.ilike(term),
                    Nic.ip_address.ilike(term),
                    Nic.dns_entry.ilike(term),
                    Nic.switch_port.ilike(term),
                    Nic.ssid.ilike(term),
                    Nic.label.ilike(term),
                )
            )
            .subquery()
        )
        # Search on Network VLAN name/id
        network_match_ids = (
            db.query(Nic.device_id)
            .join(Network, Nic.network_id == Network.id)
            .filter(
                or_(
                    Network.name.ilike(term),
                    Network.vlan_id == int(term) if term.isdigit() else False,
                )
            )
            .subquery()
        )
        base = base.filter(
            or_(
                device_match,
                Device.id.in_(nic_match_ids),
                Device.id.in_(network_match_ids),
            )
        )

    from models.device import DeviceStatus
    if exclude_in_service:
        base = base.filter(Device.status != DeviceStatus.in_service)
    if exclude_stock:
        base = base.filter(Device.status != DeviceStatus.stock)
    if exclude_undeployed:
        base = base.filter(Device.status != DeviceStatus.undeployed)
    if exclude_decommissioned:
        base = base.filter(Device.status != DeviceStatus.decommissioned)
    if status:
        base = base.filter(Device.status == status)
    if device_type_id:
        base = base.filter(Device.device_type_id == device_type_id)
    elif device_type_category:
        from models.device_type import DeviceType
        cat_ids = db.query(DeviceType.id).filter(DeviceType.category == device_type_category).subquery()
        base = base.filter(Device.device_type_id.in_(cat_ids))
    if location:
        base = base.filter(Device.location.ilike(f"%{location}%"))
    if network_id:
        nic_ids = db.query(Nic.device_id).filter(Nic.network_id == network_id).subquery()
        base = base.filter(Device.id.in_(nic_ids))
    if nic_type:
        nt_ids = db.query(Nic.device_id).filter(
            func.upper(Nic.nic_type) == nic_type.upper()
        ).subquery()
        base = base.filter(Device.id.in_(nt_ids))

    devices = base.options(joinedload(Device.device_type), joinedload(Device.nics)).order_by(Device.name).limit(limit).all()

    results = []
    for d in devices:
        results.append({
            "id": d.id,
            "name": d.name,
            "use": d.use,
            "status": d.status.value,
            "location": d.location,
            "location_id": d.location_id,
            "storage_location": d.storage_location,
            "brand": d.brand,
            "model": d.model,
            "hostname": d.hostname,
            "device_type": d.device_type.name if d.device_type else None,
            "device_type_category": d.device_type.category if d.device_type else None,
            "device_type_icon": d.device_type.icon if d.device_type else None,
            "hardware_type": d.hardware_type,
            "monitoring_enabled": d.monitoring_enabled,
            "monitor_nic_ids": d.monitor_nic_ids if d.monitor_nic_ids else [],
            "nics": [_nic_to_dict(n) for n in d.nics],
        })

    return {"query": q, "count": len(results), "results": results}
