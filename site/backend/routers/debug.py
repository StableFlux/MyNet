"""
Debug diagnostics endpoint — /api/debug
Each section is wrapped in _safe() so a single failure returns partial results
plus a traceback rather than a bare 500.
"""
import sys
import traceback
import platform
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from database import get_db
from services.auth import require_viewer
from models.user import User

router = APIRouter(prefix="/api/debug", tags=["debug"])


def _safe(label: str, fn):
    try:
        return fn()
    except Exception:
        return {"_error": label, "_traceback": traceback.format_exc()}


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

    # ── Monitoring in-memory ping cache ──────────────────────────────────────
    def get_monitoring_cache():
        from services.monitoring_scheduler import _last_pinged
        times = list(_last_pinged.values())
        return {
            "tracked_ips": len(_last_pinged),
            "oldest_ping": min(times).isoformat() if times else None,
            "newest_ping": max(times).isoformat() if times else None,
            "seconds_since_last_ping": round((now - max(times)).total_seconds()) if times else None,
        }

    # ── DB stats ─────────────────────────────────────────────────────────────
    def get_db_stats():
        from models.device import Device
        from models.monitoring import MonitoringResult
        from models.event import Event
        from models.nic import Nic

        last_result = db.query(func.max(MonitoringResult.timestamp)).scalar()
        # SQLite returns naive datetimes; make aware before subtracting from now (UTC-aware)
        if last_result is not None and last_result.tzinfo is None:
            last_result = last_result.replace(tzinfo=timezone.utc)
        return {
            "devices_total": db.query(func.count(Device.id)).scalar() or 0,
            "devices_monitored": db.query(func.count(Device.id)).filter(Device.monitoring_enabled.is_(True)).scalar() or 0,
            "nics_total": db.query(func.count(Nic.id)).scalar() or 0,
            "monitoring_results_total": db.query(func.count(MonitoringResult.id)).scalar() or 0,
            "monitoring_results_24h": db.query(func.count(MonitoringResult.id)).filter(MonitoringResult.timestamp >= since_24h).scalar() or 0,
            "open_events": db.query(func.count(Event.id)).filter(Event.resolved_at.is_(None)).scalar() or 0,
            "last_result_at": last_result.isoformat() if last_result else None,
            "seconds_since_last_result": round((now - last_result).total_seconds()) if last_result else None,
        }

    # ── SQLite health ─────────────────────────────────────────────────────────
    def get_sqlite():
        rows = {}
        for pragma in ("journal_mode", "wal_autocheckpoint", "page_count",
                       "page_size", "freelist_count", "cache_size"):
            try:
                rows[pragma] = db.execute(text(f"PRAGMA {pragma}")).scalar()
            except Exception as e:
                rows[pragma] = f"error: {e}"
        try:
            wal = db.execute(text("PRAGMA wal_checkpoint(PASSIVE)")).fetchone()
            rows["wal_checkpoint"] = {"total": wal[1], "checkpointed": wal[2]} if wal else None
        except Exception as e:
            rows["wal_checkpoint"] = f"error: {e}"
        size_bytes = rows.get("page_count", 0) * rows.get("page_size", 4096)
        rows["estimated_size_mb"] = round(size_bytes / 1024 / 1024, 2) if isinstance(size_bytes, int) else None
        return rows

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
                "open_fds": proc.num_fds() if hasattr(proc, "num_fds") else None,
                "threads": proc.num_threads(),
            }
        except ImportError:
            return {"note": "psutil not installed — pip install psutil for system metrics"}

    # ── Recent backend logs (WARNING+) ────────────────────────────────────────
    def get_logs():
        from services.log_buffer import get_recent
        return get_recent(60)

    return {
        "timestamp": now.isoformat(),
        "python": sys.version,
        "platform": platform.platform(),
        "scheduler": _safe("scheduler", get_scheduler),
        "monitoring_cache": _safe("monitoring_cache", get_monitoring_cache),
        "database": _safe("database", get_db_stats),
        "sqlite": _safe("sqlite", get_sqlite),
        "system": _safe("system", get_system),
        "recent_logs": _safe("recent_logs", get_logs),
    }
