"""
Conflict checker — detects IP and MAC address conflicts across NICs.

Used in three places:
  1. Startup scan (called from main.py lifespan)
  2. Periodic scan every 10 minutes (scheduled in main.py)
  3. Device save/delete (create/update/delete) — returns conflict list for the frontend popup

Event lifecycle:
  - An ip_conflict / mac_conflict event is created when first detected (no active event exists for that entity)
  - Active conflict events are auto-resolved when the conflict disappears
  - MAC conflict events are suppressed for NICs with mac_conflict_suppressed=True
  - IP conflicts are always reported (never intentional)
"""
import ipaddress
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from models.nic import Nic
from models.device import Device
from models.network import Network
from models.event import Event, EventType
from services.events import log_event, resolve_events_by_type

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Conflict detection helpers
# ---------------------------------------------------------------------------

def _find_ip_conflicts(db: Session) -> list[dict]:
    """
    Return list of IP conflict groups: NICs sharing the same non-null, non-DHCP IP.
    Each entry: {ip, nics: [{nic_id, device_id, device_name, nic_label}]}
    """
    q = (
        db.query(Nic.ip_address, func.count(Nic.id).label("cnt"))
        .filter(Nic.ip_address.isnot(None), Nic.ip_address != "DHCP", Nic.ip_address != "")
        .group_by(Nic.ip_address)
        .having(func.count(Nic.id) > 1)
    )
    conflicts = []
    for ip, _ in q.all():
        nics = (
            db.query(Nic)
            .options(joinedload(Nic.device))
            .filter(Nic.ip_address == ip)
            .all()
        )
        conflicts.append({
            "type": "ip",
            "ip": ip,
            "nics": [
                {
                    "nic_id": n.id,
                    "device_id": n.device_id,
                    "device_name": n.device.name,
                    "nic_label": n.label or f"NIC {n.id}",
                }
                for n in nics
            ],
        })
    return conflicts


def _find_ip_out_of_subnet(db: Session) -> list[dict]:
    """
    Return NICs whose static IP does not fall within any defined network CIDR.
    Skips NICs with no IP, DHCP IPs, and cases where no networks have a CIDR defined.
    Each entry: {device_id, device_name, nic_id, nic_label, ip}
    """
    # Collect all valid CIDRs
    cidrs: list[ipaddress.IPv4Network] = []
    for net in db.query(Network).filter(Network.cidr.isnot(None)).all():
        try:
            cidrs.append(ipaddress.ip_network(net.cidr, strict=False))
        except ValueError:
            pass

    if not cidrs:
        return []

    results = []
    nics = (
        db.query(Nic)
        .options(joinedload(Nic.device))
        .filter(
            Nic.ip_address.isnot(None),
            Nic.ip_address != "",
            Nic.ip_address != "DHCP",
        )
        .all()
    )
    for nic in nics:
        try:
            addr = ipaddress.ip_address(nic.ip_address)
        except ValueError:
            continue
        if not any(addr in cidr for cidr in cidrs):
            results.append({
                "device_id": nic.device_id,
                "device_name": nic.device.name,
                "nic_id": nic.id,
                "nic_label": nic.label or f"NIC {nic.id}",
                "ip": nic.ip_address,
            })
    return results


def _find_mac_conflicts(db: Session) -> list[dict]:
    """
    Return list of MAC conflict groups: NICs sharing the same non-null MAC,
    excluding VIRT NICs and NICs with mac_conflict_suppressed=True.
    Each entry: {mac, nics: [{nic_id, device_id, device_name, nic_label, suppressed}]}
    """
    from models.nic import NicType
    q = (
        db.query(Nic.mac, func.count(Nic.id).label("cnt"))
        .filter(
            Nic.mac.isnot(None),
            Nic.mac != "",
            Nic.nic_type != NicType.virt,
        )
        .group_by(Nic.mac)
        .having(func.count(Nic.id) > 1)
    )
    conflicts = []
    for mac, _ in q.all():
        nics = (
            db.query(Nic)
            .options(joinedload(Nic.device))
            .filter(Nic.mac == mac, Nic.nic_type != NicType.virt)
            .all()
        )
        # Skip if all NICs in this group have suppressed the conflict
        if all(n.mac_conflict_suppressed for n in nics):
            continue
        conflicts.append({
            "type": "mac",
            "mac": mac,
            "nics": [
                {
                    "nic_id": n.id,
                    "device_id": n.device_id,
                    "device_name": n.device.name,
                    "nic_label": n.label or f"NIC {n.id}",
                    "suppressed": n.mac_conflict_suppressed,
                }
                for n in nics
            ],
        })
    return conflicts


# ---------------------------------------------------------------------------
# Conflict check for a specific device save (returns list for frontend popup)
# ---------------------------------------------------------------------------

