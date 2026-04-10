"""
UniFi Network Application client.

Supports two authentication methods:
  api_key     — X-API-KEY header against the Integration API
                (/proxy/network/integration/v1/).
                Requires UniFi Network Application 8.1+ / UniFi OS 3.x+.
                Limitation: only returns currently-connected clients.

  credentials — Session cookie auth (username + password) against the
                legacy Network API (/proxy/network/api/s/{site}/...).
                Works on all UniFi OS versions. Returns full client history
                via /stat/alluser (typically 30-90 days of data).
                Recommended: create a dedicated MyNet user rather than using
                admin credentials. Role determines what MyNet can do.

Write capability depends on the UniFi role assigned to the configured user.
SSL verification is always disabled (self-signed certs are standard locally).

Architecture
------------
All data transformation uses shared pure mapping functions (_map_client,
_map_network, _map_infra_device) so that credentials and API key paths
produce identical output shapes.

For the comparison endpoint, fetch_all_for_comparison() opens a single
authenticated session (credentials) or runs concurrent requests (API key)
to avoid the 429 rate-limit that multiple sequential logins would trigger.
"""
import asyncio
import ipaddress as _ip
import logging
import time
from contextlib import asynccontextmanager

import httpx
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

_INTEGRATION_BASE = "/proxy/network/integration/v1"
_LEGACY_BASE      = "/proxy/network/api/s/default"
_DEFAULT_SITE     = "default"
_TIMEOUT          = 15   # seconds — all data requests
_RESOLVE_TIMEOUT  = 10   # seconds — site UUID resolution and connection tests

# Network purposes that represent real LAN/VLAN segments.
# Excludes: vpn-client, wan, site-vpn, loopback, etc.
_NETWORK_PURPOSES = {"corporate", "guest", "vlan-only", "bridge"}

# Session cache — keyed by (url, username).
# Stores (cookies_dict, csrf_token, expires_at) so multiple operations within
# a short window (comparison + sequential deletes) share a single login and
# avoid UniFi's /api/auth/login rate limit (429).
_credentials_cache: dict[tuple[str, str], tuple[dict, str, float]] = {}
_CREDENTIALS_TTL = 600  # seconds — reuse session for up to 10 minutes


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_url(host: str) -> str:
    """Always HTTPS; strip any accidental scheme the user may have typed."""
    host = host.strip().rstrip("/")
    host = host.removeprefix("https://").removeprefix("http://")
    return f"https://{host}"


def _get_unifi_config(db: Session) -> dict | None:
    """
    Return UniFi connection config from SystemSettings, or None if not configured.
    Always returns a dict with keys: url, auth_type, and auth-specific credentials.
    """
    from models.system_settings import SystemSettings
    from services.encryption import decrypt

    s = db.query(SystemSettings).first()
    if not s or not s.unifi_host:
        return None

    auth_type = getattr(s, "unifi_auth_type", None) or "api_key"

    if auth_type == "credentials":
        username = s.unifi_username or ""
        password = decrypt(s.unifi_password) if s.unifi_password else ""
        if not username or not password:
            return None
        return {"url": _build_url(s.unifi_host), "auth_type": "credentials",
                "username": username, "password": password}
    else:
        if not s.unifi_api_key:
            return None
        return {"url": _build_url(s.unifi_host), "auth_type": "api_key",
                "api_key": decrypt(s.unifi_api_key) or ""}


def _classify_error(e: Exception) -> str:
    """Translate common httpx exceptions into user-readable messages."""
    if isinstance(e, httpx.ConnectError):
        return "Connection refused — check the controller URL"
    if isinstance(e, (httpx.TimeoutException, httpx.ConnectTimeout)):
        return "Connection timed out — controller unreachable"
    if isinstance(e, httpx.SSLError):
        return "SSL error — disable SSL verification for self-signed certs"
    return f"Unreachable — {str(e)[:120]}"


@asynccontextmanager
async def _credentials_session(url: str, username: str, password: str):
    """
    Async context manager: yield an authenticated httpx client.

    Session cookies and CSRF token are cached for up to _CREDENTIALS_TTL seconds
    so that a comparison fetch followed by multiple deletes shares a single login,
    avoiding UniFi's rate limit on /api/auth/login (HTTP 429).

    If the cached session is rejected (401/403 on first use), the cache is cleared
    and a PermissionError is raised — the next call will re-authenticate.
    Raises PermissionError on bad credentials; httpx errors on network issues.
    """
    cache_key = (url, username)
    cached = _credentials_cache.get(cache_key)

    client = httpx.AsyncClient(verify=False, follow_redirects=True, timeout=_TIMEOUT)
    try:
        if cached and time.time() < cached[2]:
            # Restore cached cookies and CSRF token — no login request needed
            cookies, csrf, _ = cached
            for name, value in cookies.items():
                client.cookies.set(name, value)
            if csrf:
                client.headers.update({"x-csrf-token": csrf})
            log.debug("UniFi credentials session: reusing cached session")
        else:
            # Fresh login
            _credentials_cache.pop(cache_key, None)
            r = await client.post(
                f"{url}/api/auth/login",
                json={"username": username, "password": password},
            )
            if r.status_code in (401, 403):
                raise PermissionError("Invalid username or password")
            if r.status_code == 429:
                raise Exception(
                    "UniFi is rate-limiting login attempts — wait a moment and try again"
                )
            r.raise_for_status()
            csrf = r.headers.get("x-csrf-token", "")
            if csrf:
                client.headers.update({"x-csrf-token": csrf})
            # Cache for reuse by subsequent calls within the TTL window
            _credentials_cache[cache_key] = (
                dict(client.cookies), csrf, time.time() + _CREDENTIALS_TTL
            )
            log.debug("UniFi credentials session: new login, session cached")

        yield client

    except Exception:
        # Any error (auth failure, network, unexpected) invalidates the cache
        # so the next caller gets a clean re-authentication attempt.
        _credentials_cache.pop(cache_key, None)
        raise
    finally:
        try:
            await client.aclose()
        except Exception:
            pass  # connection may already be closed by the server; safe to ignore


