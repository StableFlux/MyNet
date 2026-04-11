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

    # Monitoring: offline devices + totals + WAN summary
    # Uses the SAME resolve_monitor_ips() and per-IP lookup as monitoring.py so
    # every number on the dashboard matches what the Monitoring page shows.
    import logging as _logging
    from models.wan_config import WanConfig
    from sqlalchemy import text as _text
    from sqlalchemy.orm import joinedload
    from services.monitoring_scheduler import resolve_monitor_ips

    _log = _logging.getLogger(__name__)

    offline_devices: list = []
    monitoring_total = 0
    monitoring_online = 0
    wan_connections: list = []

    try:
        monitored = (
            db.query(Device)
            .filter(Device.monitoring_enabled.is_(True))
            .options(joinedload(Device.nics))
            .all()
        )
        monitoring_total = len(monitored)

        if monitored:
            monitored_ids = [d.id for d in monitored]

            # WAN IP exclusion + active WAN configs for summary
            wan_ips_by_device: dict[int, set] = {}
            active_wan_configs: list = []
            for wc in db.query(WanConfig).filter(WanConfig.device_id.in_(monitored_ids)).all():
                wan_ip = wc.wan_ping_target or "1.1.1.1"
                wan_ips_by_device.setdefault(wc.device_id, set()).add(wan_ip)
                if wc.wan_monitoring_enabled is not False:
                    active_wan_configs.append(wc)

            # Latest result per (device_id, ip_pinged) — identical query to monitoring.py
            id_list = ",".join(str(i) for i in monitored_ids)
            last_rows = db.execute(_text(f"""
                SELECT mr.device_id, mr.ip_pinged, mr.status, mr.timestamp
                FROM monitoring_results mr
                INNER JOIN (
                    SELECT device_id, ip_pinged, MAX(id) AS max_id
                    FROM monitoring_results
                    WHERE device_id IN ({id_list})
                    GROUP BY device_id, ip_pinged
                ) latest ON mr.id = latest.max_id
            """)).fetchall()

            last_by_key: dict[tuple, object] = {
                (r.device_id, r.ip_pinged): r for r in last_rows
            }

            # Per-device status using the same three-tier NIC resolution as the
            # scheduler and monitoring summary — ensures dashboard matches Monitoring page
            for device in monitored:
                monitored_ips = resolve_monitor_ips(device)
                # Only LAN IPs (exclude WAN ping targets)
                lan_ips = [
                    ip for ip in monitored_ips
                    if ip not in wan_ips_by_device.get(device.id, set())
                ]

                # Collect latest results for this device's monitored LAN IPs
                lan_results = [
                    last_by_key[(device.id, ip)]
                    for ip in lan_ips
                    if (device.id, ip) in last_by_key
                ]

                if not lan_results:
                    # No LAN results — fall back to WAN ping results (router-only devices)
                    wan_ips = list(wan_ips_by_device.get(device.id, set()))
                    lan_results = [
                        last_by_key[(device.id, ip)]
                        for ip in wan_ips
                        if (device.id, ip) in last_by_key
                    ]

                if lan_results:
                    most_recent = max(lan_results, key=lambda r: r.timestamp)
                    device_status = most_recent.status  # plain string from raw SQL
                    is_online = device_status == PingStatus.up
                    last_seen = most_recent.timestamp.isoformat()
                else:
                    # Never been pinged — treat as offline/unknown
                    device_status = "unknown"
                    is_online = False
                    last_seen = None

                if not is_online:
                    primary_ip = lan_ips[0] if lan_ips else None
                    offline_devices.append({
                        "id": device.id,
                        "name": device.name,
                        "ip": primary_ip,
                        "status": device_status,
                        "last_seen": last_seen,
                    })

            monitoring_online = monitoring_total - len(offline_devices)

            # WAN summary — same logic as /monitoring/wan-summary
            for wc in active_wan_configs:
                wan_ip = wc.wan_ping_target or "1.1.1.1"
                row = last_by_key.get((wc.device_id, wan_ip))
                status = row.status if row else "unknown"
                wan_connections.append({
                    "switch_port_id": wc.switch_port_id,
                    "isp_name": wc.isp_name,
                    "status": status,
                })

        else:
            active_wan_configs = []

    except Exception as _e:
        _log.exception(f"Dashboard monitoring section failed: {_e}")

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
