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

log = logging.getLogger(__name__)

# How often the batch tick fires. Devices with longer intervals are skipped
# until they're actually due (tracked via _last_pinged).
TICK_SECS = 30

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
    from models.alert import Alert, AlertType, AlertSeverity
    from sqlalchemy.orm import joinedload

    now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        devices = (
            db.query(Device)
            .filter(Device.monitoring_enabled.is_(True))
            .options(joinedload(Device.nics))
            .all()
        )

        # Collect (device_id, ip, interval_secs) for devices that are due
        due: list[tuple[int, str, int]] = []
        for device in devices:
            interval = device.monitor_interval_secs or settings.monitoring_default_interval_secs
            for ip in resolve_monitor_ips(device):
                last = _last_pinged.get((device.id, ip))
                if last is None or (now - last).total_seconds() >= interval:
                    due.append((device.id, ip, interval))

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
                privileged=False,
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

        # Alert handling — batch-load recent results and open alerts to avoid per-device queries
        device_map = {d.id: d for d in devices}
        failed_device_ids = list({device_id for device_id, _ in failed_keys})
        recovered_keys = [(device_id, ip) for device_id, ip, _ in due if (device_id, ip) not in set(failed_keys)]
        all_alert_device_ids = list({device_id for device_id, _ in failed_keys} | {device_id for device_id, _ in recovered_keys})

        # Batch: last N results per (device_id, ip) for failed devices
        threshold = settings.monitoring_failure_threshold
        if failed_device_ids:
            from sqlalchemy import text as _text
            id_list = ",".join(str(i) for i in failed_device_ids)
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
            # Group: {(device_id, ip): [status, ...]}
            recent_by_key: dict[tuple, list] = {}
            for row in recent_rows:
                recent_by_key.setdefault((row.device_id, row.ip_pinged), []).append(row.status)
        else:
            recent_by_key = {}

        # Batch: open offline alerts for all involved devices
        open_offline_alerts: dict[int, Alert] = {}
        if all_alert_device_ids:
            for alert in (
                db.query(Alert)
                .filter(
                    Alert.device_id.in_(all_alert_device_ids),
                    Alert.alert_type == AlertType.device_offline,
                    Alert.acknowledged_at.is_(None),
                )
                .all()
            ):
                open_offline_alerts[alert.device_id] = alert

        for device_id, ip in failed_keys:
            statuses = recent_by_key.get((device_id, ip), [])
            if (
                len(statuses) >= threshold
                and all(s != PingStatus.up for s in statuses)
                and device_id not in open_offline_alerts
            ):
                dev = device_map.get(device_id)
                name = dev.name if dev else f"Device {device_id}"
                db.add(Alert(
                    alert_type=AlertType.device_offline,
                    device_id=device_id,
                    message=f"{name} ({ip}) has been offline for {threshold} consecutive checks.",
                    severity=AlertSeverity.critical,
                ))

        for device_id, ip in recovered_keys:
            offline_alert = open_offline_alerts.get(device_id)
            if offline_alert:
                dev = device_map.get(device_id)
                name = dev.name if dev else f"Device {device_id}"
                db.add(Alert(
                    alert_type=AlertType.device_recovered,
                    device_id=device_id,
                    message=f"{name} ({ip}) is back online.",
                    severity=AlertSeverity.info,
                ))
                offline_alert.acknowledged_at = now

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
        trigger=IntervalTrigger(seconds=TICK_SECS),
        id="batch_ping",
        replace_existing=True,
        misfire_grace_time=10,
    )
    scheduler.add_job(
        cleanup_old_results,
        trigger=IntervalTrigger(hours=2),
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
            icmplib.ping, ip, count=2, timeout=2, privileged=False
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
