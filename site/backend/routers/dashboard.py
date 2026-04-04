"""
Dashboard summary endpoint (F8).
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models.device import Device, DeviceStatus
from models.device_type import DeviceType
from models.network import Network
from models.nic import Nic
from models.alert import Alert, AlertSeverity
from models.audit import AuditLog
from models.monitoring import MonitoringResult, PingStatus
from models.user import User
from services.auth import require_viewer

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    # Device counts by status
    in_service = db.query(Device).filter(Device.status == DeviceStatus.in_service).count()
    stock_count = db.query(Device).filter(Device.status == DeviceStatus.stock).count()
    undeployed_count = db.query(Device).filter(Device.status == DeviceStatus.undeployed).count()
    decommissioned_count = db.query(Device).filter(Device.status == DeviceStatus.decommissioned).count()
    total_devices = in_service + stock_count + undeployed_count + decommissioned_count

    # Alert counts by severity
    unread_alerts = db.query(Alert).filter(Alert.acknowledged_at.is_(None)).count()
    critical_alerts = db.query(Alert).filter(Alert.acknowledged_at.is_(None), Alert.severity == AlertSeverity.critical).count()
    warning_alerts = db.query(Alert).filter(Alert.acknowledged_at.is_(None), Alert.severity == AlertSeverity.warning).count()
    info_alerts = db.query(Alert).filter(Alert.acknowledged_at.is_(None), Alert.severity == AlertSeverity.info).count()

    # Per-network device counts
    network_counts = (
        db.query(Network, func.count(Nic.device_id.distinct()).label("device_count"))
        .outerjoin(Nic, Nic.network_id == Network.id)
        .group_by(Network.id)
        .order_by(Network.vlan_id)
        .all()
    )
    networks = [
        {
            "id": n.id,
            "name": n.name,
            "vlan_id": n.vlan_id,
            "color": n.color,
            "cidr": n.cidr,
            "device_count": count,
        }
        for n, count in network_counts
    ]

    # Device count by type category (in-service only)
    category_counts = (
        db.query(DeviceType.category, func.count(Device.id).label("count"))
        .join(Device, Device.device_type_id == DeviceType.id)
        .filter(Device.status == DeviceStatus.in_service)
        .group_by(DeviceType.category)
        .order_by(func.count(Device.id).desc())
        .all()
    )
    by_category = [
        {"category": cat or "Uncategorised", "count": count}
        for cat, count in category_counts
    ]

    # Device count by brand (in-service, top 8)
    brand_counts = (
        db.query(Device.brand, func.count(Device.id).label("count"))
        .filter(Device.status == DeviceStatus.in_service, Device.brand.isnot(None), Device.brand != "")
        .group_by(Device.brand)
        .order_by(func.count(Device.id).desc())
        .limit(8)
        .all()
    )
    by_brand = [{"brand": b, "count": c} for b, c in brand_counts]

    # Monitoring: offline devices + totals
    monitored = db.query(Device).filter(Device.monitoring_enabled.is_(True)).all()
    monitoring_total = len(monitored)

    if monitored:
        monitored_ids = [d.id for d in monitored]
        latest_ts_sub = (
            db.query(
                MonitoringResult.device_id,
                func.max(MonitoringResult.timestamp).label("max_ts"),
            )
            .filter(MonitoringResult.device_id.in_(monitored_ids))
            .group_by(MonitoringResult.device_id)
            .subquery()
        )
        latest_results = (
            db.query(MonitoringResult)
            .join(
                latest_ts_sub,
                (MonitoringResult.device_id == latest_ts_sub.c.device_id)
                & (MonitoringResult.timestamp == latest_ts_sub.c.max_ts),
            )
            .all()
        )
        last_by_device = {r.device_id: r for r in latest_results}
    else:
        last_by_device = {}

    offline_devices = []
    for device in monitored:
        last = last_by_device.get(device.id)
        if last and last.status != PingStatus.up:
            primary_ip = next(
                (n.ip_address for n in device.nics if n.ip_address and n.ip_address != "DHCP"),
                None,
            )
            offline_devices.append({
                "id": device.id,
                "name": device.name,
                "ip": primary_ip,
                "status": last.status.value,
                "last_seen": last.timestamp.isoformat(),
            })
    monitoring_online = monitoring_total - len(offline_devices)

    # Recently added devices (in-service, last 5)
    recent_devices_rows = (
        db.query(Device)
        .filter(Device.status == DeviceStatus.in_service)
        .order_by(Device.created_at.desc())
        .limit(5)
        .all()
    )
    recent_devices = [
        {
            "id": d.id,
            "name": d.name,
            "brand": d.brand,
            "model": d.model,
            "location": d.location,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in recent_devices_rows
    ]

    recent_audit = (
        db.query(AuditLog)
        .order_by(AuditLog.timestamp.desc())
        .limit(50)
        .all()
    )

    return {
        "total_devices": total_devices,
        "in_service": in_service,
        "stock_count": stock_count,
        "undeployed_count": undeployed_count,
        "decommissioned_count": decommissioned_count,
        "unread_alerts": unread_alerts,
        "critical_alerts": critical_alerts,
        "warning_alerts": warning_alerts,
        "info_alerts": info_alerts,
        "monitoring_total": monitoring_total,
        "monitoring_online": monitoring_online,
        "networks": networks,
        "by_category": by_category,
        "by_brand": by_brand,
        "offline_devices": offline_devices,
        "recent_devices": recent_devices,
        "recent_activity": [
            {
                "id": e.id,
                "entity_type": e.entity_type,
                "entity_id": e.entity_id,
                "entity_name": e.entity_name,
                "action": e.action.value,
                "username": e.username,
                "timestamp": e.timestamp.isoformat(),
            }
            for e in recent_audit
        ],
    }
