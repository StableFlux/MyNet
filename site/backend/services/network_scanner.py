"""
Network scanner — ping-sweeps all subnets defined in the Networks table,
resolves MACs via /proc/net/arp, does reverse DNS, and cross-references
the results against the device/NIC database.

Returns a list of host dicts — does NOT modify the database.
"""
import asyncio
import ipaddress
import logging
import socket
import subprocess
from typing import Optional

import icmplib
from sqlalchemy.orm import Session

from models.network import Network
from models.nic import Nic
from services.oui import lookup_manufacturer

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ARP / neighbour table reader
# ---------------------------------------------------------------------------

def _read_arp_table() -> dict[str, str]:
    """
    Return {ip: mac} for all known neighbours (IPv4 only).
    Tries `ip neigh show` first (covers REACHABLE, STALE, DELAY, PROBE),
    then falls back to /proc/net/arp.
    MAC is normalised to lowercase colon-separated (aa:bb:cc:dd:ee:ff).
    """
    result: dict[str, str] = {}

    # Primary: `ip neigh show`
    try:
        out = subprocess.check_output(
            ["ip", "neigh", "show"],
            text=True, timeout=5, stderr=subprocess.DEVNULL,
        )
        for line in out.splitlines():
            # Format: IP dev IFACE [lladdr MAC] state STATE
            parts = line.split()
            if len(parts) < 4 or "lladdr" not in parts:
                continue
            ip = parts[0]
            # Skip IPv6 addresses — only want IPv4 for scanner cross-reference
            if ":" in ip:
                continue
            idx = parts.index("lladdr")
            mac = parts[idx + 1].lower()
            if mac and mac != "00:00:00:00:00:00":
                result[ip] = mac
        log.info(f"ARP table (ip neigh): {len(result)} IPv4 entries")
        if result:
            return result
    except Exception as e:
        log.warning(f"ip neigh show failed: {e}")

    # Fallback: /proc/net/arp
    try:
        with open("/proc/net/arp") as f:
            for line in f:
                parts = line.split()
                # Format: IP HW_type Flags MAC Mask Device
                if len(parts) < 4 or parts[0] == "IP":
                    continue
                ip, flags, mac = parts[0], parts[2], parts[3]
                if flags == "0x0" or mac in ("00:00:00:00:00:00", ""):
                    continue
                result[ip] = mac.lower()
        log.info(f"ARP table (/proc/net/arp): {len(result)} entries")
    except FileNotFoundError:
        log.warning("/proc/net/arp not available — MAC lookup skipped")
    except Exception as e:
        log.warning(f"ARP table read failed: {e}")

    return result


# ---------------------------------------------------------------------------
# Reverse DNS — parallel resolution with per-host timeout
# ---------------------------------------------------------------------------

def _reverse_dns_sync(ip: str) -> Optional[str]:
    """Blocking reverse DNS lookup — called from a thread."""
    old = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(1.5)
        hostname, _, _ = socket.gethostbyaddr(ip)
        return hostname
    except Exception:
        return None
    finally:
        socket.setdefaulttimeout(old)


async def _resolve_all_hostnames(ips: list[str]) -> dict[str, Optional[str]]:
    """Resolve all hostnames concurrently, each capped at 1.5 s."""
    async def _one(ip: str) -> tuple[str, Optional[str]]:
        try:
            name = await asyncio.wait_for(
                asyncio.to_thread(_reverse_dns_sync, ip),
                timeout=2.0,
            )
            return ip, name
        except Exception:
            return ip, None

    pairs = await asyncio.gather(*[_one(ip) for ip in ips])
    return dict(pairs)


# ---------------------------------------------------------------------------
# DB cross-reference
# ---------------------------------------------------------------------------

def _build_db_index(db: Session) -> tuple[dict[str, dict], dict[str, dict]]:
    """
    Build two lookup dicts from the NIC table:
      ip_index  : {ip_address: {device_id, device_name, nic_label}}
      mac_index : {mac: {device_id, device_name, nic_label}}
    """
    from sqlalchemy.orm import joinedload

    nics = db.query(Nic).options(joinedload(Nic.device)).all()

    ip_index: dict[str, dict] = {}
    mac_index: dict[str, dict] = {}

    for nic in nics:
        if not nic.device:
            continue
        entry = {
            "device_id": nic.device_id,
            "device_name": nic.device.name,
            "nic_label": nic.label or f"NIC {nic.id}",
        }
        if nic.ip_address and nic.ip_address not in ("", "DHCP"):
            ip_index[nic.ip_address] = entry
        if nic.mac and nic.mac not in ("",):
            mac_index[nic.mac.lower()] = entry

    return ip_index, mac_index


def _build_net_infra_index(db: Session) -> dict[str, dict]:
    """
    Build a map of {ip: {role, network_name}} for IPs defined in network
    configuration: gateways and DNS servers across ALL networks.
    These are checked as a fallback when no device NIC matches.
    """
    index: dict[str, dict] = {}
    for net in db.query(Network).all():
        if net.gateway:
            index.setdefault(net.gateway, {"role": "Gateway", "network_name": net.name})
        if net.dns_primary:
            index.setdefault(net.dns_primary, {"role": "DNS Server", "network_name": net.name})
        if net.dns_secondary:
            # Only label as DNS if not already claimed by a more specific role
            index.setdefault(net.dns_secondary, {"role": "DNS Server", "network_name": net.name})
    return index


def _build_dhcp_ranges(db: Session) -> list[tuple]:
    """
    Return list of (start_addr, end_addr, network_name) for networks
    that have a DHCP range defined.
    """
    ranges = []
    for net in db.query(Network).filter(
        Network.dhcp_range_start.isnot(None),
        Network.dhcp_range_end.isnot(None),
    ).all():
        try:
            start = ipaddress.ip_address(net.dhcp_range_start)
            end = ipaddress.ip_address(net.dhcp_range_end)
            ranges.append((start, end, net.name))
        except ValueError:
            pass
    return ranges