async def _resolve_site_uuid(url: str, api_key: str) -> str:
    """
    Resolve the UUID for the default site via the Integration API.
    Falls back to the string 'default' if resolution fails.
    """
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True,
                                     timeout=_RESOLVE_TIMEOUT) as client:
            r = await client.get(f"{url}{_INTEGRATION_BASE}/sites", headers=headers)
            if r.status_code == 200:
                for site in r.json().get("data", []):
                    if site.get("internalReference") == _DEFAULT_SITE:
                        return site["id"]
    except Exception as e:
        log.warning(f"UniFi site UUID resolution failed: {e}")
    return _DEFAULT_SITE


# ── Pure mapping functions (auth-agnostic) ────────────────────────────────────

def _map_client(c: dict, source: str) -> dict:
    """
    Map a raw UniFi client record (from any API) to a normalised dict.
    Source indicates the originating endpoint for debugging.
    """
    # Prefer fixed_ip when the device has a DHCP reservation but no current lease
    ip = c.get("ip") or None
    if not ip and c.get("use_fixedip") and c.get("fixed_ip"):
        ip = c["fixed_ip"]
    elif not ip:
        ip = c.get("fixed_ip") or None

    local_dns = c.get("local_dns_record") or None
    if local_dns and not c.get("local_dns_record_enabled", True):
        local_dns = None  # configured but disabled — treat as absent

    return {
        "ip":          ip,
        "mac":         (c.get("mac") or "").lower() or None,
        "name":        c.get("name") or None,       # user-set alias in UniFi console
        "hostname":    c.get("hostname") or None,   # DHCP-reported device hostname
        "local_dns":   local_dns,                   # UniFi Local DNS Record (per-client)
        "is_wireless": not bool(c.get("is_wired", False)),
        "ssid":        c.get("essid") or None,
        "uplink_mac":  (c.get("ap_mac") or "").lower() or None,
        "uplink_port": c.get("sw_port") or None,
        "signal_dbm":  c.get("rssi") or None,
        "first_seen":  c.get("first_seen") or None,   # Unix timestamp
        "last_seen":   c.get("last_seen") or None,    # Unix timestamp
        "is_guest":    bool(c.get("is_guest_by_policy", False)),
        "is_infrastructure": False,
        "_source":     source,
    }


def _map_client_integration(c: dict) -> dict:
    """Map a raw UniFi Integration API client record to a normalised dict."""
    return {
        "ip":          c.get("ipAddress") or None,
        "mac":         (c.get("macAddress") or "").lower() or None,
        "name":        c.get("name") or None,
        "hostname":    c.get("displayName") or c.get("hostname") or None,
        "local_dns":   c.get("localDnsRecord") or None,
        "is_wireless": c.get("type") == "WIRELESS",
        "ssid":        None,
        "uplink_mac":  None,
        "uplink_port": None,
        "signal_dbm":  None,
        "first_seen":  c.get("connectedAt") or None,
        "last_seen":   c.get("connectedAt") or None,
        "is_guest":    c.get("access", {}).get("type") == "GUEST",
        "is_infrastructure": False,
        "_source":     "integration",
    }


def _merge_client_sources(
    raw_alluser: list[dict],
    raw_user: list[dict],
    raw_sta: list[dict] | None = None,
) -> list[dict]:
    """
    Merge stat/alluser (primary) with rest/user (supplementary).
    alluser entries take precedence; rest/user fills in MACs not present in alluser.

    If raw_sta (stat/sta — currently connected clients) is provided, its hostname
    and IP values overwrite the alluser values for matching MACs.  stat/sta has the
    live DHCP hostname whereas alluser records the hostname from first connection and
    does not update when the device later changes its hostname.
    """
    result: list[dict] = []
    seen_macs: set[str] = set()

    for c in raw_alluser:
        entry = _map_client(c, "alluser")
        if entry["mac"]:
            seen_macs.add(entry["mac"])
        result.append(entry)

    for c in raw_user:
        mac = (c.get("mac") or "").lower()
        if not mac or mac in seen_macs:
            continue
        entry = _map_client(c, "rest/user")
        seen_macs.add(mac)
        result.append(entry)

    # Overlay live data from stat/sta for currently-connected clients.
    # stat/sta has the current DHCP hostname; alluser freezes it at first-seen.
    if raw_sta:
        sta_by_mac: dict[str, dict] = {}
        for c in raw_sta:
            mac = (c.get("mac") or "").lower()
            if mac:
                sta_by_mac[mac] = c

        for entry in result:
            mac = entry.get("mac") or ""
            live = sta_by_mac.get(mac)
            if not live:
                continue
            live_hostname = live.get("hostname") or None
            live_ip = live.get("ip") or None
            if live_hostname:
                entry["hostname"] = live_hostname
            if live_ip:
                entry["ip"] = live_ip

    return result


