"""
Batch ping scheduler.

Single ticker job runs every TICK_SECS and pings all due devices simultaneously
using icmplib.multiping(), which handles hundreds of hosts in one call.

Replaces N individual per-device APScheduler jobs with one efficient loop —
the same model used by Smokeping, Zabbix, LibreNMS, etc.

Public API is backwards-compatible:
  - schedule_device / unschedule_device / schedule_device_nics are kept as stubs
    (the batch poller reads live DB state; no manual job registration needed)
  - load_all_monitored_devices() now starts the batch scheduler
  - set_broadcast_fn() unchanged
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import icmplib

from config import settings
from services.events import log_event, resolve_events
from models.event import EventType

log = logging.getLogger(__name__)

# How often the batch tick fires. Devices with longer intervals are skipped
# until they're actually due (tracked via _last_pinged).
TICK_SECS = 60

scheduler = AsyncIOScheduler()
_ws_broadcast_fn = None

# In-memory: (device_id, ip) → datetime of last successful ping attempt
_last_pinged: dict[tuple[int, str], datetime] = {}


def set_broadcast_fn(fn):
    global _ws_broadcast_fn
    _ws_broadcast_fn = fn


# ── NIC resolution ────────────────────────────────────────────────────────────

def resolve_monitor_ips(device) -> list[str]:
    """
    Three-tier NIC resolution used by both the scheduler and the devices router:
    monitor_nic_ids → monitor_target_nic_id → first NIC with a real IP.
    """
    nic_by_id = {n.id: n for n in device.nics}
    ips: list[str] = []

    if device.monitor_nic_ids:
        for nic_id in device.monitor_nic_ids:
            nic = nic_by_id.get(nic_id)
            if nic and nic.ip_address and nic.ip_address != "DHCP":
                ips.append(nic.ip_address)

    if not ips and device.monitor_target_nic_id:
        nic = nic_by_id.get(device.monitor_target_nic_id)
        if nic and nic.ip_address and nic.ip_address != "DHCP":
            ips.append(nic.ip_address)

    if not ips:
        for nic in device.nics:
            if nic.ip_address and nic.ip_address != "DHCP":
                ips.append(nic.ip_address)
                break

    return ips


# ── Batch tick ────────────────────────────────────────────────────────────────

async def run_batch_tick():
    """
    Fires every TICK_SECS. Determines which devices are due for a ping
    (based on their interval and _last_pinged), pings them all at once,
    then bulk-inserts results and handles alerts.
    """
    from database import SessionLocal
    from models.device import Device
    from models.monitoring import MonitoringResult, PingStatus
    from models.event import Event, EventType
    from sqlalchemy.orm import joinedload

    now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        from models.wan_config import WanConfig

        devices = (
            db.query(Device)
            .filter(Device.monitoring_enabled.is_(True))
            .options(joinedload(Device.nics))
            .all()
        )

        monitored_ids = {d.id for d in devices}

        # Load WAN configs for monitored devices
        wan_configs_for_devices: dict[int, list] = {}
        if monitored_ids:
            for wc in db.query(WanConfig).filter(WanConfig.device_id.in_(monitored_ids)).all():
                wan_configs_for_devices.setdefault(wc.device_id, []).append(wc)

        # Build a set of WAN ping keys so we can separate them from NIC pings in event handling
        wan_keys: set[tuple[int, str]] = set()
        # (device_id, switch_port_id) → WanConfig for event messaging
        wan_config_by_key: dict[tuple[int, str], object] = {}
        for device_id, wcs in wan_configs_for_devices.items():
            for wc in wcs:
                if wc.wan_monitoring_enabled is not False:
                    wan_ip = wc.wan_ping_target or "1.1.1.1"
                    wan_keys.add((device_id, wan_ip))
                    wan_config_by_key[(device_id, wan_ip)] = wc

        # Collect (device_id, ip, interval_secs) for devices that are due
        due: list[tuple[int, str, int]] = []
        for device in devices:
            interval = device.monitor_interval_secs or settings.monitoring_default_interval_secs
            for ip in resolve_monitor_ips(device):
                last = _last_pinged.get((device.id, ip))
                if last is None or (now - last).total_seconds() >= interval:
                    due.append((device.id, ip, interval))
            # WAN ping targets
            for wc in wan_configs_for_devices.get(device.id, []):
                if wc.wan_monitoring_enabled is False:
                    continue
                wan_ip = wc.wan_ping_target or "1.1.1.1"
                last = _last_pinged.get((device.id, wan_ip))
                if last is None or (now - last).total_seconds() >= interval:
                    due.append((device.id, wan_ip, interval))

        if not due:
            return

        # Ping all due IPs in one call — icmplib handles concurrency internally
        ip_list = [ip for _, ip, _ in due]
        try:
            ping_results = await asyncio.to_thread(
                icmplib.multiping,
                ip_list,
                count=1,
                timeout=2,
                concurrent_tasks=min(len(ip_list), 150),
                privileged=True,
            )
            result_by_ip = {r.address: r for r in ping_results}
        except Exception as e:
            log.error(f"multiping failed: {e}")
            return

        # Build result rows and update last-pinged cache
        rows: list[MonitoringResult] = []
        broadcast_items: list[dict] = []
        failed_keys: list[tuple[int, str]] = []  # for alert checking

        for device_id, ip, _ in due:
            ping = result_by_ip.get(ip)
            if ping and ping.is_alive:
                status, latency = "up", round(ping.avg_rtt, 2)
            elif ping:
                status, latency = "down", None
            else:
                status, latency = "timeout", None

            _last_pinged[(device_id, ip)] = now

            rows.append(MonitoringResult(
                device_id=device_id,
                ip_pinged=ip,
                status=status,
                latency_ms=latency,
                timestamp=now,
            ))
            broadcast_items.append({
                "type": "ping_result",
                "device_id": device_id,
                "ip_pinged": ip,
                "status": status,
                "latency_ms": latency,
                "timestamp": now.isoformat(),
            })
            if status != "up":
                failed_keys.append((device_id, ip))

        db.add_all(rows)
        db.flush()  # get IDs without committing yet

        # Event handling — split WAN keys from NIC keys
        device_map = {d.id: d for d in devices}
        failed_set = set(failed_keys)
        nic_failed = [(did, ip) for did, ip in failed_keys if (did, ip) not in wan_keys]
        wan_failed = [(did, ip) for did, ip in failed_keys if (did, ip) in wan_keys]
        recovered_keys = [(did, ip) for did, ip, _ in due if (did, ip) not in failed_set]
        nic_recovered = [(did, ip) for did, ip in recovered_keys if (did, ip) not in wan_keys]
        wan_recovered_keys = [(did, ip) for did, ip in recovered_keys if (did, ip) in wan_keys]

        all_event_device_ids = list({did for did, _ in failed_keys} | {did for did, _ in recovered_keys})

        # Batch: last N results per (device_id, ip) for threshold checks
        threshold = settings.monitoring_failure_threshold
        all_failed_device_ids = list({did for did, _ in failed_keys})
        if all_failed_device_ids:
            from sqlalchemy import text as _text
            id_list = ",".join(str(i) for i in all_failed_device_ids)
            recent_rows = db.execute(_text(f"""
                SELECT device_id, ip_pinged, status
                FROM (
                    SELECT device_id, ip_pinged, status,
                           ROW_NUMBER() OVER (
                               PARTITION BY device_id, ip_pinged
                               ORDER BY timestamp DESC
                           ) AS rn
                    FROM monitoring_results
                    WHERE device_id IN ({id_list})
                ) ranked
                WHERE rn <= :threshold
            """), {"threshold": threshold}).fetchall()
            recent_by_key: dict[tuple, list] = {}
            for row in recent_rows:
                recent_by_key.setdefault((row.device_id, row.ip_pinged), []).append(row.status)
        else:
            recent_by_key = {}

        # Open device_offline events (NIC pings only)
        open_device_offline: dict[int, Event] = {}
        open_wan_offline: dict[tuple[int, str], Event] = {}
        if all_event_device_ids:
            for ev in (
                db.query(Event)
                .filter(
                    Event.entity_id.in_(all_event_device_ids),
                    Event.event_type.in_([EventType.device_offline, EventType.wan_offline]),
                    Event.resolved_at.is_(None),
                )
                .all()
            ):
                if ev.event_type == EventType.device_offline:
                    open_device_offline[ev.entity_id] = ev
                elif ev.event_type == EventType.wan_offline:
                    ip = (ev.detail or {}).get("ip", "")
                    open_wan_offline[(ev.entity_id, ip)] = ev

        # NIC failures → device_offline
        for device_id, ip in nic_failed:
            statuses = recent_by_key.get((device_id, ip), [])
            if (
                len(statuses) >= threshold
                and all(s != PingStatus.up for s in statuses)
                and device_id not in open_device_offline
            ):
                dev = device_map.get(device_id)
                name = dev.name if dev else f"Device {device_id}"
                log_event(
                    db, EventType.device_offline,
                    message=f"{name} ({ip}) has been offline for {threshold} consecutive checks.",
                    entity_type="device", entity_id=device_id, entity_name=name,
                    detail={"ip": ip, "threshold": threshold},
                )

        # WAN failures → wan_offline
        for device_id, ip in wan_failed:
            statuses = recent_by_key.get((device_id, ip), [])
            if (
                len(statuses) >= threshold
                and all(s != PingStatus.up for s in statuses)
                and (device_id, ip) not in open_wan_offline
            ):
                dev = device_map.get(device_id)
                dev_name = dev.name if dev else f"Device {device_id}"
                wc = wan_config_by_key.get((device_id, ip))
                isp = wc.isp_name if wc and wc.isp_name else ip
                log_event(
                    db, EventType.wan_offline,
                    message=f"{dev_name} — WAN connection {isp} ({ip}) has been offline for {threshold} consecutive checks.",
                    entity_type="device", entity_id=device_id, entity_name=dev_name,
                    detail={"ip": ip, "isp_name": isp, "threshold": threshold},
                )

        # NIC recoveries → device_recovered
        for device_id, ip in nic_recovered:
            if device_id in open_device_offline:
                dev = device_map.get(device_id)
                name = dev.name if dev else f"Device {device_id}"
                log_event(
                    db, EventType.device_recovered,
                    message=f"{name} ({ip}) is back online.",
                    entity_type="device", entity_id=device_id, entity_name=name,
                    detail={"ip": ip},
                )
                resolve_events(db, EventType.device_offline, device_id)

        # WAN recoveries → wan_recovered
        # Keyed by device (not IP) so IP changes don't prevent resolution
        seen_wan_recovered: set[int] = set()
        for device_id, ip in wan_recovered_keys:
            if device_id in seen_wan_recovered:
                continue
            # Any open wan_offline event for this device, regardless of which IP it was for
            has_open = any(did == device_id for did, _ in open_wan_offline)
            if has_open:
                seen_wan_recovered.add(device_id)
                dev = device_map.get(device_id)
                dev_name = dev.name if dev else f"Device {device_id}"
                wc = wan_config_by_key.get((device_id, ip))
                isp = wc.isp_name if wc and wc.isp_name else ip
                log_event(
                    db, EventType.wan_recovered,
                    message=f"{dev_name} — WAN connection {isp} ({ip}) is back online.",
                    entity_type="device", entity_id=device_id, entity_name=dev_name,
                    detail={"ip": ip, "isp_name": isp},
                )
                resolve_events(db, EventType.wan_offline, device_id)

        db.commit()

    except Exception as e:
        log.exception(f"Batch ping tick failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()

    # Broadcast outside the DB session
    if _ws_broadcast_fn:
        for item in broadcast_items:
            await _ws_broadcast_fn(item)


async def cleanup_old_results():
    """
    Trim monitoring results older than 48 hours.
    Runs every 2 hours to keep the table small and queries fast.
    """
    from database import SessionLocal
    from models.monitoring import MonitoringResult

    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    db = SessionLocal()
    try:
        deleted = (
            db.query(MonitoringResult)
            .filter(MonitoringResult.timestamp < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        if deleted:
            log.info(f"Monitoring cleanup: removed {deleted} results older than 48h")
    except Exception as e:
        log.exception(f"Monitoring cleanup failed: {e}")
    finally:
        db.close()


# ── Scheduler lifecycle ───────────────────────────────────────────────────────

def load_all_monitored_devices():
    """
    Start the batch scheduler. Called from main.py on startup.
    The batch tick reads live DB state, so no per-device registration needed.
    """
    _ensure_index()

    scheduler.add_job(
        run_batch_tick,
        trigger=IntervalTrigger(seconds=TICK_SECS, jitter=10),
        id="batch_ping",
        replace_existing=True,
        misfire_grace_time=10,
    )
    scheduler.add_job(
        cleanup_old_results,
        trigger=IntervalTrigger(hours=2, jitter=300),
        id="monitoring_cleanup",
        replace_existing=True,
    )

    log.info(f"Monitoring batch scheduler configured (tick every {TICK_SECS}s)")


def _ensure_index():
    """Add a composite index on (device_id, timestamp) if it doesn't exist."""
    from database import engine
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_monitoring_device_ts "
                "ON monitoring_results (device_id, timestamp)"
            ))
            conn.commit()
    except Exception as e:
        log.warning(f"Could not ensure monitoring index: {e}")