def _check_dhcp_range(ip: str, dhcp_ranges: list[tuple]) -> Optional[str]:
    """Return network_name if ip falls within a known DHCP range, else None."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    for start, end, name in dhcp_ranges:
        if start <= addr <= end:
            return name
    return None


# ---------------------------------------------------------------------------
# Main scanner
# ---------------------------------------------------------------------------

async def scan_networks(db: Session, network_ids: list[int] | None = None) -> list[dict]:
    """
    Ping-sweep networks that have a CIDR defined, cross-reference results
    against the DB, and return a list of host dicts.

    network_ids: if provided, only scan those network IDs. If None/empty, scan all.

    Each host dict:
      {
        ip, hostname, mac, manufacturer,
        network_id, network_name, vlan_id,
        known: bool,
        device_id (if known), device_name (if known), nic_label (if known),
      }
    """
    # Collect networks with CIDRs
    q = db.query(Network).filter(Network.cidr.isnot(None))
    if network_ids:
        q = q.filter(Network.id.in_(network_ids))
    networks = q.all()
    if not networks:
        return []

    # Build IP list — all host addresses across all CIDRs (skip /32 and /31)
    ip_to_network: dict[str, Network] = {}
    for net in networks:
        try:
            cidr = ipaddress.ip_network(net.cidr, strict=False)
        except ValueError:
            continue
        if cidr.prefixlen >= 32:
            continue
        for addr in cidr.hosts():
            ip_to_network[str(addr)] = net

    if not ip_to_network:
        return []

    ip_list = list(ip_to_network.keys())
    log.info(f"Network scan: pinging {len(ip_list)} addresses across {len(networks)} subnet(s)")

    # Ping sweep
    try:
        ping_results = await asyncio.to_thread(
            icmplib.multiping,
            ip_list,
            count=1,
            timeout=2,
            concurrent_tasks=min(len(ip_list), 200),
            privileged=True,
        )
    except Exception as e:
        log.error(f"Network scan multiping failed: {e}")
        return []

    alive_ips = {r.address for r in ping_results if r.is_alive}

    if not alive_ips:
        return []

    log.info(f"Network scan: {len(alive_ips)} host(s) responded")

    # Build all lookup tables
    ip_index, mac_index = _build_db_index(db)
    infra_index = _build_net_infra_index(db)
    dhcp_ranges = _build_dhcp_ranges(db)

    # Pi-hole network devices — tracks all DNS clients by MAC (works without being DHCP server)
    from services.pihole_client import fetch_pihole_network_devices
    pihole_devices = await fetch_pihole_network_devices(db)
    log.info(f"Pi-hole network devices: {len(pihole_devices)} IPs with data "
             f"({sum(1 for v in pihole_devices.values() if v.get('mac'))} with real MACs)")

    # ARP table — fallback for hosts not seen by Pi-hole (static IPs, infra)
    arp_table = await asyncio.to_thread(_read_arp_table)
    log.info(f"ARP table: {len(arp_table)} entries")

    alive_sorted = sorted(alive_ips, key=lambda x: ipaddress.ip_address(x))

    # Resolve hostnames only for IPs Pi-hole doesn't know about
    needs_rdns = [ip for ip in alive_sorted if not pihole_devices.get(ip, {}).get("hostname")]
    rdns_map = await _resolve_all_hostnames(needs_rdns)

    results = []
    for ip in alive_sorted:
        pi_dev = pihole_devices.get(ip)

        # MAC: Pi-hole → ARP table → None
        mac = (pi_dev.get("mac") if pi_dev else None) or arp_table.get(ip) or None

        # Hostname: Pi-hole → reverse DNS → None
        hostname = (pi_dev.get("hostname") if pi_dev else None) or rdns_map.get(ip)

        # Manufacturer: Pi-hole macVendor (more complete) → our OUI lookup → None
        manufacturer = (pi_dev.get("manufacturer") if pi_dev else None) or (lookup_manufacturer(mac) if mac else None)

        net = ip_to_network.get(ip)

        # 1. Check device NICs (IP match, then MAC match)
        mac_norm = mac.lower() if mac else None
        db_match = ip_index.get(ip) or (mac_index.get(mac_norm) if mac_norm else None)

        # 2. Check network infrastructure (gateway, DNS) as fallback
        infra_match = None if db_match else infra_index.get(ip)

        # 3. Check DHCP range if still unmatched
        # Always check DHCP range — a known device can still be in a DHCP range
        dhcp_network = _check_dhcp_range(ip, dhcp_ranges)

        known = bool(db_match or infra_match)

        host: dict = {
            "ip": ip,
            "hostname": hostname,
            "mac": mac,
            "manufacturer": manufacturer,
            "network_id": net.id if net else None,
            "network_name": net.name if net else None,
            "vlan_id": net.vlan_id if net else None,
            "known": known,
            "dhcp_lease": bool(dhcp_network),
        }

        if db_match:
            host["device_id"] = db_match["device_id"]
            host["device_name"] = db_match["device_name"]
            host["nic_label"] = db_match["nic_label"]
        elif infra_match:
            host["role"] = infra_match["role"]

        results.append(host)

    # Sort: truly unknown non-DHCP first, DHCP leases next, known last
    # Within each group sort by IP
    def _sort_key(h: dict):
        if h["known"]:
            return (2, ipaddress.ip_address(h["ip"]))
        if h["dhcp_lease"]:
            return (1, ipaddress.ip_address(h["ip"]))
        return (0, ipaddress.ip_address(h["ip"]))

    results.sort(key=_sort_key)
    return results
