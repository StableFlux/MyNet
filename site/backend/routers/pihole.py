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
    from sqlalchemy.orm import joinedload

    pihole_devices = (
        db.query(Device)
        .filter(Device.pihole_enabled.is_(True))
        .options(joinedload(Device.pihole_cache))
        .all()
    )
    if not pihole_devices:
        return {"enabled": False}

    # Aggregate stats from all Pi-hole device cache rows
    total_queries = 0
    total_blocked = 0
    domains_on_blocklist = 0
    combined_top_blocked: dict[str, int] = {}
    any_blocking_disabled = False

    for d in pihole_devices:
        cache = d.pihole_cache
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
    from models.nic import Nic
    from sqlalchemy.orm import joinedload

    devices = (
        db.query(Device)
        .filter(Device.pihole_enabled.is_(True))
        .options(
            joinedload(Device.pihole_cache),
            joinedload(Device.nics),
        )
        .all()
    )
    result = []
    for d in devices:
        cache = d.pihole_cache
        # Resolve which host will be used for polling
        poll_host = None
        if d.pihole_nic_id:
            nic = next((n for n in d.nics if n.id == d.pihole_nic_id), None)
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


@router.post("/dns/push-to-pihole")
async def dns_push_to_pihole(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Add a MyNet DNS entry (ip + hostname) to all configured Pi-holes."""
    from services.pihole_client import push_dns_to_piholes
    await push_dns_to_piholes(db, body["hostname"], body["ip"])
    return {"ok": True}


@router.post("/dns/update-pihole-ip")
async def dns_update_pihole_ip(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update the IP for a hostname on all Pi-holes (removes old entry, adds new)."""
    from services.pihole_client import update_dns_on_piholes
    await update_dns_on_piholes(db, body["hostname"], body["ip"])
    return {"ok": True}


@router.delete("/dns/remove-from-pihole")
async def dns_remove_from_pihole(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Remove all entries for a hostname from all Pi-holes."""
    from services.pihole_client import remove_dns_from_piholes
    await remove_dns_from_piholes(db, body["hostname"])
    return {"ok": True}


@router.post("/dns/set-mynet-dns")
async def dns_set_mynet_dns(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Set the dns_entry on a MyNet NIC to match a Pi-hole hostname."""
    from services.pihole_client import set_mynet_nic_dns_entry
    found = await set_mynet_nic_dns_entry(db, body["nic_id"], body["hostname"])
    if not found:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="NIC not found")
    return {"ok": True}


@router.post("/dns/update-mynet-ip")
async def dns_update_mynet_ip(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update the MyNet NIC ip_address for the given hostname to match Pi-hole."""
    from services.pihole_client import update_mynet_nic_ip
    found = await update_mynet_nic_ip(db, body["hostname"], body["ip"])
    if not found:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No MyNet NIC found with that dns_entry")
    return {"ok": True}


@router.get("/dns-comparison")
async def pihole_dns_comparison(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """
    Fetches custom DNS A records from all configured Pi-hole instances and
    cross-references them against MyNet NIC dns_entry values.
    Read-only — no data is written to Pi-hole or MyNet devices.
    """
    from services.pihole_client import fetch_dns_comparison
    return await fetch_dns_comparison(db)


@router.post("/dns/apply-domain-to-piholes")
async def dns_apply_domain_to_piholes(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Append dns_domain suffix to all Pi-hole custom DNS entries that lack it."""
    from services.pihole_client import apply_domain_to_piholes
    domain = (body.get("domain") or "").strip()
    if not domain:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="domain is required")
    count = await apply_domain_to_piholes(db, domain)
    return {"ok": True, "updated": count}


@router.post("/dns/apply-domain-to-mynet")
async def dns_apply_domain_to_mynet(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Append dns_domain suffix to all MyNet NIC dns_entries that lack it."""
    from services.pihole_client import apply_domain_to_mynet_nics
    domain = (body.get("domain") or "").strip()
    if not domain:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="domain is required")
    count = await apply_domain_to_mynet_nics(db, domain)
    return {"ok": True, "updated": count}


@router.get("/test")
async def pihole_test(
    url: str = Query(...),
    password: str = Query(default=""),
    _: User = Depends(require_admin),
):
    """Test connectivity to a Pi-hole v6 URL. Admin only."""
    return await test_pihole_connection(url, password)
