"""
Pi-hole v6 API client.

Pi-hole instances are regular devices in MyNet with pihole_enabled=True.
The client queries those devices, uses their url and password fields,
so there is no separate Pi-hole configuration needed.

Pi-hole v6 auth flow:
  1. POST /api/auth {"password": "..."}  → session.sid
  2. Use X-FTL-SID header for authenticated requests
  3. DELETE /api/auth to close the session
"""
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


def _get_pihole_devices(db: Session) -> list[tuple[int, str, str]]:
    """
    Return list of (device_id, base_url, plaintext_password) for all devices
    with pihole_enabled=True.

    Base URL is resolved from the selected NIC (pihole_nic_id):
      - dns_entry if set (e.g. pihole01.local)
      - otherwise ip_address
    Falls back to the device's url field only if no NIC is selected.
    The device url field is the admin portal link and is NOT used for API calls.
    """
    from models.device import Device
    from models.nic import Nic
    from services.encryption import decrypt

    devices = (
        db.query(Device)
        .filter(Device.pihole_enabled.is_(True))
        .all()
    )
    result = []
    for d in devices:
        # Resolve the API base URL from the selected NIC
        base = None
        if d.pihole_nic_id:
            nic = db.get(Nic, d.pihole_nic_id)
            if nic:
                host = nic.dns_entry or nic.ip_address
                if host:
                    base = f"http://{host}"
        # Fallback: any NIC with a DNS entry, then any NIC with an IP
        if not base:
            for nic in d.nics:
                if nic.dns_entry:
                    base = f"http://{nic.dns_entry}"
                    break
            if not base:
                for nic in d.nics:
                    if nic.ip_address and nic.ip_address != "DHCP":
                        base = f"http://{nic.ip_address}"
                        break
        if not base:
            log.warning(f"Pi-hole device '{d.name}' (id={d.id}) has no usable NIC address — skipping")
            continue

        password = decrypt(d.pihole_password) if d.pihole_password else ""
        result.append((d.id, base.rstrip("/"), password or ""))
    return result


@asynccontextmanager
async def _pihole_session(client: httpx.AsyncClient, url: str, password: str):
    """
    Authenticates with Pi-hole v6, yields the session ID,
    then always closes the session on exit.

    If Pi-hole has no password set, auth returns no SID — in that case we
    yield None and make unauthenticated requests (Pi-hole allows this when
    no admin password is configured).
    """
    sid = None
    try:
        r = await client.post(
            f"{url}/api/auth",
            json={"password": password},
            timeout=10,
        )
        data = r.json()
        sid = data.get("session", {}).get("sid")
        if not sid:
            message = data.get("session", {}).get("message", "")
            if "no password" in message.lower() or "password not set" in message.lower():
                # Pi-hole has no password — API is accessible without auth
                yield None
                return
            raise ValueError(f"Auth failed: {message or 'no sid returned'}")
        yield sid
    finally:
        if sid:
            try:
                await client.delete(f"{url}/api/auth", headers={"X-FTL-SID": sid}, timeout=5)
            except Exception:
                pass


def _classify_error(e: Exception) -> str:
    """Return a short human-readable error string for a Pi-hole fetch exception."""
    msg = str(e)
    if "Auth failed" in msg or "auth" in msg.lower():
        return "Authentication failed — check password"
    if isinstance(e, httpx.ConnectError):
        return "Connection refused — device may be offline"
    if isinstance(e, httpx.TimeoutException):
        return "Connection timed out — device unreachable"
    if isinstance(e, httpx.ConnectTimeout):
        return "Connection timed out — device unreachable"
    return f"Unreachable — {msg[:80]}"


async def _fetch_summary_v6(url: str, password: str) -> tuple[dict | None, str | None]:
    """Returns (data, error_message). On success error_message is None."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            async with _pihole_session(client, url, password) as sid:
                headers = {"X-FTL-SID": sid} if sid else {}
                r = await client.get(f"{url}/api/stats/summary", headers=headers, timeout=10)
                return r.json(), None
    except Exception as e:
        log.warning(f"Pi-hole summary fetch failed ({url}): {e}")
        return None, _classify_error(e)


async def _fetch_top_blocked_v6(url: str, password: str) -> list[dict] | None:
    """Returns [{domain, count}] for the top blocked domains, or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            async with _pihole_session(client, url, password) as sid:
                headers = {"X-FTL-SID": sid} if sid else {}
                r = await client.get(
                    f"{url}/api/stats/top_domains",
                    headers=headers,
                    params={"blocked": "true"},
                    timeout=10,
                )
                data = r.json()
                entries = data.get("domains") or []
                return [{"domain": e.get("domain", ""), "count": e.get("count", 0)} for e in entries if e.get("domain")]
    except Exception as e:
        log.warning(f"Pi-hole top_blocked fetch failed ({url}): {e}")
        return None