# ── Backwards-compatible stubs ────────────────────────────────────────────────
# The batch poller reads live DB state on every tick, so these are no-ops.
# Kept so routers/devices.py doesn't need changes.

def schedule_device(device_id: int, ip: str, interval_secs: int):
    """No-op: batch poller picks up all monitored devices automatically."""
    # Clear the last-pinged cache so the device is pinged on the very next tick
    _last_pinged.pop((device_id, ip), None)


def unschedule_device(device_id: int):
    """No-op: device with monitoring_enabled=False is skipped on next tick."""
    # Clear cache entries for this device
    for key in [k for k in _last_pinged if k[0] == device_id]:
        del _last_pinged[key]


def schedule_device_nics(device_id: int, nic_ips: list[str], interval_secs: int):
    """No-op: batch poller handles NIC resolution from DB on each tick."""
    unschedule_device(device_id)


# Keep the on-demand ping for the Quick Actions endpoint
async def ping_device(device_id: int, ip: str) -> dict:
    try:
        result = await asyncio.to_thread(
            icmplib.ping, ip, count=2, timeout=2, privileged=True
        )
        status = "up" if result.is_alive else "down"
        latency = round(result.avg_rtt, 2) if result.is_alive else None
    except Exception as e:
        log.warning(f"On-demand ping failed for device {device_id} ({ip}): {e}")
        status = "timeout"
        latency = None

    return {
        "device_id": device_id,
        "ip_pinged": ip,
        "status": status,
        "latency_ms": latency,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