def check_device_conflicts(db: Session, device_id: int) -> list[dict]:
    """
    Check only the NICs belonging to device_id for conflicts with other devices.
    Returns a flat list of conflict dicts suitable for the frontend popup.
    """
    from models.nic import NicType
    device_nics = db.query(Nic).filter(Nic.device_id == device_id).all()
    conflicts = []

    for nic in device_nics:
        # IP conflict
        if nic.ip_address and nic.ip_address not in ("DHCP", ""):
            others = (
                db.query(Nic)
                .options(joinedload(Nic.device))
                .filter(
                    Nic.ip_address == nic.ip_address,
                    Nic.device_id != device_id,
                )
                .all()
            )
            for other in others:
                conflicts.append({
                    "type": "ip",
                    "ip": nic.ip_address,
                    "nic_id": nic.id,
                    "nic_label": nic.label or f"NIC {nic.id}",
                    "conflicting_device_id": other.device_id,
                    "conflicting_device_name": other.device.name,
                    "conflicting_nic_label": other.label or f"NIC {other.id}",
                })

        # MAC conflict (skip VIRT, skip suppressed)
        if (
            nic.mac and nic.mac != ""
            and nic.nic_type != NicType.virt
            and not nic.mac_conflict_suppressed
        ):
            others = (
                db.query(Nic)
                .options(joinedload(Nic.device))
                .filter(
                    Nic.mac == nic.mac,
                    Nic.device_id != device_id,
                    Nic.nic_type != NicType.virt,
                )
                .all()
            )
            for other in others:
                conflicts.append({
                    "type": "mac",
                    "mac": nic.mac,
                    "nic_id": nic.id,
                    "nic_label": nic.label or f"NIC {nic.id}",
                    "conflicting_device_id": other.device_id,
                    "conflicting_device_name": other.device.name,
                    "conflicting_nic_label": other.label or f"NIC {other.id}",
                })

    return conflicts


# ---------------------------------------------------------------------------
# Periodic / startup scan
# ---------------------------------------------------------------------------

def run_conflict_scan(db: Session) -> None:
    """
    Full scan: raise new conflict events and auto-resolve stale ones.
    Called on startup, every 10 minutes, and after every device save/delete.
    """
    ip_conflicts = _find_ip_conflicts(db)
    mac_conflicts = _find_mac_conflicts(db)
    subnet_violations = _find_ip_out_of_subnet(db)

    # Build sets of currently conflicting device_ids
    ip_conflict_device_ids: set[int] = set()
    for c in ip_conflicts:
        for n in c["nics"]:
            ip_conflict_device_ids.add(n["device_id"])

    mac_conflict_device_ids: set[int] = set()
    for c in mac_conflicts:
        for n in c["nics"]:
            if not n["suppressed"]:
                mac_conflict_device_ids.add(n["device_id"])

    subnet_violation_device_ids: set[int] = {v["device_id"] for v in subnet_violations}

    # --- Raise new IP conflict events ---
    for c in ip_conflicts:
        for nic_info in c["nics"]:
            existing = (
                db.query(Event)
                .filter(
                    Event.event_type == EventType.ip_conflict,
                    Event.entity_id == nic_info["device_id"],
                    Event.resolved_at.is_(None),
                )
                .first()
            )
            if not existing:
                other_names = [n["device_name"] for n in c["nics"] if n["device_id"] != nic_info["device_id"]]
                log_event(
                    db, EventType.ip_conflict,
                    message=f"IP conflict: {nic_info['device_name']} shares IP {c['ip']} with {', '.join(other_names)}.",
                    entity_type="device",
                    entity_id=nic_info["device_id"],
                    entity_name=nic_info["device_name"],
                    detail={"ip": c["ip"], "conflicting_devices": other_names},
                )
                log.warning(f"IP conflict detected: {c['ip']} on device {nic_info['device_name']}")

    # --- Raise new MAC conflict events ---
    for c in mac_conflicts:
        for nic_info in c["nics"]:
            if nic_info["suppressed"]:
                continue
            existing = (
                db.query(Event)
                .filter(
                    Event.event_type == EventType.mac_conflict,
                    Event.entity_id == nic_info["device_id"],
                    Event.resolved_at.is_(None),
                )
                .first()
            )
            if not existing:
                other_names = [n["device_name"] for n in c["nics"] if n["device_id"] != nic_info["device_id"]]
                log_event(
                    db, EventType.mac_conflict,
                    message=f"MAC conflict: {nic_info['device_name']} shares MAC {c['mac']} with {', '.join(other_names)}.",
                    entity_type="device",
                    entity_id=nic_info["device_id"],
                    entity_name=nic_info["device_name"],
                    detail={"mac": c["mac"], "conflicting_devices": other_names},
                )
                log.warning(f"MAC conflict detected: {c['mac']} on device {nic_info['device_name']}")

    # --- Raise new subnet violation events ---
    for v in subnet_violations:
        existing = (
            db.query(Event)
            .filter(
                Event.event_type == EventType.ip_out_of_subnet,
                Event.entity_id == v["device_id"],
                Event.resolved_at.is_(None),
            )
            .first()
        )
        if not existing:
            log_event(
                db, EventType.ip_out_of_subnet,
                message=f"IP out of subnet: {v['device_name']} has IP {v['ip']} which does not belong to any defined network subnet.",
                entity_type="device",
                entity_id=v["device_id"],
                entity_name=v["device_name"],
                detail={"ip": v["ip"], "nic_label": v["nic_label"]},
            )
            log.warning(f"IP out of subnet: {v['ip']} on device {v['device_name']}")

    # --- Auto-resolve stale IP conflict events ---
    resolve_events_by_type(db, EventType.ip_conflict, exclude_entity_ids=ip_conflict_device_ids)

    # --- Auto-resolve stale MAC conflict events ---
    resolve_events_by_type(db, EventType.mac_conflict, exclude_entity_ids=mac_conflict_device_ids)

    # --- Auto-resolve stale subnet violation events ---
    resolve_events_by_type(db, EventType.ip_out_of_subnet, exclude_entity_ids=subnet_violation_device_ids)

    db.commit()
