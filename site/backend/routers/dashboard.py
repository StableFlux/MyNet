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
from models.event import Event, EventSeverity, EventCategory
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

    # Active event counts by severity (unresolved warning/critical)
    active_events_q = db.query(Event).filter(Event.resolved_at.is_(None))
    critical_count = active_events_q.filter(Event.severity == EventSeverity.critical).count()
    warning_count = active_events_q.filter(Event.severity == EventSeverity.warning).count()
    active_count = critical_count + warning_count

    # Top 5 active events for dashboard card (critical first, then warning, newest first)
    active_events = [
        {
            "id": e.id,
            "message": e.message,
            "severity": e.severity.value,
            "category": e.category.value,
            "event_type": e.event_type.value,
            "entity_id": e.entity_id,
            "entity_name": e.entity_name,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in (
            active_events_q
            .filter(Event.severity.in_([EventSeverity.critical, EventSeverity.warning]))
            .order_by(Event.severity.desc(), Event.created_at.desc())
            .limit(5)
            .all()
        )
    ]

    # Recent activity feed (all resolved/point-in-time events, newest first)
    recent_activity = [
        {
            "id": e.id,
            "severity": e.severity.value,
            "category": e.category.value,
            "event_type": e.event_type.value,
            "entity_type": e.entity_type,
            "entity_id": e.entity_id,
            "entity_name": e.entity_name,
            "message": e.message,
            "username": e.username,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in (
            db.query(Event)
            .order_by(Event.created_at.desc())
            .limit(50)
            .all()
        )
    ]

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

    # Monitoring: offline devices + totals + WAN summary — all from one query
    from models.wan_config import WanConfig
    from sqlalchemy import text as _text
    from sqlalchemy.orm import joinedload

    monitored = (
        db.query(Device)
        .filter(Device.monitoring_enabled.is_(True))
        .options(joinedload(Device.nics))
        .all()
    )
    monitoring_total = len(monitored)

    if monitored:
        monitored_ids = [d.id for d in monitored]

        # Load WAN configs once — used for both LAN exclusion and WAN summary
        all_wan_configs = db.query(WanConfig).filter(WanConfig.device_id.in_(monitored_ids)).all()

        wan_ips_by_device: dict[int, set] = {}
        active_wan_configs = []
        for wc in all_wan_configs:
            wan_ip = wc.wan_ping_target or "1.1.1.1"
            wan_ips_by_device.setdefault(wc.device_id, set()).add(wan_ip)
            if wc.wan_monitoring_enabled is not False:
                active_wan_configs.append(wc)

        placeholders = ",".join(f":id{i}" for i in range(len(monitored_ids)))
        params = {f"id{i}": v for i, v in enumerate(monitored_ids)}
        last_rows = db.execute(_text(f"""
            SELECT mr.device_id, mr.ip_pinged, mr.status, mr.timestamp
            FROM monitoring_results mr
            INNER JOIN (
                SELECT device_id, ip_pinged, MAX(id) AS max_id
                FROM monitoring_results
                WHERE device_id IN ({placeholders})
                GROUP BY device_id, ip_pinged
            ) latest ON mr.id = latest.max_id
        """), params).fetchall()

        # Index by (device_id, ip) for WAN lookup
        last_by_key: dict[tuple, object] = {}
        for row in last_rows:
            last_by_key[(row.device_id, row.ip_pinged)] = row

        # LAN: most recent non-WAN result per device
        last_by_device: dict[int, object] = {}
        for row in last_rows:
            if row.ip_pinged in wan_ips_by_device.get(row.device_id, set()):
                continue
            existing = last_by_device.get(row.device_id)
            if existing is None or row.timestamp > existing.timestamp:
                last_by_device[row.device_id] = row
    else:
        last_by_device = {}
        last_by_key = {}
        active_wan_configs = []

    offline_devices = []
    for device in monitored:
        last = last_by_device.get(device.id)
        if last and str(last.status) != PingStatus.up:
            primary_ip = next(
                (n.ip_address for n in device.nics if n.ip_address and n.ip_address != "DHCP"),
                None,
            )
            offline_devices.append({
                "id": device.id,
                "name": device.name,
                "ip": primary_ip,
                "status": str(last.status),
                "last_seen": last.timestamp.isoformat(),
            })
    monitoring_online = monitoring_total - len(offline_devices)

    # WAN summary — reuses last_rows already fetched above
    wan_connections = []
    for wc in active_wan_configs:
        wan_ip = wc.wan_ping_target or "1.1.1.1"
        row = last_by_key.get((wc.device_id, wan_ip))
        status = str(row.status) if row else "unknown"
        wan_connections.append({
            "switch_port_id": wc.switch_port_id,
            "isp_name": wc.isp_name,
            "status": status,
        })
    wan_total = len(wan_connections)
    wan_online_count = sum(1 for c in wan_connections if c["status"] == "up")

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

    return {
        "total_devices": total_devices,
        "in_service": in_service,
        "stock_count": stock_count,
        "undeployed_count": undeployed_count,
        "decommissioned_count": decommissioned_count,
        "active_events": active_count,
        "critical_events": critical_count,
        "warning_events": warning_count,
        "active_event_list": active_events,
        "monitoring_total": monitoring_total,
        "monitoring_online": monitoring_online,
        "wan_summary": {
            "total": wan_total,
            "online": wan_online_count,
            "offline": wan_total - wan_online_count,
            "connections": wan_connections,
        },
        "networks": networks,
        "by_category": by_category,
        "by_brand": by_brand,
        "offline_devices": offline_devices,
        "recent_devices": recent_devices,
        "recent_activity": recent_activity,
    }
