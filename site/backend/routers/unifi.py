"""
UniFi integration endpoints.
Admin-only: configuration, connection test, and data fetch.
"""
import ipaddress as _ip
import logging

from fastapi import APIRouter, Depends, HTTPException
import re as _re
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from database import get_db
from models.device import Device
from models.network import Network
from models.nic import Nic
from models.system_settings import SystemSettings
from models.user import User
from services.auth import require_admin
from services.encryption import decrypt, encrypt
from services.unifi_client import (
    _build_url,
    _get_unifi_config,
    create_client,
    fetch_all_for_comparison,
    fetch_unifi_clients,
    forget_client,
    test_unifi_connection,
    test_unifi_connection_credentials,
    update_client_fields,
    update_network_fields,
    delete_unifi_network,
    create_unifi_network,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/unifi", tags=["unifi"])


# ── Pydantic models ───────────────────────────────────────────────────────────

_HOST_RE = _re.compile(r'^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?(:\d{1,5})?$')


def _validate_unifi_host(v: str) -> str:
    """Strip accidental scheme prefix and validate hostname/IP[:port] format."""
    v = v.strip()
    for scheme in ('https://', 'http://'):
        if v.lower().startswith(scheme):
            v = v[len(scheme):]
    if not _HOST_RE.match(v):
        raise ValueError('host must be a valid hostname or IP address (e.g. 192.168.1.1 or controller.local:8443)')
    return v


class UnifiSettings(BaseModel):
    host: str
    auth_type: str = "api_key"       # "api_key" | "credentials"
    api_key: str | None = None       # None = keep existing
    username: str | None = None
    password: str | None = None      # None = keep existing
    write_enabled: bool = False

    @field_validator('host')
    @classmethod
    def validate_host(cls, v: str) -> str:
        return _validate_unifi_host(v)


class UnifiTestRequest(BaseModel):
    host: str
    auth_type: str = "api_key"
    api_key: str | None = None
    username: str | None = None
    password: str | None = None      # None = use stored

    @field_validator('host')
    @classmethod
    def validate_host(cls, v: str) -> str:
        return _validate_unifi_host(v)


class UnifiCreateClientRequest(BaseModel):
    mac: str
    name: str | None = None
    fixed_ip: str | None = None
    network_id: str | None = None
    note: str | None = None


class UnifiSyncFieldRequest(BaseModel):
    field: str   # "mac" | "ip" | "dns"
    value: str


class MyNetNicSyncRequest(BaseModel):
    field: str   # "mac" | "ip" | "dns"
    value: str


# ── Shared helpers ────────────────────────────────────────────────────────────

def _match_nic(
    mac: str,
    ip: str,
    by_mac: dict[str, dict],
    by_ip: dict[str, dict],
) -> tuple[dict | None, str | None]:
    """
    Look up a UniFi entry for a NIC.
    Returns (unifi_dict, match_method) where match_method is 'mac', 'ip', or None.
    MAC match takes priority over IP match.
    """
    if mac:
        unifi = by_mac.get(mac)
        if unifi:
            return unifi, "mac"
    if ip and ip != "DHCP":
        unifi = by_ip.get(ip)
        if unifi:
            return unifi, "ip"
    return None, None


def _calc_nic_diffs(nic: Nic, unifi: dict, dev: Device | None = None) -> list[dict]:
    """
    Compare a MyNet NIC against its matched UniFi entry.
    Returns a list of difference dicts: [{field, mynet, unifi}, ...].
    """
    diffs = []

    # MAC address — differs when: (a) matched by IP and MyNet has no MAC, or
    # (b) matched by IP and both sides have a MAC but they differ.
    # MAC-matched entries are always equal so this never fires for them.
    mynet_mac = (nic.mac or "").lower().strip()
    unifi_mac  = (unifi.get("mac") or "").lower().strip()
    if unifi_mac and mynet_mac != unifi_mac:
        diffs.append({"field": "MAC Address", "mynet": mynet_mac or None, "unifi": unifi_mac})

    # IP address — flag if either side has a static IP and they differ
    mynet_ip = (nic.ip_address or "").strip()
    unifi_ip = (unifi.get("ip") or "").strip()
    if mynet_ip and mynet_ip != "DHCP" and mynet_ip != unifi_ip:
        diffs.append({"field": "IP Address", "mynet": mynet_ip, "unifi": unifi_ip or None})

    # Connection type (wired vs wireless)
    nic_wireless = nic.nic_type.value == "WIFI"
    unifi_wireless = unifi.get("is_wireless", False)
    if nic_wireless != unifi_wireless:
        diffs.append({
            "field": "Connection Type",
            "mynet":  "Wireless" if nic_wireless  else "Wired",
            "unifi":  "Wireless" if unifi_wireless else "Wired",
        })

    # DNS entry — flag if either side has an entry and they differ
    mynet_dns = (nic.dns_entry or "").strip().lower()
    unifi_dns  = (unifi.get("local_dns") or "").strip().lower()
    if (mynet_dns or unifi_dns) and mynet_dns != unifi_dns:
        diffs.append({
            "field": "DNS Entry",
            "mynet": nic.dns_entry or None,
            "unifi": unifi.get("local_dns"),
        })

    # Hostname — compare whenever UniFi has a value (MyNet may be empty)
    if dev:
        mynet_host = (dev.hostname or "").strip().lower()
        unifi_host = (unifi.get("hostname") or "").strip().lower()
        if unifi_host and mynet_host != unifi_host:
            diffs.append({
                "field": "Hostname",
                "mynet": dev.hostname,
                "unifi": unifi.get("hostname"),
            })

    return diffs


def _build_unifi_lookup(
    clients: list[dict],
    infra: list[dict],
) -> tuple[list[dict], dict[str, dict], dict[str, dict]]:
    """
    Combine clients + infrastructure devices into a single flat list and
    build MAC/IP lookup indexes.

    Infrastructure devices are normalised to the same shape as clients so
    they can participate in MAC/IP matching.

    Returns (all_unifi, by_mac, by_ip).
    """
    infra_as_clients: list[dict] = [
        {
            "ip":               d.get("ip"),
            "mac":              d.get("mac"),
            "name":             d.get("name"),
            "hostname":         d.get("name"),
            "is_wireless":      False,
            "ssid":             None,
            "last_seen":        None,
            "is_infrastructure": True,
        }
        for d in infra if d.get("mac")
    ]

    all_unifi = clients + infra_as_clients

    by_mac: dict[str, dict] = {}
    by_ip:  dict[str, dict] = {}
    for c in all_unifi:
        if c.get("mac"):
            by_mac[c["mac"].lower()] = c
        if c.get("ip"):
            by_ip[c["ip"]] = c

    return all_unifi, by_mac, by_ip


def _serialise_unifi(u: dict | None) -> dict | None:
    """Return a serialisable subset of a UniFi entry for API responses."""
    if u is None:
        return None
    return {
        "ip":               u.get("ip"),
        "mac":              u.get("mac"),
        "name":             u.get("name"),
        "hostname":         u.get("hostname"),
        "local_dns":        u.get("local_dns"),
        "is_wireless":      u.get("is_wireless"),
        "ssid":             u.get("ssid"),
        "last_seen":        u.get("last_seen"),
        "is_infrastructure": bool(u.get("is_infrastructure")),
    }


# ── Settings endpoints ────────────────────────────────────────────────────────

@router.get("/settings")
async def get_unifi_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Return current UniFi settings (secrets masked)."""
    s = db.query(SystemSettings).first()
    if not s:
        return {}
    return {
        "host":          s.unifi_host or "",
        "auth_type":     getattr(s, "unifi_auth_type", None) or "api_key",
        "api_key_set":   bool(s.unifi_api_key),
        "username":      s.unifi_username or "",
        "password_set":  bool(getattr(s, "unifi_password", None)),
        "write_enabled": bool(getattr(s, "unifi_write_enabled", False)),
    }


@router.patch("/settings")
async def save_unifi_settings(
    body: UnifiSettings,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Persist UniFi connection settings."""
    s = db.query(SystemSettings).first()
    if not s:
        raise HTTPException(status_code=500, detail="System settings not found")

    # Strip any scheme the user may have typed
    host = body.host.strip().removeprefix("https://").removeprefix("http://").rstrip("/")
    s.unifi_host = host or None
    s.unifi_auth_type = body.auth_type or "api_key"
    s.unifi_write_enabled = body.write_enabled

    if body.auth_type == "credentials":
        if body.username is not None:
            s.unifi_username = body.username or None
        if body.password is not None:
            s.unifi_password = encrypt(body.password) if body.password else None
    else:
        if body.api_key is not None:
            s.unifi_api_key = encrypt(body.api_key) if body.api_key else None

    db.commit()
    return {"ok": True}


@router.post("/test")
async def test_unifi(
    body: UnifiTestRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Test a UniFi connection. Uses stored credentials if placeholder/null passed."""
    s = db.query(SystemSettings).first()
    url = _build_url(body.host)
    PLACEHOLDER = "••••••••••••••••"

    if body.auth_type == "credentials":
        username = body.username or (s.unifi_username if s else "") or ""
        password = body.password
        if not password or password == PLACEHOLDER:
            password = decrypt(s.unifi_password) if s and getattr(s, "unifi_password", None) else ""
        return await test_unifi_connection_credentials(url=url, username=username, password=password)
    else:
        api_key = body.api_key
        if not api_key or api_key == PLACEHOLDER:
            api_key = decrypt(s.unifi_api_key) if s and s.unifi_api_key else ""
        return await test_unifi_connection(url=url, api_key=api_key)


# ── Client endpoints ──────────────────────────────────────────────────────────

@router.get("/clients")
async def get_unifi_clients(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Fetch current client list from UniFi."""
    clients = await fetch_unifi_clients(db)
    return {"clients": clients, "total": len(clients)}


@router.delete("/clients/{mac}")
async def forget_unifi_client(
    mac: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Forget a client from UniFi's history (removes it from the device list).
    Only supported with Username & Password auth — the Integration API does not
    expose a client delete/forget operation.
    Requires Site Admin role on the configured UniFi user.
    """
    cfg = _get_unifi_config(db)
    if not cfg:
        raise HTTPException(status_code=400, detail="UniFi not configured")

    if cfg["auth_type"] != "credentials":
        raise HTTPException(
            status_code=400,
            detail="Deleting clients requires Username & Password auth — switch auth type in settings",
        )

    try:
        await forget_client(db, mac)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.warning(f"UniFi forget_client unexpected error for {mac}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to contact UniFi: {str(e)[:120]}")

    return {"ok": True}


@router.post("/clients")
async def add_unifi_client(
    body: UnifiCreateClientRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Create a known client record in UniFi (name/alias, optional fixed IP,
    optional network assignment, optional note).
    Credentials auth only — the Integration API has no write endpoint for clients.
    """
    try:
        result = await create_client(
            db,
            mac=body.mac,
            name=body.name,
            fixed_ip=body.fixed_ip,
            network_id=body.network_id,
            note=body.note,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.warning(f"UniFi create_client unexpected error: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to contact UniFi: {str(e)[:120]}")

    return {"ok": True, "client": result}


@router.patch("/clients/{mac}/fields")
async def sync_unifi_client_field(
    mac: str,
    body: UnifiSyncFieldRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Push a single field value from MyNet into the matching UniFi client record."""
    if body.field == "ip":
        fields = {"fixed_ip": body.value, "use_fixedip": bool(body.value)}
    elif body.field == "dns":
        fields = {
            "local_dns_record": body.value,
            "local_dns_record_enabled": bool(body.value),
        }
    elif body.field == "mac":
        fields = {"mac": body.value.lower().strip()}
    else:
        raise HTTPException(status_code=400, detail=f"Unknown field: {body.field!r}")

    try:
        await update_client_fields(db, mac, fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.warning(f"UniFi sync_field unexpected error: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to contact UniFi: {str(e)[:120]}")

    return {"ok": True}


@router.patch("/mynet/devices/{device_id}/fields")
async def sync_mynet_device_field(
    device_id: int,
    body: MyNetNicSyncRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Pull a single field value from UniFi into the matching MyNet Device."""
    dev = db.query(Device).filter(Device.id == device_id).first()
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    if body.field == "hostname":
        dev.hostname = body.value
    else:
        raise HTTPException(status_code=400, detail=f"Unknown field: {body.field!r}")

    db.commit()
    return {"ok": True}


@router.patch("/mynet/nics/{nic_id}/fields")
async def sync_mynet_nic_field(
    nic_id: int,
    body: MyNetNicSyncRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Pull a single field value from UniFi into the matching MyNet NIC."""
    nic = db.query(Nic).filter(Nic.id == nic_id).first()
    if not nic:
        raise HTTPException(status_code=404, detail="NIC not found")

    if body.field == "ip":
        try:
            _ip.ip_address(body.value)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{body.value!r} is not a valid IP address")
        nic.ip_address = body.value
    elif body.field == "dns":
        if not _re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$', body.value):
            raise HTTPException(status_code=422, detail=f"{body.value!r} is not a valid hostname")
        nic.dns_entry = body.value
    elif body.field == "mac":
        nic.mac = body.value.lower().strip()
    else:
        raise HTTPException(status_code=400, detail=f"Unknown field: {body.field!r}")

    db.commit()
    return {"ok": True}


class NetworkFieldsSyncRequest(BaseModel):
    fields: dict[str, str | int]


@router.patch("/mynet/networks/{network_id}/fields")
async def sync_mynet_network_fields(
    network_id: int,
    body: NetworkFieldsSyncRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Pull one or more field values from UniFi into the matching MyNet Network."""
    network = db.get(Network, network_id)
    if not network:
        raise HTTPException(status_code=404, detail="Network not found")

    allowed = {"name", "cidr", "gateway", "dhcp_start", "dhcp_end", "vlan_id"}
    for field, value in body.fields.items():
        if field not in allowed:
            raise HTTPException(status_code=400, detail=f"Unknown field: {field!r}")
        if field == "name":
            network.name = str(value)
        elif field == "cidr":
            try:
                _ip.ip_network(str(value), strict=False)
            except ValueError:
                raise HTTPException(status_code=422, detail=f"{value!r} is not a valid CIDR")
            network.cidr = str(value)
        elif field in ("gateway", "dhcp_start", "dhcp_end"):
            try:
                _ip.ip_address(str(value))
            except ValueError:
                raise HTTPException(status_code=422, detail=f"{value!r} is not a valid IP address")
            if field == "gateway":
                network.gateway = str(value)
            elif field == "dhcp_start":
                network.dhcp_range_start = str(value)
            else:
                network.dhcp_range_end = str(value)
        elif field == "vlan_id":
            network.vlan_id = int(value)

    db.commit()
    return {"ok": True}


@router.delete("/networks/{unifi_network_id}", status_code=204)
async def delete_network_from_unifi(
    unifi_network_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete a network from UniFi. Credentials auth only."""
    try:
        await delete_unifi_network(db, unifi_network_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.warning(f"UniFi delete_network unexpected error: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to contact UniFi: {str(e)[:120]}")


class UnifiNetworkCreateRequest(BaseModel):
    name: str
    vlan_id: int
    gateway: str | None = None
    cidr: str | None = None
    dhcp_start: str | None = None
    dhcp_end: str | None = None


@router.post("/networks", status_code=201)
async def add_network_to_unifi(
    body: UnifiNetworkCreateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Push a MyNet-only network into UniFi. Credentials auth only."""
    try:
        result = await create_unifi_network(
            db,
            name=body.name,
            vlan_id=body.vlan_id,
            gateway=body.gateway,
            cidr=body.cidr,
            dhcp_start=body.dhcp_start,
            dhcp_end=body.dhcp_end,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.warning(f"UniFi create_network unexpected error: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to contact UniFi: {str(e)[:120]}")

    return {"ok": True, "data": result}


@router.patch("/networks/{unifi_network_id}/fields")
async def sync_unifi_network_fields(
    unifi_network_id: str,
    body: NetworkFieldsSyncRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Push one or more field values from MyNet into the matching UniFi network record."""
    try:
        await update_network_fields(db, unifi_network_id, body.fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.warning(f"UniFi sync_network_fields unexpected error: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to contact UniFi: {str(e)[:120]}")

    return {"ok": True}


# ── Comparison endpoints ──────────────────────────────────────────────────────

@router.get("/comparison")
async def get_comparison(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Full comparison between MyNet and UniFi.
    Returns {networks: [...], devices: [...]} or {status: 'unconfigured'}.

    Networks: matched by Name → VLAN ID → Gateway (cascading). Compares VLAN, name, CIDR, gateway, DHCP range.
    Devices:  matched by MAC (then IP). Compares IP, connection type.
              Includes UniFi-only clients and infrastructure devices not found in MyNet.
    """
    if not _get_unifi_config(db):
        return {"status": "unconfigured"}

    # Single session for credentials; concurrent requests for API key
    unifi_clients, unifi_infra, unifi_networks = await fetch_all_for_comparison(db)

    # ── Networks ──────────────────────────────────────────────────────────────
    mynet_networks = db.query(Network).all()

    def _net_row(mn, un) -> dict:
        diffs: list[str] = []
        mn_vlan = mn.vlan_id if mn else None
        un_vlan = un["vlan_id"] if un else None
        if mn and un and mn_vlan != un_vlan:
            diffs.append("vlan_id")
        if mn and un:
            if (mn.name or "").strip().lower() != (un["name"] or "").strip().lower():
                diffs.append("name")
            try:
                mynet_cidr = str(_ip.IPv4Network(mn.cidr, strict=False)) if mn.cidr else ""
            except Exception:
                mynet_cidr = (mn.cidr or "").strip()
            unifi_cidr = (un.get("cidr") or "").strip()
            if (mynet_cidr or unifi_cidr) and mynet_cidr != unifi_cidr:
                diffs.append("cidr")
            mynet_gw = (mn.gateway or "").strip()
            unifi_gw = (un.get("gateway") or "").strip()
            if (mynet_gw or unifi_gw) and mynet_gw != unifi_gw:
                diffs.append("gateway")
            mynet_ds = (mn.dhcp_range_start or "").strip()
            unifi_ds = (un.get("dhcp_start") or "").strip()
            if (mynet_ds or unifi_ds) and mynet_ds != unifi_ds:
                diffs.append("dhcp_start")
            mynet_de = (mn.dhcp_range_end or "").strip()
            unifi_de = (un.get("dhcp_end") or "").strip()
            if (mynet_de or unifi_de) and mynet_de != unifi_de:
                diffs.append("dhcp_end")
        vlan_id = mn_vlan if mn_vlan is not None else un_vlan
        if not mn:
            status = "unifi_only"
        elif not un:
            status = "mynet_only"
        else:
            status = "differences" if diffs else "match"
        return {
            "status": status,
            "vlan_id": vlan_id,
            "mynet_vlan_id": mn_vlan,
            "unifi_vlan_id": un_vlan,
            "row_key": f"{mn.id if mn else ''}-{un['id'] if un else ''}",
            "mynet_network_id": mn.id if mn else None,
            "unifi_network_id": un.get("id") if un else None,
            "mynet_name": mn.name if mn else None,
            "unifi_name": un["name"] if un else None,
            "mynet_cidr": mn.cidr if mn else None,
            "unifi_cidr": un.get("cidr") if un else None,
            "mynet_gateway": mn.gateway if mn else None,
            "unifi_gateway": un.get("gateway") if un else None,
            "mynet_dhcp_start": mn.dhcp_range_start if mn else None,
            "unifi_dhcp_start": un.get("dhcp_start") if un else None,
            "mynet_dhcp_end": mn.dhcp_range_end if mn else None,
            "unifi_dhcp_end": un.get("dhcp_end") if un else None,
            "unifi_dns_servers": un.get("dns_servers", []) if un else [],
            "differences": diffs,
        }

    matched_mn_ids: set[int] = set()
    matched_un_ids: set[str] = set()
    network_rows: list[dict] = []

    # Pass 1: Name match (exact, case-insensitive, 1:1 only to avoid false positives)
    mn_by_name: dict[str, list] = {}
    for n in mynet_networks:
        key = (n.name or "").strip().lower()
        if key:
            mn_by_name.setdefault(key, []).append(n)
    un_by_name: dict[str, list] = {}
    for n in unifi_networks:
        key = (n.get("name") or "").strip().lower()
        if key:
            un_by_name.setdefault(key, []).append(n)
    for name_key, mn_list in mn_by_name.items():
        un_list = un_by_name.get(name_key, [])
        if len(mn_list) == 1 and len(un_list) == 1:
            network_rows.append(_net_row(mn_list[0], un_list[0]))
            matched_mn_ids.add(mn_list[0].id)
            matched_un_ids.add(un_list[0]["id"])

    mn_rem = [n for n in mynet_networks if n.id not in matched_mn_ids]
    un_rem = [n for n in unifi_networks if n.get("id") not in matched_un_ids]

    # Pass 2: VLAN ID match
    mn_by_vlan = {n.vlan_id: n for n in mn_rem if n.vlan_id is not None}
    un_by_vlan = {n["vlan_id"]: n for n in un_rem if n.get("vlan_id") is not None}
    for vlan_id in set(mn_by_vlan) & set(un_by_vlan):
        mn, un = mn_by_vlan[vlan_id], un_by_vlan[vlan_id]
        network_rows.append(_net_row(mn, un))
        matched_mn_ids.add(mn.id)
        matched_un_ids.add(un["id"])

    mn_rem = [n for n in mn_rem if n.id not in matched_mn_ids]
    un_rem = [n for n in un_rem if n.get("id") not in matched_un_ids]

    # Pass 3: Gateway match
    mn_by_gw = {n.gateway.strip(): n for n in mn_rem if (n.gateway or "").strip()}
    un_by_gw = {(n.get("gateway") or "").strip(): n for n in un_rem if (n.get("gateway") or "").strip()}
    for gw in set(mn_by_gw) & set(un_by_gw):
        mn, un = mn_by_gw[gw], un_by_gw[gw]
        network_rows.append(_net_row(mn, un))
        matched_mn_ids.add(mn.id)
        matched_un_ids.add(un["id"])

    mn_rem = [n for n in mn_rem if n.id not in matched_mn_ids]
    un_rem = [n for n in un_rem if n.get("id") not in matched_un_ids]

    for mn in mn_rem:
        network_rows.append(_net_row(mn, None))
    for un in un_rem:
        network_rows.append(_net_row(None, un))

    network_rows.sort(key=lambda r: (r["vlan_id"] is None, r["vlan_id"] or 0))

    # ── Devices ───────────────────────────────────────────────────────────────
    all_unifi, by_mac, by_ip = _build_unifi_lookup(unifi_clients, unifi_infra)

    nics = (
        db.query(Nic)
        .join(Device, Nic.device_id == Device.id)
        .all()
    )

    device_rows = []
    matched_unifi_macs: set[str] = set()

    for nic in nics:
        mac = (nic.mac or "").lower().strip()
        ip  = (nic.ip_address or "").strip()
        dev = nic.device

        unifi, match_method = _match_nic(mac, ip, by_mac, by_ip)

        if unifi and unifi.get("mac"):
            matched_unifi_macs.add(unifi["mac"].lower())

        diffs = _calc_nic_diffs(nic, unifi, dev) if unifi else []

        device_rows.append({
            "status":              "mynet_only" if not unifi else ("differences" if diffs else "match"),
            "mynet_device_id":     dev.id,
            "mynet_device_name":   dev.name,
            "mynet_device_status": dev.status.value if dev.status else None,
            "mynet_nic_id":        nic.id,
            "mynet_nic_label":     nic.label or nic.nic_type.value,
            "mynet_nic_type":      nic.nic_type.value,
            "mynet_nic_disabled":  not nic.is_active,
            "mynet_ip":            ip or None,
            "mynet_mac":           mac or None,
            "mynet_hostname":      dev.hostname or None,
            "mynet_dns_entry":     nic.dns_entry or None,
            "match_method":        match_method,
            "differences":         diffs,
            "unifi":               _serialise_unifi(unifi),
        })

    # UniFi-only entries not matched to any MyNet NIC
    for c in all_unifi:
        if (c.get("mac") or "").lower() not in matched_unifi_macs:
            device_rows.append({
                "status":              "unifi_only",
                "mynet_device_id":     None,
                "mynet_device_name":   None,
                "mynet_device_status": None,
                "mynet_nic_id":        None,
                "mynet_nic_label":     None,
                "mynet_nic_type":      None,
                "mynet_nic_disabled":  False,
                "mynet_ip":            None,
                "mynet_mac":           None,
                "mynet_hostname":      None,
                "mynet_dns_entry":     None,
                "match_method":        None,
                "differences":         [],
                "unifi":               _serialise_unifi(c),
            })

    log.debug(
        f"Comparison: {len(unifi_clients)} clients, {len(unifi_infra)} infra, "
        f"{len(all_unifi)} total UniFi, {len(device_rows)} rows"
    )
    return {
        "networks": network_rows,
        "devices":  device_rows,
        "_meta": {
            "unifi_clients": len(unifi_clients),
            "unifi_infra":   len(unifi_infra),
        },
    }