def _map_network(n: dict) -> dict | None:
    """
    Map a raw UniFi legacy networkconf record to a normalised dict.
    Returns None if the network purpose should be excluded.
    """
    if n.get("purpose") not in _NETWORK_PURPOSES:
        return None

    ip_subnet = n.get("ip_subnet") or ""
    cidr = gateway = None
    if ip_subnet:
        try:
            iface = _ip.IPv4Interface(ip_subnet)
            cidr    = str(iface.network)
            gateway = str(iface.ip)
        except Exception:
            pass

    # Untagged corporate network (vlan_enabled=False) is native VLAN 1
    vlan_id = n.get("vlan") if n.get("vlan_enabled") else 1

    dns_servers = [
        v for k in ("dhcpd_dns_1", "dhcpd_dns_2", "dhcpd_dns_3")
        if (v := n.get(k))
    ]

    return {
        "id":          n.get("_id", ""),
        "vlan_id":     vlan_id,
        "name":        n.get("name") or "",
        "enabled":     n.get("enabled", True),
        "cidr":        cidr,
        "gateway":     gateway,
        "dhcp_start":  n.get("dhcpd_start"),
        "dhcp_end":    n.get("dhcpd_stop"),
        "dns_servers": dns_servers,
    }


def _first_private_from_table(entries: list) -> str | None:
    """
    Scan a list of interface/network dicts for the first private IP address.
    Checks common field names: ip, addr, ip_addr.
    """
    for entry in (entries or []):
        for field in ("ip", "addr", "ip_addr"):
            raw = entry.get(field) or ""
            ip = raw.split("/")[0].strip()
            if ip:
                try:
                    if _ip.ip_address(ip).is_private:
                        return ip
                except ValueError:
                    pass
    return None


def _prefer_private_ip(*candidates: str | None) -> str | None:
    """
    Return the first private (RFC-1918) IP from the candidates.
    Falls back to the first non-None value if none are private.
    Used so that gateway/UDM devices report their LAN IP rather than
    their WAN IP when both are present in the device record.
    """
    valid = [c for c in candidates if c]
    for ip in valid:
        try:
            if _ip.ip_address(ip).is_private:
                return ip
        except ValueError:
            pass
    return valid[0] if valid else None


def _map_infra_device(d: dict, auth_type: str) -> dict:
    """
    Map a raw UniFi infrastructure device record to a normalised dict.
    Field names differ between legacy API (mac, ip, state) and
    Integration API (macAddress, ipAddress, isAdopted).

    For gateway devices (UDM, USG) the top-level `ip` field can be the WAN
    address.  `config_network.ip` holds the static LAN management IP, so we
    prefer whichever candidate is a private address.
    """
    if auth_type == "credentials":
        resolved_ip = _prefer_private_ip(
            d.get("config_network", {}).get("ip"),
            _first_private_from_table(d.get("network_table")),
            d.get("ip"),
        )
        if resolved_ip and not _ip.ip_address(resolved_ip).is_private:
            log.debug(
                f"UniFi infra device {d.get('name')} ({d.get('mac')}): "
                f"could not find private IP — using {resolved_ip}. "
                f"Available keys: {list(d.keys())}"
            )
        return {
            "mac":        (d.get("mac") or "").lower() or None,
            "model":      d.get("model") or None,
            "name":       d.get("name") or None,
            "ip":         resolved_ip,
            "type":       d.get("type") or None,
            "version":    d.get("version") or None,
            "uptime":     d.get("uptime") or None,
            "is_adopted": d.get("state") == 1,
        }
    else:
        resolved_ip = _prefer_private_ip(
            d.get("configNetwork", {}).get("ip"),
            _first_private_from_table(d.get("networkTable")),
            d.get("ipAddress"),
        )
        return {
            "mac":        (d.get("macAddress") or "").lower() or None,
            "model":      d.get("model") or None,
            "name":       d.get("name") or None,
            "ip":         resolved_ip,
            "type":       d.get("type") or None,
            "version":    d.get("version") or None,
            "uptime":     d.get("uptime") or None,
            "is_adopted": bool(d.get("isAdopted")),
        }


# ── Connection tests ──────────────────────────────────────────────────────────

async def test_unifi_connection(url: str, api_key: str) -> dict:
    """
    Test connection using the UniFi Integration API.
    Returns {ok, site_name, client_count} or {ok: False, error}.
    """
    url = url.rstrip("/")
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True,
                                     timeout=_RESOLVE_TIMEOUT) as client:
            r = await client.get(f"{url}{_INTEGRATION_BASE}/sites", headers=headers)
            if r.status_code == 401:
                return {"ok": False, "error": "Invalid API key — check the key in the UniFi console"}
            if r.status_code == 403:
                return {"ok": False, "error": "API key is valid but lacks permission to list sites"}
            if r.status_code == 404:
                return {"ok": False, "error": (
                    "Integration API not found at this URL. "
                    "Requires UniFi Network Application 8.1+ / UniFi OS 3.x+."
                )}
            r.raise_for_status()

            sites = r.json().get("data", [])
            site = next(
                (s for s in sites if s.get("internalReference") == _DEFAULT_SITE),
                sites[0] if sites else None,
            )
            if not site:
                return {"ok": False, "error": "No sites found — check API key permissions"}

            rc = await client.get(
                f"{url}{_INTEGRATION_BASE}/sites/{site['id']}/clients",
                headers=headers, params={"limit": 1},
            )
            client_count = rc.json().get("totalCount") if rc.status_code == 200 else None

            return {"ok": True, "site_name": site.get("name", _DEFAULT_SITE),
                    "client_count": client_count}

    except httpx.HTTPStatusError as e:
        return {"ok": False, "error": f"HTTP {e.response.status_code} from controller"}
    except Exception as e:
        log.warning(f"UniFi connection test failed ({url}): {e}")
        return {"ok": False, "error": _classify_error(e)}


