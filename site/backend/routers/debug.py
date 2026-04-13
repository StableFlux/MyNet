"""
Debug diagnostics endpoint.
Returns backend health, scheduler state, DB stats, and monitoring cache info.
Intended for troubleshooting — copy the output from the /debug UI page and paste it.
"""
import sys
import platform
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from services.auth import require_viewer
from models.user import User

router = APIRouter(prefix="/api/debug", tags=["debug"])


@router.get("")
def debug_info(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    from models.device import Device
    from models.monitoring import MonitoringResult
    from models.event import Event
    from models.event import EventType
    from models.nic import Nic
    from services.monitoring_scheduler import scheduler, _last_pinged

    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    # ── Scheduler ────────────────────────────────────────────────────────────
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger": str(job.trigger),
        })

    # ── DB stats ─────────────────────────────────────────────────────────────
    devices_total = db.query(func.count(Device.id)).scalar() or 0
    devices_monitored = db.query(func.count(Device.id)).filter(Device.monitoring_enabled.is_(True)).scalar() or 0
    nics_total = db.query(func.count(Nic.id)).scalar() or 0
    monitoring_results_total = db.query(func.count(MonitoringResult.id)).scalar() or 0
    monitoring_results_24h = db.query(func.count(MonitoringResult.id)).filter(
        MonitoringResult.timestamp >= since_24h
    ).scalar() or 0
    open_events = db.query(func.count(Event.id)).filter(Event.resolved_at.is_(None)).scalar() or 0

    # Last monitoring result timestamp
    last_result = db.query(func.max(MonitoringResult.timestamp)).scalar()

    # ── Monitoring in-memory cache ────────────────────────────────────────────
    pinged_times = list(_last_pinged.values())
    monitoring_cache = {
        "tracked_ips": len(_last_pinged),
        "oldest_ping": min(pinged_times).isoformat() if pinged_times else None,
        "newest_ping": max(pinged_times).isoformat() if pinged_times else None,
        "seconds_since_last_ping": round((now - max(pinged_times)).total_seconds()) if pinged_times else None,
    }

    # ── System ───────────────────────────────────────────────────────────────
    try:
        import psutil
        proc = psutil.Process()
        system = {
            "cpu_percent_1s": psutil.cpu_percent(interval=1),
            "memory_total_mb": round(psutil.virtual_memory().total / 1024 ** 2),
            "memory_used_mb": round(psutil.virtual_memory().used / 1024 ** 2),
            "memory_percent": psutil.virtual_memory().percent,
            "process_rss_mb": round(proc.memory_info().rss / 1024 ** 2),
            "load_avg": list(psutil.getloadavg()) if hasattr(psutil, "getloadavg") else None,
        }
    except ImportError:
        system = {"note": "psutil not installed — add it to requirements.txt for system metrics"}

    return {
        "timestamp": now.isoformat(),
        "python": sys.version,
        "platform": platform.platform(),
        "scheduler": {
            "running": scheduler.running,
            "jobs": jobs,
        },
        "monitoring_cache": monitoring_cache,
        "database": {
            "devices_total": devices_total,
            "devices_monitored": devices_monitored,
            "nics_total": nics_total,
            "monitoring_results_total": monitoring_results_total,
            "monitoring_results_24h": monitoring_results_24h,
            "last_result_at": last_result.isoformat() if last_result else None,
            "seconds_since_last_result": round((now - last_result).total_seconds()) if last_result else None,
            "open_events": open_events,
        },
        "system": system,
    }
