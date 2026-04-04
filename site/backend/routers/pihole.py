"""
Pi-hole integration endpoints.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from services.auth import require_viewer, require_admin
from services.pihole_client import get_pihole_summary, test_pihole_connection

router = APIRouter(prefix="/api/pihole", tags=["pihole"])


@router.get("/dashboard")
def pihole_dashboard(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Aggregated Pi-hole data for the dashboard:
    combined stats, top DNS clients (linked to devices), and top blocked domains.
    Returns None values when no Pi-hole data is available yet.
    """
    from models.device import Device
    from models.pihole import PiHoleCache

    pihole_devices = db.query(Device).filter(Device.pihole_enabled.is_(True)).all()
    if not pihole_devices:
        return {"enabled": False}

    # Aggregate stats from all Pi-hole device cache rows
    total_queries = 0
    total_blocked = 0
    domains_on_blocklist = 0
    combined_top_blocked: dict[str, int] = {}
    any_blocking_disabled = False

    for d in pihole_devices:
        cache = db.query(PiHoleCache).filter(PiHoleCache.device_id == d.id).first()
        if not cache:
            continue
        total_queries += cache.queries_today or 0
        total_blocked += cache.blocked_today or 0
        if cache.domains_on_blocklist:
            domains_on_blocklist = max(domains_on_blocklist, cache.domains_on_blocklist)
        if cache.blocking_enabled is False:
            any_blocking_disabled = True
        for entry in (cache.top_blocked or []):
            domain = entry.get("domain", "")
            count = entry.get("count", 0)
            if domain:
                combined_top_blocked[domain] = combined_top_blocked.get(domain, 0) + count

    percent_blocked = round(total_blocked / total_queries * 100, 1) if total_queries > 0 else 0.0

    top_blocked = sorted(
        [{"domain": k, "count": v} for k, v in combined_top_blocked.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:10]

    # Top DNS clients — exclude Pi-hole devices themselves
    client_rows = (
        db.query(PiHoleCache, Device)
        .join(Device, PiHoleCache.device_id == Device.id)
        .filter(Device.pihole_enabled.is_(False))
        .filter(PiHoleCache.queries_today > 0)
        .order_by(PiHoleCache.queries_today.desc())
        .limit(8)
        .all()
    )
    top_clients = [
        {
            "device_id": device.id,
            "device_name": device.name,
            "queries": cache.queries_today or 0,
            "blocked": cache.blocked_today or 0,
        }
        for cache, device in client_rows
    ]

    return {
        "enabled": True,
        "total_queries": total_queries,
        "total_blocked": total_blocked,
        "percent_blocked": percent_blocked,
        "domains_on_blocklist": domains_on_blocklist,
        "any_blocking_disabled": any_blocking_disabled,
        "top_clients": top_clients,
        "top_blocked": top_blocked,
    }


@router.get("/status")
def pihole_status(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Returns configuration status for all pihole_enabled devices —
    name, URL, whether a password is set, and last successful poll time.
    """
    from models.device import Device
    from models.pihole import PiHoleCache

    devices = (
        db.query(Device)
        .filter(Device.pihole_enabled.is_(True))
        .all()
    )
    result = []
    for d in devices:
        cache = db.query(PiHoleCache).filter(PiHoleCache.device_id == d.id).first()
        # Resolve which host will be used for polling
        from models.nic import Nic
        poll_host = None
        if d.pihole_nic_id:
            nic = db.get(Nic, d.pihole_nic_id)
            if nic:
                poll_host = nic.dns_entry or nic.ip_address
        if not poll_host:
            for nic in d.nics:
                if nic.dns_entry:
                    poll_host = nic.dns_entry
                    break
            if not poll_host:
                for nic in d.nics:
                    if nic.ip_address and nic.ip_address != "DHCP":
                        poll_host = nic.ip_address
                        break
        result.append({
            "device_id": d.id,
            "device_name": d.name,
            "url": d.url or "",
            "poll_host": poll_host or "",
            "password_set": bool(d.pihole_password),
            "url_configured": bool(poll_host),
            "reachable": cache.reachable if cache else None,
            "last_error": cache.last_error if cache else None,
            "blocking_enabled": cache.blocking_enabled if cache else None,
            "version": cache.version if cache else None,
            "last_polled": cache.last_polled.strftime('%Y-%m-%dT%H:%M:%SZ') if cache and cache.last_polled else None,
            "queries_today": cache.queries_today if cache else None,
        })
    return result


@router.post("/poll-now")
async def pihole_poll_now(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Trigger an immediate Pi-hole poll outside the scheduler."""
    from services.pihole_client import update_pihole_cache
    await update_pihole_cache(db)
    return {"ok": True}


@router.get("/summary")
async def pihole_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """Aggregate stats from all pihole_enabled devices."""
    return await get_pihole_summary(db)


@router.post("/blocking/{device_id}")
async def pihole_set_blocking(
    device_id: int,
    enabled: bool = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Enable or disable blocking on a specific Pi-hole device. Admin only.
    Updates the cache row immediately so the UI reflects the change.
    """
    from models.device import Device
    from models.pihole import PiHoleCache
    from services.pihole_client import _get_pihole_devices, set_pihole_blocking

    device = db.get(Device, device_id)
    if not device or not device.pihole_enabled:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Pi-hole device not found")

    instances = _get_pihole_devices(db)
    match = next((i for i in instances if i[0] == device_id), None)
    if not match:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No usable NIC address for this Pi-hole device")

    _, url, password = match
    ok = await set_pihole_blocking(url, password, enabled)
    if ok:
        cache = db.query(PiHoleCache).filter(PiHoleCache.device_id == device_id).first()
        if cache:
            cache.blocking_enabled = enabled
            db.commit()
    return {"ok": ok, "blocking_enabled": enabled}


@router.get("/history")
async def pihole_history(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Returns merged over-time history from all pihole_enabled devices.
    Each bucket: {timestamp, total, blocked, cached, forwarded}.
    Buckets are ~10-minute intervals covering the last 24h.
    """
    from services.pihole_client import fetch_pihole_history
    return await fetch_pihole_history(db)


@router.get("/queries/{device_id}")
async def pihole_queries(
    device_id: int,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Returns recent DNS queries seen by Pi-hole for the given device's IP addresses.
    Each entry: {time, domain, status, type, client_ip}.
    """
    from services.pihole_client import fetch_device_queries
    return await fetch_device_queries(db, device_id, limit)


@router.get("/test")
async def pihole_test(
    url: str = Query(...),
    password: str = Query(default=""),
    _: User = Depends(require_admin),
):
    """Test connectivity to a Pi-hole v6 URL. Admin only."""
    return await test_pihole_connection(url, password)