async def test_unifi_connection_credentials(url: str, username: str, password: str) -> dict:
    """
    Test connection using username/password session cookie auth.
    Returns {ok, site_name, client_count} or {ok: False, error}.
    """
    url = url.rstrip("/")
    try:
        async with _credentials_session(url, username, password) as client:
            r = await client.get(f"{url}{_LEGACY_BASE}/stat/sta")
            client_count = len(r.json().get("data", [])) if r.status_code == 200 else None

            site_name = _DEFAULT_SITE
            ri = await client.get(f"{url}{_LEGACY_BASE}/stat/sysinfo")
            if ri.status_code == 200:
                data = ri.json().get("data", [])
                if data:
                    site_name = data[0].get("name", _DEFAULT_SITE)

            return {"ok": True, "site_name": site_name, "client_count": client_count}

    except PermissionError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        log.warning(f"UniFi credentials test failed ({url}): {e}")
        return {"ok": False, "error": _classify_error(e)}


# ── Individual fetch functions (used outside comparison) ─────────────────────

async def fetch_unifi_clients(db: Session) -> list[dict]:
    """
    Fetch clients from UniFi. Used by endpoints outside the comparison flow.
    Credentials: merges stat/alluser + rest/user in a single session.
    API key: paginated Integration API (currently-connected only).
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        return []
    if cfg["auth_type"] == "credentials":
        return await _fetch_clients_credentials(cfg)
    return await _fetch_clients_api_key(cfg)


async def _fetch_clients_credentials(cfg: dict) -> list[dict]:
    url = cfg["url"]
    try:
        async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
            r_all  = await client.get(f"{url}{_LEGACY_BASE}/stat/alluser")
            r_all.raise_for_status()
            r_user = await client.get(f"{url}{_LEGACY_BASE}/rest/user")
            r_user.raise_for_status()

        result = _merge_client_sources(r_all.json().get("data", []),
                                       r_user.json().get("data", []))
        log.debug(f"UniFi clients (credentials): {len(result)} total")
        return result
    except Exception as e:
        log.warning(f"UniFi client fetch (credentials) failed: {e}")
        return []


async def _fetch_clients_api_key(cfg: dict) -> list[dict]:
    headers = {"X-API-KEY": cfg["api_key"], "Accept": "application/json"}
    try:
        site_uuid = await _resolve_site_uuid(cfg["url"], cfg["api_key"])
        base_url  = f"{cfg['url']}{_INTEGRATION_BASE}/sites/{site_uuid}/clients"
        raw: list[dict] = []
        limit, offset = 200, 0

        async with httpx.AsyncClient(verify=False, follow_redirects=True,
                                     timeout=_TIMEOUT) as client:
            while True:
                r = await client.get(base_url, headers=headers,
                                     params={"limit": limit, "offset": offset})
                r.raise_for_status()
                body = r.json()
                page = body.get("data", [])
                raw.extend(page)
                offset += len(page)
                if offset >= body.get("totalCount", 0) or not page:
                    break

        result = [_map_client_integration(c) for c in raw]
        log.debug(f"UniFi clients (api_key): {len(result)} total")
        return result
    except Exception as e:
        log.warning(f"UniFi client fetch (api_key) failed: {e}")
        return []


async def fetch_unifi_networks(db: Session) -> list[dict]:
    """
    Fetch UniFi networks. Used by endpoints outside the comparison flow.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        return []
    if cfg["auth_type"] == "credentials":
        return await _fetch_networks_credentials(cfg)
    return await _fetch_networks_api_key(cfg)


async def _fetch_networks_credentials(cfg: dict) -> list[dict]:
    url = cfg["url"]
    try:
        async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
            r = await client.get(f"{url}{_LEGACY_BASE}/rest/networkconf")
            r.raise_for_status()
        return [m for n in r.json().get("data", []) if (m := _map_network(n))]
    except Exception as e:
        log.warning(f"UniFi network fetch (credentials) failed: {e}")
        return []


