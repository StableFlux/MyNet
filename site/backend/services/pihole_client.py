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
import re
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
    from sqlalchemy.orm import joinedload

    devices = (
        db.query(Device)
        .filter(Device.pihole_enabled.is_(True))
        .options(joinedload(Device.nics))
        .all()
    )
    result = []
    for d in devices:
        # Resolve the API base URL from the selected NIC
        base = None
        if d.pihole_nic_id:
            nic = next((n for n in d.nics if n.id == d.pihole_nic_id), None)
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


async def _pihole_add_dns_entry(client: httpx.AsyncClient, url: str, sid: str | None, ip: str, hostname: str) -> None:
    """Add a custom DNS entry to a Pi-hole instance."""
    from urllib.parse import quote
    entry = f"{ip} {hostname}"
    headers = {"X-FTL-SID": sid} if sid else {}
    await client.put(
        f"{url}/api/config/dns/hosts/{quote(entry, safe='')}",
        headers=headers,
        timeout=10,
    )


async def _pihole_remove_dns_entry(client: httpx.AsyncClient, url: str, sid: str | None, ip: str, hostname: str) -> None:
    """Remove a custom DNS entry from a Pi-hole instance."""
    from urllib.parse import quote
    entry = f"{ip} {hostname}"
    headers = {"X-FTL-SID": sid} if sid else {}
    await client.delete(
        f"{url}/api/config/dns/hosts/{quote(entry, safe='')}",
        headers=headers,
        timeout=10,
    )


async def push_dns_to_piholes(db: Session, hostname: str, ip: str) -> None:
    """Add a DNS entry (ip → hostname) to all configured Pi-hole instances."""
    for _, url, password in _get_pihole_devices(db):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                async with _pihole_session(client, url, password) as sid:
                    await _pihole_add_dns_entry(client, url, sid, ip, hostname)
        except Exception as e:
            log.warning(f"Pi-hole DNS add failed ({url}): {e}")


async def remove_dns_from_piholes(db: Session, hostname: str) -> None:
    """
    Remove all custom DNS entries for the given hostname from all Pi-hole instances.
    Fetches current entries first to find the correct IP(s) to delete.
    """
    for _, url, password in _get_pihole_devices(db):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                async with _pihole_session(client, url, password) as sid:
                    headers = {"X-FTL-SID": sid} if sid else {}
                    r = await client.get(f"{url}/api/config/dns/hosts", headers=headers, timeout=10)
                    data = r.json()
                    hosts = (
                        data.get("config", {}).get("dns", {}).get("hosts")
                        or data.get("hosts")
                        or []
                    )
                    for entry in hosts:
                        parts = entry.strip().split(None, 1)
                        if len(parts) == 2 and parts[1].strip().lower() == hostname.lower():
                            await _pihole_remove_dns_entry(client, url, sid, parts[0], parts[1].strip())
        except Exception as e:
            log.warning(f"Pi-hole DNS remove failed ({url}): {e}")


async def update_dns_on_piholes(db: Session, hostname: str, new_ip: str) -> None:
    """
    Update the IP for a hostname on all Pi-hole instances:
    removes the old entry and adds the new one.
    """
    await remove_dns_from_piholes(db, hostname)
    await push_dns_to_piholes(db, hostname, new_ip)


async def set_mynet_nic_dns_entry(db: Session, nic_id: int, hostname: str) -> bool:
    """Set the dns_entry on a MyNet NIC by NIC id."""
    from models.nic import Nic
    nic = db.get(Nic, nic_id)
    if not nic:
        return False
    nic.dns_entry = hostname
    db.commit()
    return True


async def update_mynet_nic_ip(db: Session, hostname: str, new_ip: str) -> bool:
    """
    Update the ip_address of the MyNet NIC whose dns_entry matches hostname.
    Returns True if a NIC was found and updated.
    """
    from models.nic import Nic
    nic = (
        db.query(Nic)
        .filter(Nic.dns_entry.ilike(hostname))
        .first()
    )
    if not nic:
        return False
    nic.ip_address = new_ip
    db.commit()
    return True


