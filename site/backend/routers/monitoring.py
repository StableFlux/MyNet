from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta

from database import get_db
from models.monitoring import MonitoringResult, PingStatus
from models.device import Device
from models.user import User
from services.auth import require_viewer, require_editor
from services.monitoring_scheduler import ping_device

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])

STATUS_ORDER = {"down": 0, "timeout": 1, "unknown": 2, "up": 3}


@router.get("/summary")
def monitoring_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Per-network category health summary for the dashboard.
    Returns: [{network_id, network_name, color, total, online, offline}]
    """
    from models.nic import Nic

    from sqlalchemy.orm import joinedload
    monitored = (
        db.query(Device)
        .filter(Device.monitoring_enabled.is_(True))
        .options(joinedload(Device.nics).joinedload(Nic.network))
        .all()
    )

    if not monitored:
        return []

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

    network_stats: dict[int, dict] = {}

    for device in monitored:
        # Determine the device's primary network
        primary_net = None
        for nic in device.nics:
            if nic.network_id:
                primary_net = nic.network
                break

        net_id = primary_net.id if primary_net else 0
        net_name = primary_net.name if primary_net else "Unassigned"
        net_color = primary_net.color if primary_net else "#64748b"

        if net_id not in network_stats:
            network_stats[net_id] = {
                "network_id": net_id,
                "network_name": net_name,
                "color": net_color,
                "total": 0,
                "online": 0,
                "offline": 0,
            }

        network_stats[net_id]["total"] += 1

        last = last_by_device.get(device.id)
        if last and last.status == PingStatus.up:
            network_stats[net_id]["online"] += 1
        else:
            network_stats[net_id]["offline"] += 1

    return list(network_stats.values())


@router.get("/devices")
def monitored_devices(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Full list of monitored devices with per-NIC stats and sparklines.
    Uses SQL aggregates + a window-function sparkline query to avoid loading bulk history rows.
    """
    from models.nic import Nic
    from sqlalchemy.orm import joinedload
    from sqlalchemy import text

    since = datetime.now(timezone.utc) - timedelta(hours=24)

    # Query 1: devices with nics + networks eagerly loaded (no per-device round trips)
    devices = (
        db.query(Device)
        .filter(Device.monitoring_enabled.is_(True))
        .options(
            joinedload(Device.nics).joinedload(Nic.network),
            joinedload(Device.device_type),
        )
        .all()
    )
    if not devices:
        return []

    device_ids = [d.id for d in devices]
    # Build NIC lookup from already-loaded relationships (no extra query)
    nic_by_id: dict[int, Nic] = {n.id: n for d in devices for n in d.nics}

    # Inline integer list — safe because device_ids come from a DB query, not user input
    id_list = ",".join(str(i) for i in device_ids)

    # Query 2: 24h aggregate stats per (device_id, ip_pinged) — all in SQL, no row iteration
    agg_rows = db.execute(
        text(f"""
            SELECT device_id, ip_pinged,
                   COUNT(*) AS total,
                   SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up_count,
                   AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) AS avg_latency
            FROM monitoring_results
            WHERE device_id IN ({id_list})
              AND timestamp >= :since
            GROUP BY device_id, ip_pinged
        """),
        {"since": since.isoformat()},
    ).fetchall()

    # Query 3: last result per (device_id, ip_pinged) for current status + latency
    last_rows = db.execute(
        text(f"""
            SELECT mr.device_id, mr.ip_pinged, mr.status, mr.latency_ms, mr.timestamp
            FROM monitoring_results mr
            INNER JOIN (
                SELECT device_id, ip_pinged, MAX(id) AS max_id
                FROM monitoring_results
                WHERE device_id IN ({id_list})
                GROUP BY device_id, ip_pinged
            ) latest ON mr.id = latest.max_id
        """),
    ).fetchall()

    # Query 4: last 48 sparkline points per (device_id, ip_pinged) via window function
    sparkline_rows = db.execute(
        text(f"""
            SELECT device_id, ip_pinged, timestamp, latency_ms, status
            FROM (
                SELECT device_id, ip_pinged, timestamp, latency_ms, status,
                       ROW_NUMBER() OVER (
                           PARTITION BY device_id, ip_pinged
                           ORDER BY timestamp DESC
                       ) AS rn
                FROM monitoring_results
                WHERE device_id IN ({id_list})
            ) ranked
            WHERE rn <= 48
            ORDER BY device_id, ip_pinged, timestamp ASC
        """),
    ).fetchall()

    # Index all pre-computed data for O(1) lookup
    agg_by_nic: dict[tuple, any] = {(r.device_id, r.ip_pinged): r for r in agg_rows}
    last_by_nic: dict[tuple, any] = {(r.device_id, r.ip_pinged): r for r in last_rows}
    sparklines_by_nic: dict[tuple, list] = {}
    for row in sparkline_rows:
        key = (row.device_id, row.ip_pinged)
        sparklines_by_nic.setdefault(key, []).append({
            "t": row.timestamp if isinstance(row.timestamp, str) else row.timestamp.isoformat(),
            "latency": row.latency_ms,
            "status": row.status,
        })

    results = []
    for device in devices:
        # Resolve monitored NICs — same three-tier logic as the scheduler
        monitored_nics: list = []

        if device.monitor_nic_ids:
            for nic_id in device.monitor_nic_ids:
                nic = nic_by_id.get(nic_id)
                if nic and nic.ip_address and nic.ip_address != "DHCP":
                    monitored_nics.append(nic)

        if not monitored_nics and device.monitor_target_nic_id:
            nic = nic_by_id.get(device.monitor_target_nic_id)
            if nic and nic.ip_address and nic.ip_address != "DHCP":
                monitored_nics.append(nic)

        if not monitored_nics:
            for nic in device.nics:
                if nic.ip_address and nic.ip_address != "DHCP":
                    monitored_nics.append(nic)
                    break

        if not monitored_nics:
            continue

        # Build per-NIC entries from pre-computed lookups
        nic_entries = []
        for nic in monitored_nics:
            ip = nic.ip_address
            key = (device.id, ip)
            agg = agg_by_nic.get(key)
            last = last_by_nic.get(key)
            network = nic.network

            nic_entries.append({
                "nic_id": nic.id,
                "nic_label": nic.label or (nic.nic_type.value if nic.nic_type else None),
                "ip": ip,
                "network_name": network.name if network else None,
                "network_color": network.color if network else None,
                "vlan_id": network.vlan_id if network else None,
                "status": last.status if last else "unknown",
                "latency_ms": last.latency_ms if last else None,
                "uptime_pct": round(agg.up_count / agg.total * 100, 1) if agg and agg.total > 0 else None,
                "avg_latency": round(float(agg.avg_latency), 2) if agg and agg.avg_latency is not None else None,
                "sparkline": sparklines_by_nic.get(key, []),
            })

        # Overall device stats: aggregate across all monitored NICs
        dev_total = sum(agg_by_nic[(device.id, n.ip_address)].total for n in monitored_nics if (device.id, n.ip_address) in agg_by_nic)
        dev_up = sum(agg_by_nic[(device.id, n.ip_address)].up_count for n in monitored_nics if (device.id, n.ip_address) in agg_by_nic)
        dev_latencies = [agg_by_nic[(device.id, n.ip_address)].avg_latency for n in monitored_nics if (device.id, n.ip_address) in agg_by_nic and agg_by_nic[(device.id, n.ip_address)].avg_latency is not None]

        # Last result overall = most recent across all monitored NICs
        last_result = max(
            [last_by_nic[k] for k in [(device.id, n.ip_address) for n in monitored_nics] if k in last_by_nic],
            key=lambda r: r.timestamp,
            default=None,
        )

        # Combined sparkline: merge all NIC sparklines, keep last 48 by time
        combined_sparkline = sorted(
            [pt for n in monitored_nics for pt in sparklines_by_nic.get((device.id, n.ip_address), [])],
            key=lambda p: p["t"],
        )[-48:]

        results.append({
            "device_id": device.id,
            "device_name": device.name,
            "device_type": device.device_type.name if device.device_type else None,
            "device_type_icon": device.device_type.icon if device.device_type else None,
            "hardware_type": device.hardware_type,
            "location": device.location,
            "status": last_result.status if last_result else "unknown",
            "latency_ms": last_result.latency_ms if last_result else None,
            "last_seen": last_result.timestamp if last_result else None,
            "uptime_pct": round(dev_up / dev_total * 100, 1) if dev_total > 0 else None,
            "avg_latency": round(sum(dev_latencies) / len(dev_latencies), 2) if dev_latencies else None,
            "sparkline": combined_sparkline,
            "nics": nic_entries,
        })

    results.sort(key=lambda d: STATUS_ORDER.get(d["status"], 2))
    return results