async def _fetch_networks_api_key(cfg: dict) -> list[dict]:
    headers = {"X-API-KEY": cfg["api_key"], "Accept": "application/json"}
    try:
        site_uuid = await _resolve_site_uuid(cfg["url"], cfg["api_key"])
        base = f"{cfg['url']}{_INTEGRATION_BASE}/sites/{site_uuid}"

        async with httpx.AsyncClient(verify=False, follow_redirects=True,
                                     timeout=_TIMEOUT) as client:
            r = await client.get(f"{base}/networks", headers=headers)
            r.raise_for_status()
            network_list = r.json().get("data", [])

            result = []
            for n in network_list:
                rd = await client.get(f"{base}/networks/{n['id']}", headers=headers)
                if rd.status_code != 200:
                    result.append({"id": n["id"], "vlan_id": n.get("vlanId"),
                                   "name": n.get("name") or "", "enabled": n.get("enabled", True),
                                   "cidr": None, "gateway": None, "dhcp_start": None,
                                   "dhcp_end": None, "dns_servers": []})
                    continue

                detail     = rd.json()
                ipv4       = detail.get("ipv4Configuration") or {}
                dhcp       = ipv4.get("dhcpConfiguration") or {}
                dhcp_range = dhcp.get("ipAddressRange") or {}
                gw_ip      = ipv4.get("hostIpAddress")
                prefix     = ipv4.get("prefixLength")

                cidr = None
                if gw_ip and prefix is not None:
                    try:
                        cidr = str(_ip.IPv4Interface(f"{gw_ip}/{prefix}").network)
                    except Exception:
                        pass

                result.append({
                    "id": n["id"], "vlan_id": n.get("vlanId"),
                    "name": n.get("name") or "", "enabled": n.get("enabled", True),
                    "cidr": cidr, "gateway": gw_ip,
                    "dhcp_start": dhcp_range.get("start"), "dhcp_end": dhcp_range.get("stop"),
                    "dns_servers": dhcp.get("dnsServerIpAddressesOverride") or [],
                })
        return result
    except Exception as e:
        log.warning(f"UniFi network fetch (api_key) failed: {e}")
        return []


async def fetch_unifi_devices(db: Session) -> list[dict]:
    """
    Fetch UniFi infrastructure devices (APs, switches, gateways).
    Used by endpoints outside the comparison flow.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        return []
    if cfg["auth_type"] == "credentials":
        return await _fetch_devices_credentials(cfg)
    return await _fetch_devices_api_key(cfg)


async def _fetch_devices_credentials(cfg: dict) -> list[dict]:
    url = cfg["url"]
    try:
        async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
            r = await client.get(f"{url}{_LEGACY_BASE}/stat/device")
            if r.status_code == 403:
                log.warning(
                    "UniFi stat/device: 403 — the configured user lacks permission to "
                    "access infrastructure devices. Assign Site Admin or higher role."
                )
                return []
            r.raise_for_status()
        result = [_map_infra_device(d, "credentials") for d in r.json().get("data", [])]
        log.debug(f"UniFi infrastructure (credentials): {len(result)} devices")
        return result
    except Exception as e:
        log.warning(f"UniFi device fetch (credentials) failed: {e}")
        return []


async def _fetch_devices_api_key(cfg: dict) -> list[dict]:
    headers = {"X-API-KEY": cfg["api_key"], "Accept": "application/json"}
    try:
        site_uuid = await _resolve_site_uuid(cfg["url"], cfg["api_key"])
        async with httpx.AsyncClient(verify=False, follow_redirects=True,
                                     timeout=_TIMEOUT) as client:
            r = await client.get(
                f"{cfg['url']}{_INTEGRATION_BASE}/sites/{site_uuid}/devices",
                headers=headers,
            )
            r.raise_for_status()
        result = [_map_infra_device(d, "api_key") for d in r.json().get("data", [])]
        log.debug(f"UniFi infrastructure (api_key): {len(result)} devices")
        return result
    except Exception as e:
        log.warning(f"UniFi device fetch (api_key) failed: {e}")
        return []


async def get_wifi_associations(db: Session) -> dict[str, str]:
    """
    Returns {client_mac: ap_mac} for wireless clients currently associated with an AP.
    Uses /stat/sta (active clients only) which carries the ap_mac field.
    Returns {} if UniFi is not configured or the fetch fails.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        return {}

    url = cfg["url"]
    try:
        if cfg["auth_type"] == "credentials":
            async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
                r = await client.get(f"{url}{_LEGACY_BASE}/stat/sta")
                r.raise_for_status()
                active = r.json().get("data", [])
        else:
            # Integration API does not expose ap_mac — no association data available
            return {}

        return {
            (c.get("mac") or "").lower(): (c.get("ap_mac") or "").lower()
            for c in active
            if c.get("mac") and c.get("ap_mac") and not c.get("is_wired", False)
        }
    except Exception as e:
        log.warning(f"UniFi wifi associations fetch failed: {e}")
        return {}


# ── Comparison fetch — single session for credentials ─────────────────────────