async def fetch_dns_comparison(db: Session) -> list[dict]:
    """
    Fetches custom DNS (A) records from all pihole_enabled devices and cross-references
    them against MyNet NIC dns_entry values.

    Returns a list of rows, one per unique hostname, each containing:
      hostname, mynet_ip, mynet_device_id, mynet_device_name,
      pihole_entries: [{pihole_device_id, pihole_device_name, ip}],
      status: 'match' | 'mynet_only' | 'pihole_only' | 'ip_mismatch' | 'pihole_conflict'
    """
    from models.nic import Nic
    from models.device import Device

    instances = _get_pihole_devices(db)

    # ── Collect custom DNS from every Pi-hole ────────────────────────────────
    # pihole_map: hostname -> list of {pihole_device_id, pihole_device_name, ip}
    pihole_map: dict[str, list[dict]] = {}

    for device_id, url, password in instances:
        device = db.get(Device, device_id)
        device_name = device.name if device else f"Pi-hole {device_id}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                async with _pihole_session(client, url, password) as sid:
                    headers = {"X-FTL-SID": sid} if sid else {}
                    r = await client.get(f"{url}/api/config/dns/hosts", headers=headers, timeout=10)
                    data = r.json()
                    # Response: {"config": {"dns": {"hosts": ["ip hostname", ...]}}}
                    hosts = (
                        data.get("config", {}).get("dns", {}).get("hosts")
                        or data.get("hosts")
                        or []
                    )
                    for entry in hosts:
                        entry = entry.strip()
                        if not entry:
                            continue
                        parts = entry.split(None, 1)
                        if len(parts) != 2:
                            continue
                        ip, hostname = parts[0].strip(), parts[1].strip().lower()
                        pihole_map.setdefault(hostname, []).append({
                            "pihole_device_id": device_id,
                            "pihole_device_name": device_name,
                            "ip": ip,
                        })
        except Exception as e:
            log.warning(f"Pi-hole DNS hosts fetch failed ({url}): {e}")

    # ── Collect MyNet NIC dns_entry values ───────────────────────────────────
    # mynet_map: hostname -> {ip, device_id, device_name}
    mynet_map: dict[str, dict] = {}
    nics = (
        db.query(Nic, Device)
        .join(Device, Nic.device_id == Device.id)
        .filter(Nic.dns_entry.isnot(None), Nic.dns_entry != "")
        .all()
    )
    for nic, device in nics:
        hostname = nic.dns_entry.strip().lower()
        mynet_map[hostname] = {
            "ip": nic.ip_address or "",
            "device_id": device.id,
            "device_name": device.name,
        }

    # ── Build a lookup of MyNet NICs by IP (for pihole_only matching) ─────────
    all_nics = (
        db.query(Nic, Device)
        .join(Device, Nic.device_id == Device.id)
        .filter(Nic.ip_address.isnot(None), Nic.ip_address != "")
        .all()
    )
    nic_by_ip: dict[str, dict] = {}
    for nic, device in all_nics:
        if nic.ip_address and nic.ip_address not in nic_by_ip:
            nic_by_ip[nic.ip_address] = {
                "nic_id": nic.id,
                "device_id": device.id,
                "device_name": device.name,
            }

    # ── Cross-reference ───────────────────────────────────────────────────────
    total_piholes = len(instances)
    all_hostnames = sorted(set(pihole_map) | set(mynet_map))
    rows = []
    for hostname in all_hostnames:
        mynet = mynet_map.get(hostname)
        pihole_entries = pihole_map.get(hostname, [])

        mynet_ip = mynet["ip"] if mynet else None
        pihole_ips = {e["ip"] for e in pihole_entries}

        if mynet and not mynet_ip:
            # MyNet has a dns_entry but the NIC has no IP — can't compare
            status = "no_ip"
        elif not mynet and pihole_entries:
            status = "pihole_only"
        elif mynet and not pihole_entries:
            status = "mynet_only"
        elif len(pihole_ips) > 1:
            # Multiple Pi-holes disagree with each other
            status = "pihole_conflict"
        elif mynet_ip and pihole_ips and mynet_ip not in pihole_ips:
            status = "ip_mismatch"
        elif pihole_entries and len(pihole_entries) < total_piholes:
            # IPs agree but entry is missing from one or more Pi-holes
            status = "partial"
        else:
            status = "match"

        # For pihole_only: check if a MyNet NIC exists with the same IP
        mynet_nic_match = None
        if status == "pihole_only" and pihole_entries:
            pi_ip = pihole_entries[0]["ip"]
            mynet_nic_match = nic_by_ip.get(pi_ip)

        rows.append({
            "hostname": hostname,
            "mynet_ip": mynet_ip,
            "mynet_device_id": mynet["device_id"] if mynet else None,
            "mynet_device_name": mynet["device_name"] if mynet else None,
            "pihole_entries": pihole_entries,
            "status": status,
            # Populated for pihole_only rows where a NIC with the same IP exists in MyNet
            "mynet_nic_id": mynet_nic_match["nic_id"] if mynet_nic_match else None,
            "mynet_nic_device_id": mynet_nic_match["device_id"] if mynet_nic_match else None,
            "mynet_nic_device_name": mynet_nic_match["device_name"] if mynet_nic_match else None,
        })

    return rows


async def apply_domain_to_piholes(db: Session, domain: str) -> int:
    """
    For every custom DNS entry on all Pi-holes that does NOT already end with
    `domain`, rename it by appending the suffix (removes old entry, adds new one).
    Returns the number of entries updated.
    """
    instances = _get_pihole_devices(db)
    count = 0
    for _, url, password in instances:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                async with _pihole_session(client, url, password) as sid:
                    headers = {"X-FTL-SID": sid} if sid else {}
                    r = await client.get(f"{url}/api/config/dns/hosts", headers=headers, timeout=10)
                    hosts = r.json().get("config", {}).get("dns", {}).get("hosts") or []
                    for entry in hosts:
                        parts = entry.strip().split(None, 1)
                        if len(parts) != 2:
                            continue
                        ip, hostname = parts
                        if hostname.endswith(domain):
                            continue
                        new_hostname = hostname + domain
                        await _pihole_remove_dns_entry(client, url, sid, ip, hostname)
                        await _pihole_add_dns_entry(client, url, sid, ip, new_hostname)
                        count += 1
        except Exception:
            pass
    return count