@router.get("/device/{device_id}")
def device_monitoring(
    device_id: int,
    hours: int = Query(24, le=168),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """Per-device monitoring history for the device detail widget."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    results = (
        db.query(MonitoringResult)
        .filter(
            MonitoringResult.device_id == device_id,
            MonitoringResult.timestamp >= since,
        )
        .order_by(MonitoringResult.timestamp.desc())
        .limit(200)
        .all()
    )

    last = results[0] if results else None

    # Group results by ip_pinged
    ip_groups: dict[str, list] = {}
    for r in reversed(results):
        ip_groups.setdefault(r.ip_pinged, []).append(r)

    # Load device to resolve NIC metadata
    device = db.get(Device, device_id)
    nic_by_ip = {}
    if device:
        for nic in device.nics:
            if nic.ip_address:
                nic_by_ip[nic.ip_address] = nic

    nics_list = []
    for ip in sorted(ip_groups.keys()):
        group = ip_groups[ip]
        nic = nic_by_ip.get(ip)
        group_last = group[-1]
        nics_list.append({
            "nic_id": nic.id if nic else None,
            "nic_label": (nic.label if nic and nic.label else (nic.nic_type.value if nic and nic.nic_type else None)) if nic else None,
            "nic_type": nic.nic_type.value if nic and nic.nic_type else None,
            "ip": ip,
            "current_status": group_last.status.value,
            "current_latency": group_last.latency_ms,
            "history": [
                {"t": r.timestamp.isoformat(), "latency": r.latency_ms, "status": r.status.value}
                for r in group
            ],
        })

    return {
        "device_id": device_id,
        "current_status": last.status.value if last else "unknown",
        "current_latency": last.latency_ms if last else None,
        "last_checked": last.timestamp.isoformat() if last else None,
        "history": [
            {"t": r.timestamp.isoformat(), "latency": r.latency_ms, "status": r.status.value}
            for r in reversed(results)
        ],
        "nics": nics_list,
    }


@router.post("/ping/{device_id}")
async def ping_now(
    device_id: int,
    ip: str = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    """On-demand ping for Quick Actions. Optional ?ip= to target a specific NIC."""
    from fastapi import HTTPException
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")

    if not ip:
        for nic in device.nics:
            if nic.ip_address and nic.ip_address != "DHCP":
                ip = nic.ip_address
                break
    if not ip:
        raise HTTPException(400, "No pingable IP address on device")

    return await ping_device(device_id, ip)