async def fetch_all_for_comparison(db: Session) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Fetch clients, infrastructure devices, and networks in one operation.
    Returns (clients, infra_devices, networks).

    Credentials auth: single login session for all requests, avoiding the
    429 Too Many Requests error from multiple rapid login attempts.

    API key auth: stateless requests run concurrently via asyncio.gather.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        return [], [], []

    if cfg["auth_type"] != "credentials":
        clients, devices, networks = await asyncio.gather(
            _fetch_clients_api_key(cfg),
            _fetch_devices_api_key(cfg),
            _fetch_networks_api_key(cfg),
        )
        return clients, devices, networks

    # Credentials: single session, sequential requests
    url = cfg["url"]
    try:
        async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
            r_alluser = await client.get(f"{url}{_LEGACY_BASE}/stat/alluser")
            r_alluser.raise_for_status()

            r_user = await client.get(f"{url}{_LEGACY_BASE}/rest/user")
            r_user.raise_for_status()

            # stat/sta — currently connected clients; has live hostnames and IPs
            r_sta = await client.get(f"{url}{_LEGACY_BASE}/stat/sta")
            raw_sta = r_sta.json().get("data", []) if r_sta.status_code == 200 else []
            if r_sta.status_code not in (200, 403):
                log.warning(f"UniFi stat/sta returned HTTP {r_sta.status_code}")

            r_dev = await client.get(f"{url}{_LEGACY_BASE}/stat/device")
            if r_dev.status_code == 403:
                log.warning("UniFi stat/device: 403 — infrastructure devices excluded")
                raw_dev = []
            else:
                r_dev.raise_for_status()
                raw_dev = r_dev.json().get("data", [])

            r_net = await client.get(f"{url}{_LEGACY_BASE}/rest/networkconf")
            r_net.raise_for_status()

        clients = _merge_client_sources(
            r_alluser.json().get("data", []),
            r_user.json().get("data", []),
            raw_sta,
        )
        devices  = [_map_infra_device(d, "credentials") for d in raw_dev]
        networks = [m for n in r_net.json().get("data", []) if (m := _map_network(n))]

        log.debug(
            f"UniFi single-session fetch: {len(clients)} clients, "
            f"{len(raw_sta)} active (sta), {len(devices)} infra, {len(networks)} networks"
        )
        return clients, devices, networks

    except Exception as e:
        log.warning(f"UniFi single-session fetch failed: {e}")
        return [], [], []


async def forget_client(db: Session, mac: str) -> None:
    """
    Forget a client from UniFi's history (removes it from the known-device list).
    Tries forget-sta first; falls back to REST user delete for old/offline devices.

    UniFi commonly closes the TCP connection immediately after processing a write
    operation, causing httpx to raise while reading the response even though the
    operation succeeded.  Each write call is therefore wrapped individually:
    if a network error occurs after sending a write request we treat it as success
    (the request was in-flight on a verified, working session).

    Raises:
        ValueError        — UniFi not configured, or auth type is not credentials.
        PermissionError   — Bad username/password or insufficient role.
        LookupError       — MAC not found in UniFi after forget-sta was rejected.
        RuntimeError      — UniFi explicitly rejected the delete with an error.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        raise ValueError("UniFi is not configured")
    if cfg["auth_type"] != "credentials":
        raise ValueError(
            "Deleting clients requires Username & Password auth — "
            "switch auth type in settings"
        )

    mac_lower = mac.lower().strip()
    url = cfg["url"]

    async with _credentials_session(url, cfg["username"], cfg["password"]) as client:

        # ── Step 1: forget-sta ────────────────────────────────────────────────
        # For currently-connected or recently-seen clients this is sufficient.
        rc = "error"
        msg = ""
        try:
            r = await client.post(
                f"{url}{_LEGACY_BASE}/cmd/stamgr",
                json={"cmd": "forget-sta", "macs": [mac_lower]},
            )
            if r.status_code in (200, 204):
                try:
                    body = r.json()
                    rc  = body.get("meta", {}).get("rc", "ok")
                    msg = body.get("meta", {}).get("msg", "")
                except Exception:
                    rc = "ok"   # non-JSON body after 200 — treat as success
            else:
                log.warning(f"UniFi forget-sta HTTP {r.status_code} for {mac_lower}")
        except Exception as e:
            # Connection closed while reading the forget-sta response.
            # The request was already sent on a verified session; the device is
            # very likely gone.  Return success.
            log.info(
                f"UniFi forget-sta network error for {mac_lower} "
                f"(treated as success): {e}"
            )
            return

        if rc == "ok":
            log.debug(f"UniFi forget-sta succeeded for {mac_lower}")
            return

        # ── Step 2: REST user delete ──────────────────────────────────────────
        # forget-sta rejected (device not in active client table — common for old
        # or wired-only devices).  Look up the user record and delete it directly.
        log.info(
            f"UniFi forget-sta rc={rc!r} msg={msg!r} for {mac_lower} "
            f"— falling back to REST user delete"
        )

        user_list = await client.get(f"{url}{_LEGACY_BASE}/rest/user")
        if user_list.status_code != 200:
            raise RuntimeError(
                f"Could not look up client in UniFi — HTTP {user_list.status_code}"
            )

        # /rest/user ignores query params — match explicitly by MAC
        all_users = user_list.json().get("data", [])
        matched = next(
            (u for u in all_users if (u.get("mac") or "").lower() == mac_lower),
            None,
        )
        if matched is None:
            raise LookupError(
                "Client not found in UniFi — it may have already been removed"
            )

        uid = matched.get("_id")
        if not uid:
            raise RuntimeError(
                f"UniFi returned a user record without _id for {mac_lower}"
            )

        try:
            dr = await client.delete(f"{url}{_LEGACY_BASE}/rest/user/{uid}")
            if dr.status_code not in (200, 204):
                dr_msg = ""
                try:
                    dr_msg = dr.json().get("meta", {}).get("msg", "") if dr.content else ""
                except Exception:
                    pass
                raise RuntimeError(
                    f"UniFi rejected REST delete — {dr_msg or f'HTTP {dr.status_code}'}"
                )
            log.debug(f"UniFi REST user delete succeeded for {mac_lower}")
        except RuntimeError:
            raise
        except Exception as e:
            # Connection closed while reading the delete response — same pattern
            # as forget-sta.  The DELETE was sent on a verified session with a
            # confirmed uid; treat as success.
            log.info(
                f"UniFi REST delete network error for {mac_lower} "
                f"(treated as success): {e}"
            )


async def create_client(
    db: Session,
    mac: str,
    name: str | None = None,
    fixed_ip: str | None = None,
    network_id: str | None = None,
    note: str | None = None,
) -> dict:
    """
    Create (or update) a known client record in UniFi.
    Uses POST /rest/user — credentials auth only.

    Returns the created/updated user dict from UniFi.

    Raises:
        ValueError      — UniFi not configured, or auth type is not credentials.
        PermissionError — Bad credentials or insufficient role.
        RuntimeError    — UniFi rejected the request.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        raise ValueError("UniFi is not configured")
    if cfg["auth_type"] != "credentials":
        raise ValueError(
            "Creating clients requires Username & Password auth — "
            "switch auth type in settings"
        )

    mac_lower = mac.lower().strip()
    url = cfg["url"]

    payload: dict = {"mac": mac_lower}
    if name:
        payload["name"] = name
    if fixed_ip:
        payload["fixed_ip"] = fixed_ip
        payload["use_fixedip"] = True
    if network_id:
        payload["network_id"] = network_id
    if note:
        payload["noted"] = True
        payload["note"] = note

    async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
        r = await client.post(f"{url}{_LEGACY_BASE}/rest/user", json=payload)
        if r.status_code not in (200, 201):
            msg = ""
            try:
                msg = r.json().get("meta", {}).get("msg", "")
            except Exception:
                pass
            raise RuntimeError(
                f"UniFi rejected client creation — {msg or f'HTTP {r.status_code}'}"
            )
        data = r.json().get("data", [])
        return data[0] if data else {}