async def _fetch_top_clients_v6(url: str, password: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            async with _pihole_session(client, url, password) as sid:
                headers = {"X-FTL-SID": sid} if sid else {}
                r = await client.get(f"{url}/api/stats/top_clients", headers=headers, timeout=10)
                return r.json()
    except Exception as e:
        log.warning(f"Pi-hole top_clients fetch failed ({url}): {e}")
        return None


async def _fetch_blocking_status(url: str, password: str) -> bool | None:
    """Returns True if blocking enabled, False if disabled, None on failure."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            async with _pihole_session(client, url, password) as sid:
                headers = {"X-FTL-SID": sid} if sid else {}
                r = await client.get(f"{url}/api/dns/blocking", headers=headers, timeout=10)
                return r.json().get("blocking") == "enabled"
    except Exception as e:
        log.warning(f"Pi-hole blocking status fetch failed ({url}): {e}")
        return None


async def _fetch_version(url: str, password: str) -> str | None:
    """Returns core version string e.g. 'v6.4', or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            async with _pihole_session(client, url, password) as sid:
                headers = {"X-FTL-SID": sid} if sid else {}
                r = await client.get(f"{url}/api/info/version", headers=headers, timeout=10)
                return r.json().get("version", {}).get("core", {}).get("local", {}).get("version")
    except Exception as e:
        log.warning(f"Pi-hole version fetch failed ({url}): {e}")
        return None


async def set_pihole_blocking(url: str, password: str, enabled: bool) -> bool:
    """
    Enable or disable Pi-hole blocking. Returns True on success.
    Uses POST /api/dns/blocking with {blocking: 'enabled'|'disabled'}.
    """
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            async with _pihole_session(client, url, password) as sid:
                headers = {"X-FTL-SID": sid} if sid else {}
                r = await client.post(
                    f"{url}/api/dns/blocking",
                    headers=headers,
                    json={"blocking": "enabled" if enabled else "disabled"},
                    timeout=10,
                )
                return r.status_code == 200
    except Exception as e:
        log.warning(f"Pi-hole set blocking failed ({url}): {e}")
        return False


async def get_pihole_summary(db: Session) -> list[dict]:
    """
    Returns a summary dict per Pi-hole device with aggregate stats.
    Used by GET /api/pihole/summary.
    """
    instances = _get_pihole_devices(db)
    if not instances:
        return []

    results = []
    for device_id, url, password in instances:
        data, err = await _fetch_summary_v6(url, password)
        if data and "queries" in data:
            q = data["queries"]
            results.append({
                "device_id": device_id,
                "url": url,
                "queries_today": q.get("total", 0),
                "blocked_today": q.get("blocked", 0),
                "percent_blocked": round(float(q.get("percent_blocked", 0)), 1),
                "domains_on_blocklist": data.get("gravity", {}).get("domains_being_blocked", 0),
                "unique_clients": data.get("clients", {}).get("active", 0),
            })
        else:
            results.append({"device_id": device_id, "url": url, "error": err or "Unreachable or auth failed"})
    return results


async def test_pihole_connection(url: str, password: str) -> dict:
    """Test connection to a Pi-hole v6 instance. Used by the Settings test button."""
    url = url.rstrip("/")
    data, err = await _fetch_summary_v6(url, password)
    if data and "queries" in data:
        return {
            "ok": True,
            "queries_today": data["queries"].get("total", 0),
            "status": "enabled",
        }
    return {"ok": False, "error": err or "Could not connect, auth failed, or unexpected response"}


async def fetch_pihole_history(db: Session) -> list[dict]:
    """
    Fetches /api/history from all pihole_enabled devices and merges buckets by timestamp.
    Returns [{timestamp, total, blocked, cached, forwarded}] sorted by timestamp asc.
    """
    instances = _get_pihole_devices(db)
    if not instances:
        return []

    merged: dict[int, dict] = {}
    for _, url, password in instances:
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                async with _pihole_session(client, url, password) as sid:
                    headers = {"X-FTL-SID": sid} if sid else {}
                    r = await client.get(f"{url}/api/history", headers=headers, timeout=10)
                    data = r.json()
                    for bucket in data.get("history", []):
                        ts = bucket.get("timestamp")
                        if ts is None:
                            continue
                        if ts not in merged:
                            merged[ts] = {"timestamp": ts, "total": 0, "blocked": 0, "cached": 0, "forwarded": 0}
                        merged[ts]["total"] += bucket.get("total", 0)
                        merged[ts]["blocked"] += bucket.get("blocked", 0)
                        merged[ts]["cached"] += bucket.get("cached", 0)
                        merged[ts]["forwarded"] += bucket.get("forwarded", 0)
        except Exception as e:
            log.warning(f"Pi-hole history fetch failed ({url}): {e}")

    return sorted(merged.values(), key=lambda x: x["timestamp"])


async def fetch_device_queries(db: Session, device_id: int, limit: int = 50) -> list[dict]:
    """
    Fetches recent DNS queries from all pihole_enabled devices for the given device's IPs.
    Returns [{time, domain, status, type, client_ip}] sorted by time desc.
    """
    from models.nic import Nic

    nics = db.query(Nic).filter(Nic.device_id == device_id).all()
    device_ips = {n.ip_address for n in nics if n.ip_address and n.ip_address != "DHCP"}
    if not device_ips:
        return []

    instances = _get_pihole_devices(db)
    if not instances:
        return []

    results: list[dict] = []
    for _, url, password in instances:
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                async with _pihole_session(client, url, password) as sid:
                    headers = {"X-FTL-SID": sid} if sid else {}
                    # Fetch a larger batch and filter client-side by IP
                    r = await client.get(
                        f"{url}/api/queries",
                        headers=headers,
                        params={"max": limit * 10},
                        timeout=10,
                    )
                    data = r.json()
                    for q in data.get("queries", []):
                        client_ip = q.get("client", {}).get("ip", "")
                        if client_ip not in device_ips:
                            continue
                        results.append({
                            "time": q.get("time"),
                            "domain": q.get("domain", ""),
                            "status": q.get("status", ""),
                            "type": q.get("type", ""),
                            "client_ip": client_ip,
                        })
        except Exception as e:
            log.warning(f"Pi-hole queries fetch failed ({url}): {e}")

    results.sort(key=lambda x: x["time"] or 0, reverse=True)
    return results[:limit]


async def update_pihole_cache(db: Session):
    """
    Polls all pihole_enabled devices and updates pihole_cache rows.
    Updates the Pi-hole device's own cache row (for Settings last_polled display)
    and matches Pi-hole client IPs to device NICs.
    """
    from models.pihole import PiHoleCache
    from models.nic import Nic

    instances = _get_pihole_devices(db)
    if not instances:
        return

    now = datetime.now(timezone.utc)
    combined: dict[str, dict] = {}
    pihole_device_ids = {device_id for device_id, _, _ in instances}

    for device_id, url, password in instances:
        summary, fetch_error = await _fetch_summary_v6(url, password)
        top_data = await _fetch_top_clients_v6(url, password)
        top_blocked = await _fetch_top_blocked_v6(url, password)
        blocking = await _fetch_blocking_status(url, password)
        version = await _fetch_version(url, password)

        # Update the Pi-hole device's own cache row
        pihole_cache = db.query(PiHoleCache).filter(PiHoleCache.device_id == device_id).first()
        if not pihole_cache:
            pihole_cache = PiHoleCache(device_id=device_id)
            db.add(pihole_cache)

        if summary and "queries" in summary:
            pihole_cache.reachable = True
            pihole_cache.last_error = None
            pihole_cache.last_polled = now
            pihole_cache.queries_today = summary["queries"].get("total", 0)
            pihole_cache.blocked_today = summary["queries"].get("blocked", 0)
            pihole_cache.domains_on_blocklist = summary.get("gravity", {}).get("domains_being_blocked")
            if blocking is not None:
                pihole_cache.blocking_enabled = blocking
            if version:
                pihole_cache.version = version
            log.info(f"Pi-hole device_id={device_id} queries_today={pihole_cache.queries_today}")
        else:
            pihole_cache.reachable = False
            pihole_cache.last_error = fetch_error or "Unexpected response from Pi-hole API"
            log.warning(f"Pi-hole device_id={device_id} error: {pihole_cache.last_error}")

        if top_blocked is not None:
            pihole_cache.top_blocked = top_blocked[:20]

        if not top_data:
            continue
        for entry in top_data.get("clients", []):
            ip = entry.get("ip", "")
            if not ip:
                continue
            count = entry.get("count", 0)
            combined[ip] = combined.get(ip, {"queries": 0, "blocked": 0})
            combined[ip]["queries"] += count

    for ip, stats in combined.items():
        nic = db.query(Nic).filter(Nic.ip_address == ip).first()
        if not nic:
            continue
        # Don't overwrite the Pi-hole device's own cache row (already updated with totals above)
        if nic.device_id in pihole_device_ids:
            continue
        cache = db.query(PiHoleCache).filter(PiHoleCache.device_id == nic.device_id).first()
        if not cache:
            cache = PiHoleCache(device_id=nic.device_id, mac=nic.mac)
            db.add(cache)
        cache.queries_today = stats["queries"]
        cache.blocked_today = stats.get("blocked", 0)
        cache.last_seen = now
        cache.last_polled = now

    db.commit()
