"""
Debug diagnostics endpoint.
Each section is wrapped in its own try/except so a single failure returns
partial results plus the traceback rather than a bare 500.
"""
import sys
import traceback
import platform
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from services.auth import require_viewer
from models.user import User

router = APIRouter(prefix="/api/debug", tags=["debug"])


def _safe(label: str, fn):
    """Run fn(), return its result or an error dict on exception."""
    try:
        return fn()
    except Exception:
        return {"_error": f"{label} failed", "_traceback": traceback.format_exc()}


@router.get("")
def debug_info(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    # ── Scheduler ────────────────────────────────────────────────────────────
    def get_scheduler():
        from services.monitoring_scheduler import scheduler
        jobs = []
        for job in scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
                "trigger": str(job.trigger),
            })
        return {"running": scheduler.running, "jobs": jobs}

    # ── Monitoring in-memory cache ────────────────────────────────────────────
    def get_monitoring_cache():
        from services.monitoring_scheduler import _last_pinged
        pinged_times = list(_last_pinged.values())
        return {
            "tracked_ips": len(_last_pinged),
            "oldest_ping": min(pinged_times).isoformat() if pinged_times else None,
            "newest_ping": max(pinged_times).isoformat() if pinged_times else None,
            "seconds_since_last_ping": round((now - max(pinged_times)).total_seconds()) if pinged_times else None,
        }

    # ── DB stats ─────────────────────────────────────────────────────────────
    def get_db_stats():
        from models.device import Device
        from models.monitoring import MonitoringResult
        from models.event import Event
        from models.nic import Nic

        devices_total = db.query(func.count(Device.id)).scalar() or 0
        devices_monitored = db.query(func.count(Device.id)).filter(Device.monitoring_enabled.is_(True)).scalar() or 0
        nics_total = db.query(func.count(Nic.id)).scalar() or 0
        results_total = db.query(func.count(MonitoringResult.id)).scalar() or 0
        results_24h = db.query(func.count(MonitoringResult.id)).filter(
            MonitoringResult.timestamp >= since_24h
        ).scalar() or 0
        open_events = db.query(func.count(Event.id)).filter(Event.resolved_at.is_(None)).scalar() or 0
        last_result = db.query(func.max(MonitoringResult.timestamp)).scalar()
        return {
            "devices_total": devices_total,
            "devices_monitored": devices_monitored,
            "nics_total": nics_total,
            "monitoring_results_total": results_total,
            "monitoring_results_24h": results_24h,
            "last_result_at": last_result.isoformat() if last_result else None,
            "seconds_since_last_result": round((now - last_result).total_seconds()) if last_result else None,
            "open_events": open_events,
        }

    # ── System ───────────────────────────────────────────────────────────────
    def get_system():
        try:
            import psutil
            proc = psutil.Process()
            return {
                "cpu_percent_1s": psutil.cpu_percent(interval=1),
                "memory_total_mb": round(psutil.virtual_memory().total / 1024 ** 2),
                "memory_used_mb": round(psutil.virtual_memory().used / 1024 ** 2),
                "memory_percent": psutil.virtual_memory().percent,
                "process_rss_mb": round(proc.memory_info().rss / 1024 ** 2),
                "load_avg": list(psutil.getloadavg()) if hasattr(psutil, "getloadavg") else None,
            }
        except ImportError:
            return {"note": "psutil not installed"}

    return {
        "timestamp": now.isoformat(),
        "python": sys.version,
        "platform": platform.platform(),
        "scheduler": _safe("scheduler", get_scheduler),
        "monitoring_cache": _safe("monitoring_cache", get_monitoring_cache),
        "database": _safe("database", get_db_stats),
        "system": _safe("system", get_system),
    }
