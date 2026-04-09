from fastapi import APIRouter, Depends, HTTPException, Query
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


@router.get("/wan-summary")
def wan_monitoring_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """WAN connection monitoring summary for the dashboard."""
    from models.wan_config import WanConfig
    from sqlalchemy import text

    wan_configs = (
        db.query(WanConfig)
        .join(WanConfig.device)
        .filter(
            Device.monitoring_enabled.is_(True),
            WanConfig.wan_monitoring_enabled.isnot(False),
        )
        .all()
    )

    if not wan_configs:
        return {"total": 0, "online": 0, "offline": 0, "connections": []}

    device_ids = list({wc.device_id for wc in wan_configs})
    id_list = ",".join(str(i) for i in device_ids)

    last_rows = db.execute(text(f"""
        SELECT mr.device_id, mr.ip_pinged, mr.status
        FROM monitoring_results mr
        INNER JOIN (
            SELECT device_id, ip_pinged, MAX(id) AS max_id
            FROM monitoring_results
            WHERE device_id IN ({id_list})
            GROUP BY device_id, ip_pinged
        ) latest ON mr.id = latest.max_id
    """)).fetchall()

    last_by_key = {(r.device_id, r.ip_pinged): r.status for r in last_rows}

    connections = []
    for wc in wan_configs:
        wan_ip = wc.wan_ping_target or "1.1.1.1"
        status = last_by_key.get((wc.device_id, wan_ip), "unknown")
        connections.append({
            "switch_port_id": wc.switch_port_id,
            "isp_name": wc.isp_name,
            "status": status,
        })

    online = sum(1 for c in connections if c["status"] == "up")
    return {
        "total": len(connections),
        "online": online,
        "offline": len(connections) - online,
        "connections": connections,
    }


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

    # Build WAN IP exclusion set (same pattern as dashboard)
    from models.wan_config import WanConfig
    from sqlalchemy import text as _text
    wan_ips_by_device: dict[int, set] = {}
    for wc in db.query(WanConfig).filter(WanConfig.device_id.in_(monitored_ids)).all():
        wan_ips_by_device.setdefault(wc.device_id, set()).add(wc.wan_ping_target or "1.1.1.1")

    # Get latest result per (device_id, ip_pinged)
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

    last_by_nic: dict[tuple, object] = {
        (r.device_id, r.ip_pinged): r for r in last_rows
        if r.ip_pinged not in wan_ips_by_device.get(r.device_id, set())
    }

    # Use same three-tier NIC resolution as the scheduler so counts match what is actually pinged
    from services.monitoring_scheduler import resolve_monitor_ips
    nic_by_ip: dict[tuple, object] = {}
    for device in monitored:
        for nic in device.nics:
            if nic.ip_address and nic.ip_address != "DHCP":
                nic_by_ip[(device.id, nic.ip_address)] = nic

    network_stats: dict[int, dict] = {}

    for device in monitored:
        monitored_ips = resolve_monitor_ips(device)
        for ip in monitored_ips:
            nic = nic_by_ip.get((device.id, ip))
            net = nic.network if nic and nic.network_id else None

            net_id = net.id if net else 0
            net_name = net.name if net else "Unassigned"
            net_color = net.color if net else "#64748b"

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
            row = last_by_nic.get((device.id, ip))
            if row and str(row.status) == PingStatus.up:
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

    # Load WAN configs for all monitored devices
    from models.wan_config import WanConfig
    wan_configs_by_device: dict[int, list] = {}
    for wc in db.query(WanConfig).filter(WanConfig.device_id.in_(device_ids)).all():
        wan_configs_by_device.setdefault(wc.device_id, []).append(wc)

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

        wan_configs = wan_configs_by_device.get(device.id, [])
        if not monitored_nics and not wan_configs:
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
                "nic_type": nic.nic_type.value if nic.nic_type else None,
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

        # Add WAN ping target entries
        for wc in wan_configs:
            if wc.wan_monitoring_enabled is False:
                continue
            wan_ip = wc.wan_ping_target or "1.1.1.1"
            key = (device.id, wan_ip)
            last = last_by_nic.get(key)
            agg = agg_by_nic.get(key)
            nic_entries.append({
                "nic_id": None,
                "nic_label": f"WAN{' – ' + wc.isp_name if wc.isp_name else ''}",
                "ip": wan_ip,
                "switch_port_id": wc.switch_port_id,
                "is_wan_ping": True,
                "network_name": None,
                "network_color": None,
                "vlan_id": None,
                "status": last.status if last else "unknown",
                "latency_ms": last.latency_ms if last else None,
                "uptime_pct": round(agg.up_count / agg.total * 100, 1) if agg and agg.total > 0 else None,
                "avg_latency": round(float(agg.avg_latency), 2) if agg and agg.avg_latency is not None else None,
                "sparkline": sparklines_by_nic.get(key, []),
            })

        if not nic_entries:
            continue

        # Overall device stats: aggregate across LAN NICs
        lan_keys = [(device.id, n.ip_address) for n in monitored_nics]
        dev_total = sum(agg_by_nic[k].total for k in lan_keys if k in agg_by_nic)
        dev_up = sum(agg_by_nic[k].up_count for k in lan_keys if k in agg_by_nic)
        dev_latencies = [agg_by_nic[k].avg_latency for k in lan_keys if k in agg_by_nic and agg_by_nic[k].avg_latency is not None]
        last_result = max(
            [last_by_nic[k] for k in lan_keys if k in last_by_nic],
            key=lambda r: r.timestamp,
            default=None,
        )
        combined_sparkline = sorted(
            [pt for k in lan_keys for pt in sparklines_by_nic.get(k, [])],
            key=lambda p: p["t"],
        )[-48:]

        # Fall back to WAN ping stats if no LAN NIC data available
        if dev_total == 0 and not last_result:
            wan_keys = [
                (device.id, wc.wan_ping_target or "1.1.1.1")
                for wc in wan_configs
                if wc.wan_monitoring_enabled is not False
            ]
            dev_total = sum(agg_by_nic[k].total for k in wan_keys if k in agg_by_nic)
            dev_up = sum(agg_by_nic[k].up_count for k in wan_keys if k in agg_by_nic)
            dev_latencies = [agg_by_nic[k].avg_latency for k in wan_keys if k in agg_by_nic and agg_by_nic[k].avg_latency is not None]
            last_result = max(
                [last_by_nic[k] for k in wan_keys if k in last_by_nic],
                key=lambda r: r.timestamp,
                default=None,
            )
            combined_sparkline = sorted(
                [pt for k in wan_keys for pt in sparklines_by_nic.get(k, [])],
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

    # Load WAN configs to label WAN ping targets
    from models.wan_config import WanConfig
    wan_by_ip: dict[str, WanConfig] = {}
    for wc in db.query(WanConfig).filter(WanConfig.device_id == device_id).all():
        wan_ip = wc.wan_ping_target or "1.1.1.1"
        wan_by_ip[wan_ip] = wc

    nics_list = []
    for ip in sorted(ip_groups.keys()):
        group = ip_groups[ip]
        nic = nic_by_ip.get(ip)
        wan = wan_by_ip.get(ip)
        group_last = group[-1]
        if nic:
            label = nic.label if nic.label else (nic.nic_type.value if nic.nic_type else None)
            nic_type = nic.nic_type.value if nic.nic_type else None
            is_wan_ping = False
        elif wan:
            label = f"WAN{' – ' + wan.isp_name if wan.isp_name else ''}"
            nic_type = "wan"
            is_wan_ping = True
        else:
            label = None
            nic_type = None
            is_wan_ping = False
        nics_list.append({
            "nic_id": nic.id if nic else None,
            "nic_label": label,
            "nic_type": nic_type,
            "is_wan_ping": is_wan_ping,
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
