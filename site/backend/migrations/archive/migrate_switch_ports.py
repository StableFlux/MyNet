"""
One-time migration: parse existing nics.switch_port text values into switch_ports records
and back-link nics.switch_port_id.

Text format observed in DB: "DeviceName:PortNumber"  e.g. "USW-48-PoE#01:13"

Run once via:  docker exec mynet_dev_backend python migrations/migrate_switch_ports.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from models.device import Device
from models.nic import Nic
from models.switch_port import SwitchPort, PortType

# Map of known device name fragments → device name in DB (case-insensitive prefix match)
# Script auto-discovers by querying devices — no hardcoding needed.

SFP_THRESHOLD = {
    # device name fragment: first SFP port number
    # if port_number >= threshold it's SFP/SFP+
    # Ubiquiti USW-48-PoE: ports 1-48 RJ45, 49-50 SFP, 51-52 SFP+
    "USW-48": (49, 50, 52),   # (sfp_start, sfp_plus_start, total)
    "USW-16": (17, 17, 20),
    "USW-Flex-Mini": (5, 6, 5),
    "US-8":   (7, 9, 8),
    "UDM-SE": (9, 11, 12),
    "U6":     (1, 99, 4),
    "WS-C3850-48": (49, 99, 52),
    "WS-C3850-24": (25, 99, 28),
}


def infer_port_type(device_name: str, port_number: int) -> PortType:
    for fragment, (sfp_start, sfp_plus_start, _) in SFP_THRESHOLD.items():
        if fragment.lower() in device_name.lower():
            if port_number >= sfp_plus_start:
                return PortType.sfp_plus
            if port_number >= sfp_start:
                return PortType.sfp
            return PortType.rj45
    return PortType.rj45


def run():
    db = SessionLocal()
    try:
        nics_with_text = db.query(Nic).filter(
            Nic.switch_port != None,
            Nic.switch_port != '',
            Nic.switch_port_id == None,
        ).all()

        print(f"Found {len(nics_with_text)} NICs with legacy switch_port text")

        # Build device lookup by name
        all_devices = db.query(Device).all()
        device_by_name = {d.name: d for d in all_devices}

        # Cache: (device_id, port_number) → SwitchPort
        port_cache: dict[tuple[int, int], SwitchPort] = {}
        for sp in db.query(SwitchPort).all():
            port_cache[(sp.device_id, sp.port_number)] = sp

        migrated = 0
        skipped = 0

        for nic in nics_with_text:
            text = nic.switch_port.strip()
            if ':' not in text:
                print(f"  SKIP NIC {nic.id}: unrecognised format '{text}'")
                skipped += 1
                continue

            device_part, port_part = text.rsplit(':', 1)
            try:
                port_number = int(port_part)
            except ValueError:
                print(f"  SKIP NIC {nic.id}: non-numeric port '{port_part}'")
                skipped += 1
                continue

            # Find switch device — try exact match first, then partial
            switch_device = device_by_name.get(device_part)
            if not switch_device:
                # Try replacing # with ' #' (e.g. "USW-48-PoE#01" → "USW-48-PoE #01")
                alt = device_part.replace('#', ' #')
                switch_device = device_by_name.get(alt)
            if not switch_device:
                print(f"  SKIP NIC {nic.id}: switch device not found for '{device_part}'")
                skipped += 1
                continue

            key = (switch_device.id, port_number)
            if key not in port_cache:
                ptype = infer_port_type(switch_device.name, port_number)
                sp = SwitchPort(
                    device_id=switch_device.id,
                    port_number=port_number,
                    port_type=ptype,
                    poe_enabled=False,
                )
                db.add(sp)
                db.flush()
                port_cache[key] = sp
                print(f"  Created {sp.label} ({ptype.value}) on {switch_device.name}")

            nic.switch_port_id = port_cache[key].id
            migrated += 1

        db.commit()
        print(f"\nDone — {migrated} NICs migrated, {skipped} skipped")

    finally:
        db.close()


if __name__ == "__main__":
    run()