async def update_client_fields(db: Session, mac: str, fields: dict) -> dict:
    """
    Update specific fields on an existing UniFi known-client record.

    Looks up the record by MAC, merges `fields` into it, then PUTs it back.
    `fields` may contain any writable subset understood by /rest/user, e.g.:
        fixed_ip, use_fixedip, local_dns_record, local_dns_record_enabled, mac

    Raises:
        ValueError      — UniFi not configured or wrong auth type.
        LookupError     — Client not found.
        RuntimeError    — UniFi rejected the update.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        raise ValueError("UniFi is not configured")
    if cfg["auth_type"] != "credentials":
        raise ValueError(
            "Updating clients requires Username & Password auth — "
            "switch auth type in settings"
        )

    mac_lower = mac.lower().strip()
    url = cfg["url"]

    async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
        user_list = await client.get(f"{url}{_LEGACY_BASE}/rest/user")
        if user_list.status_code != 200:
            raise RuntimeError(
                f"Failed to fetch UniFi user list: HTTP {user_list.status_code}"
            )

        # /rest/user does not support MAC filtering via query params — it returns
        # all known clients regardless. Match explicitly by MAC to avoid writing
        # to the wrong device.
        all_users = user_list.json().get("data", [])
        existing = next(
            (u for u in all_users if (u.get("mac") or "").lower() == mac_lower),
            None,
        )
        if existing is None:
            raise LookupError(f"Client {mac_lower} not found in UniFi")

        uid = existing.get("_id")
        if not uid:
            raise RuntimeError(
                f"UniFi returned a user record without _id for {mac_lower}"
            )

        payload = {**existing, **fields}
        r = await client.put(f"{url}{_LEGACY_BASE}/rest/user/{uid}", json=payload)
        if r.status_code not in (200, 201):
            msg = ""
            try:
                msg = r.json().get("meta", {}).get("msg", "")
            except Exception:
                pass
            raise RuntimeError(
                f"UniFi rejected update — {msg or f'HTTP {r.status_code}'}"
            )

        data = r.json().get("data", [])
        return data[0] if data else {}


async def update_network_fields(db: Session, unifi_network_id: str, fields: dict) -> dict:
    """
    Update specific fields on an existing UniFi network record.

    Fetches the current networkconf record, merges `fields` into it, then PUTs
    it back.  Supported keys:
        name         — network name
        cidr         — IPv4 CIDR (prefix length applied to existing gateway)
        gateway      — gateway IP (prefix length kept from existing ip_subnet)
        dhcp_start   — DHCP range start
        dhcp_end     — DHCP range end

    Raises:
        ValueError      — UniFi not configured or wrong auth type.
        LookupError     — Network not found.
        RuntimeError    — UniFi rejected the update.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        raise ValueError("UniFi is not configured")
    if cfg["auth_type"] != "credentials":
        raise ValueError(
            "Updating UniFi networks requires Username & Password auth — "
            "switch auth type in settings"
        )

    url = cfg["url"]

    async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
        r = await client.get(f"{url}{_LEGACY_BASE}/rest/networkconf/{unifi_network_id}")
        if r.status_code != 200:
            raise RuntimeError(f"Failed to fetch UniFi network: HTTP {r.status_code}")

        data = r.json().get("data", [])
        if not data:
            raise LookupError(f"UniFi network {unifi_network_id!r} not found")

        network = data[0]
        existing_ip_subnet = network.get("ip_subnet", "")

        # Collect gateway/cidr together — they must be reconstructed as a unit
        new_gw = fields.get("gateway")
        new_cidr = fields.get("cidr")

        if new_gw or new_cidr:
            try:
                # Derive prefix: from new_cidr if provided, else from existing ip_subnet
                if new_cidr:
                    prefix = _ip.IPv4Network(new_cidr, strict=False).prefixlen
                elif "/" in existing_ip_subnet:
                    prefix = int(existing_ip_subnet.split("/")[1])
                else:
                    prefix = 24

                # Derive gateway: from new_gw if provided, else preserve host offset into new network
                if new_gw:
                    gw = new_gw
                elif new_cidr and "/" in existing_ip_subnet:
                    new_net = _ip.IPv4Network(new_cidr, strict=False)
                    old_gw = _ip.IPv4Address(existing_ip_subnet.split("/")[0])
                    old_net = _ip.IPv4Network(existing_ip_subnet, strict=False)
                    host_offset = int(old_gw) - int(old_net.network_address)
                    gw = str(_ip.IPv4Address(int(new_net.network_address) + host_offset))
                else:
                    gw = existing_ip_subnet.split("/")[0] if "/" in existing_ip_subnet else ""

                if gw:
                    network["ip_subnet"] = f"{gw}/{prefix}"
            except Exception:
                pass

        for field, value in fields.items():
            if field == "name":
                network["name"] = value
            elif field in ("cidr", "gateway"):
                pass  # handled above
            elif field == "dhcp_start":
                network["dhcpd_enabled"] = True
                network.setdefault("dhcpd_leasetime", 86400)
                network["dhcpd_start"] = value
            elif field == "dhcp_end":
                network["dhcpd_enabled"] = True
                network.setdefault("dhcpd_leasetime", 86400)
                network["dhcpd_stop"] = value
            elif field == "vlan_id":
                network["vlan"] = int(value)
                network["vlan_enabled"] = True

        try:
            r = await client.put(
                f"{url}{_LEGACY_BASE}/rest/networkconf/{unifi_network_id}",
                json=network,
            )
        except Exception:
            return {}

        if r.status_code not in (200, 201):
            msg = ""
            try:
                msg = r.json().get("meta", {}).get("msg", "")
            except Exception:
                pass
            raise RuntimeError(f"UniFi rejected network update — {msg or f'HTTP {r.status_code}'}")

        data = r.json().get("data", [])
        return data[0] if data else {}