async def apply_domain_to_mynet_nics(db: Session, domain: str) -> int:
    """
    For every NIC in MyNet that has a dns_entry NOT already ending with `domain`,
    append the suffix in-place.
    Returns the number of NICs updated.
    """
    from models.nic import Nic
    nics = db.query(Nic).filter(Nic.dns_entry.isnot(None)).all()
    count = 0
    for nic in nics:
        if nic.dns_entry and not nic.dns_entry.endswith(domain):
            nic.dns_entry = nic.dns_entry + domain
            count += 1
    if count:
        db.commit()
    return count


async def fetch_pihole_network_devices(db: Session) -> dict[str, dict]:
    """
    Fetch known network devices from all configured Pi-hole instances via
    GET /api/network/devices.

    Pi-hole FTL tracks every DNS client by MAC (using its own ARP monitoring),
    so this works regardless of whether Pi-hole is the DHCP server.

    Returns {ip: {mac, hostname, manufacturer}} merged across all instances.
    MAC is normalised to lowercase. Hostname/manufacturer may be None.
    """
    instances = _get_pihole_devices(db)
    if not instances:
        return {}

    result: dict[str, dict] = {}
    for _, url, password in instances:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                async with _pihole_session(client, url, password) as sid:
                    headers = {"X-FTL-SID": sid} if sid else {}
                    r = await client.get(f"{url}/api/network/devices", headers=headers, timeout=10)
                    data = r.json()
                    for device in data.get("devices", []):
                        mac = (device.get("hwaddr") or "").strip().lower()
                        # Pi-hole uses "ip-x.x.x.x" as a synthetic hwaddr when
                        # the real MAC couldn't be resolved — discard these
                        if not re.match(r'^([0-9a-f]{2}:){5}[0-9a-f]{2}$', mac):
                            mac = None
                        manufacturer = (device.get("macVendor") or "").strip() or None
                        for ip_entry in device.get("ips", []):
                            ip = (ip_entry.get("ip") or "").strip()
                            hostname = (ip_entry.get("name") or "").strip() or None
                            if ip:
                                result[ip] = {
                                    "mac": mac,
                                    "hostname": hostname,
                                    "manufacturer": manufacturer,
                                }
        except Exception as e:
            log.warning(f"Pi-hole network devices fetch failed ({url}): {e}")

    return result


async def update_pihole_cache(db: Session):
    """
    Polls all pihole_enabled devices and updates pihole_cache rows.
    Uses a single authenticated session per instance and fires all five
    stat requests concurrently to minimise poll time and HTTP overhead.
    """
    import asyncio as _asyncio
    from models.pihole import PiHoleCache
    from models.nic import Nic

    instances = _get_pihole_devices(db)
    if not instances:
        return

    now = datetime.now(timezone.utc)
    combined: dict[str, dict] = {}
    pihole_device_ids = {device_id for device_id, _, _ in instances}

    for device_id, url, password in instances:
        summary = None
        fetch_error = None
        top_data = None
        top_blocked = None
        blocking = None
        version = None

        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                async with _pihole_session(client, url, password) as sid:
                    headers = {"X-FTL-SID": sid} if sid else {}
                    # Fire all five requests concurrently within one session
                    results = await _asyncio.gather(
                        client.get(f"{url}/api/stats/summary", headers=headers, timeout=10),
                        client.get(f"{url}/api/stats/top_clients", headers=headers, timeout=10),
                        client.get(f"{url}/api/stats/top_domains", headers=headers,
                                   params={"blocked": "true"}, timeout=10),
                        client.get(f"{url}/api/dns/blocking", headers=headers, timeout=10),
                        client.get(f"{url}/api/info/version", headers=headers, timeout=10),
                        return_exceptions=True,
                    )
            summary_r, top_clients_r, top_blocked_r, blocking_r, version_r = results

            if isinstance(summary_r, Exception):
                fetch_error = _classify_error(summary_r)
            else:
                data = summary_r.json()
                if "queries" in data:
                    summary = data
                else:
                    fetch_error = "Unexpected response from Pi-hole API"

            if not isinstance(top_clients_r, Exception):
                top_data = top_clients_r.json()

            if not isinstance(top_blocked_r, Exception):
                entries = top_blocked_r.json().get("domains") or []
                top_blocked = [
                    {"domain": e.get("domain", ""), "count": e.get("count", 0)}
                    for e in entries if e.get("domain")
                ][:20]

            if not isinstance(blocking_r, Exception):
                blocking = blocking_r.json().get("blocking") == "enabled"

            if not isinstance(version_r, Exception):
                version = version_r.json().get("version", {}).get("core", {}).get("local", {}).get("version")

        except Exception as e:
            fetch_error = _classify_error(e)
            log.warning(f"Pi-hole poll failed ({url}): {e}")

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