async def delete_unifi_network(db: Session, unifi_network_id: str) -> None:
    """
    Delete a network from UniFi via DELETE /rest/networkconf/{id}.
    Credentials auth only.

    Raises:
        ValueError      — UniFi not configured or wrong auth type.
        RuntimeError    — UniFi rejected the delete.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        raise ValueError("UniFi is not configured")
    if cfg["auth_type"] != "credentials":
        raise ValueError(
            "Deleting networks requires Username & Password auth — "
            "switch auth type in settings"
        )

    url = cfg["url"]
    async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
        try:
            r = await client.delete(
                f"{url}{_LEGACY_BASE}/rest/networkconf/{unifi_network_id}"
            )
        except Exception:
            return

        if r.status_code not in (200, 204):
            msg = ""
            try:
                msg = r.json().get("meta", {}).get("msg", "")
            except Exception:
                pass
            raise RuntimeError(
                f"UniFi rejected network delete — {msg or f'HTTP {r.status_code}'}"
            )


async def create_unifi_network(
    db: Session,
    name: str,
    vlan_id: int,
    gateway: str | None = None,
    cidr: str | None = None,
    dhcp_start: str | None = None,
    dhcp_end: str | None = None,
) -> dict:
    """
    Create a new network in UniFi via POST /rest/networkconf.
    Credentials auth only.

    Raises:
        ValueError      — UniFi not configured or wrong auth type.
        RuntimeError    — UniFi rejected the create.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        raise ValueError("UniFi is not configured")
    if cfg["auth_type"] != "credentials":
        raise ValueError(
            "Creating networks requires Username & Password auth — "
            "switch auth type in settings"
        )

    payload: dict = {
        "name": name,
        "purpose": "corporate",
        "vlan_enabled": True,
        "vlan": vlan_id,
    }

    if gateway and cidr:
        try:
            prefix_len = _ip.IPv4Network(cidr, strict=False).prefixlen
            payload["ip_subnet"] = f"{gateway}/{prefix_len}"
        except Exception:
            pass
    elif gateway:
        payload["ip_subnet"] = f"{gateway}/24"

    if dhcp_start or dhcp_end:
        payload["dhcpd_enabled"] = True
        payload["dhcpd_leasetime"] = 86400
    if dhcp_start:
        payload["dhcpd_start"] = dhcp_start
    if dhcp_end:
        payload["dhcpd_stop"] = dhcp_end

    url = cfg["url"]
    async with _credentials_session(url, cfg["username"], cfg["password"]) as client:
        try:
            r = await client.post(f"{url}{_LEGACY_BASE}/rest/networkconf", json=payload)
        except Exception:
            return {}

        if r.status_code not in (200, 201):
            msg = ""
            try:
                msg = r.json().get("meta", {}).get("msg", "")
            except Exception:
                pass
            raise RuntimeError(
                f"UniFi rejected network creation — {msg or f'HTTP {r.status_code}'}"
            )

        data = r.json().get("data", [])
        return data[0] if data else {}
