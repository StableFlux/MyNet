"""
apply_migrations(engine) — safe schema migrations for MyNet.

Runs on every startup (called from main.py lifespan, after create_all).
Each block is idempotent: columns/tables are only added/dropped if the
current state requires it. Safe to run against an empty DB or any prior version.

Adding a new migration:
  1. Add a PRAGMA table_info guard at the bottom of the relevant section.
  2. Document what it adds and why.
  3. Never remove old guards — they protect users upgrading from any version.
"""
import logging
from sqlalchemy import text

log = logging.getLogger(__name__)


def apply_migrations(engine) -> None:
    with engine.connect() as conn:

        # ── Drop removed tables ───────────────────────────────────────────────
        conn.execute(text("DROP TABLE IF EXISTS network_topology"))
        conn.execute(text("DROP TABLE IF EXISTS device_relationships"))
        conn.execute(text("DROP TABLE IF EXISTS location_categories"))
        conn.commit()

        # ── devices: rename password_encrypted → password ─────────────────────
        device_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(devices)"))}
        if "password_encrypted" in device_cols and "password" not in device_cols:
            conn.execute(text("ALTER TABLE devices RENAME COLUMN password_encrypted TO password"))
            conn.commit()
            device_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(devices)"))}

        # ── system_settings: encryption columns ───────────────────────────────
        ss_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(system_settings)"))}
        if "encryption_enabled" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN encryption_enabled BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
        if "encryption_salt" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN encryption_salt VARCHAR"))
            conn.commit()
        if "encryption_verification" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN encryption_verification VARCHAR"))
            conn.commit()

        # ── system_settings: pihole columns ──────────────────────────────────
        ss_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(system_settings)"))}
        if "pihole1_url" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN pihole1_url VARCHAR"))
            conn.commit()
        if "pihole1_password" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN pihole1_password VARCHAR"))
            conn.commit()
        if "pihole2_url" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN pihole2_url VARCHAR"))
            conn.commit()
        if "pihole2_password" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN pihole2_password VARCHAR"))
            conn.commit()
        if "pihole_poll_interval_secs" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN pihole_poll_interval_secs INTEGER NOT NULL DEFAULT 300"))
            conn.commit()

        # ── networks ──────────────────────────────────────────────────────────
        net_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(networks)"))}
        if "dns_auto" not in net_cols:
            conn.execute(text("ALTER TABLE networks ADD COLUMN dns_auto BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
        if "dns_extra" not in net_cols:
            conn.execute(text("ALTER TABLE networks ADD COLUMN dns_extra JSON"))
            conn.commit()

        # ── nics ──────────────────────────────────────────────────────────────
        nic_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(nics)"))}
        if "switch_port_id" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN switch_port_id INTEGER REFERENCES switch_ports(id)"))
            conn.commit()
        if "gateway" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN gateway VARCHAR"))
            conn.commit()
        if "subnet_mask" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN subnet_mask VARCHAR"))
            conn.commit()
        if "dns_server_1" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN dns_server_1 VARCHAR"))
            conn.commit()
        if "dns_server_2" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN dns_server_2 VARCHAR"))
            conn.commit()

        # ── switch_ports ──────────────────────────────────────────────────────
        sp_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(switch_ports)"))}
        if "is_management" not in sp_cols:
            conn.execute(text("ALTER TABLE switch_ports ADD COLUMN is_management BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
        if "mgmt_network_id" not in sp_cols:
            conn.execute(text("ALTER TABLE switch_ports ADD COLUMN mgmt_network_id INTEGER REFERENCES networks(id)"))
            conn.commit()
        if "mgmt_ip_address" not in sp_cols:
            conn.execute(text("ALTER TABLE switch_ports ADD COLUMN mgmt_ip_address VARCHAR"))
            conn.commit()

        # ── device_types ──────────────────────────────────────────────────────
        dt_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(device_types)"))}
        if "is_infrastructure" not in dt_cols:
            conn.execute(text("ALTER TABLE device_types ADD COLUMN is_infrastructure BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()

        # ── devices: additional columns ───────────────────────────────────────
        # Re-read after the rename above may have changed the set.
        device_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(devices)"))}
        if "monitor_nic_ids" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN monitor_nic_ids JSON"))
            conn.commit()
        if "port_display_rows" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN port_display_rows INTEGER DEFAULT 2"))
            conn.commit()
        if "port_numbering" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN port_numbering VARCHAR DEFAULT 'alternating'"))
            conn.commit()
        if "uplink_port_id" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN uplink_port_id INTEGER REFERENCES switch_ports(id)"))
            conn.commit()
        if "upstream_device_id" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN upstream_device_id INTEGER REFERENCES devices(id)"))
            conn.commit()
        if "upstream_port_id" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN upstream_port_id INTEGER REFERENCES switch_ports(id)"))
            conn.commit()
        if "services" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN services JSON"))
            conn.commit()
        if "hardware_type" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN hardware_type VARCHAR"))
            conn.commit()
        if "pihole_enabled" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN pihole_enabled BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
        if "pihole_nic_id" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN pihole_nic_id INTEGER REFERENCES nics(id)"))
            conn.commit()
        if "pihole_password" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN pihole_password VARCHAR"))
            conn.commit()

        # ── pihole_cache: additional columns ─────────────────────────────────
        pc_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(pihole_cache)"))}
        if "domains_on_blocklist" not in pc_cols:
            conn.execute(text("ALTER TABLE pihole_cache ADD COLUMN domains_on_blocklist INTEGER"))
            conn.commit()
        if "top_blocked" not in pc_cols:
            conn.execute(text("ALTER TABLE pihole_cache ADD COLUMN top_blocked JSON"))
            conn.commit()
        if "reachable" not in pc_cols:
            conn.execute(text("ALTER TABLE pihole_cache ADD COLUMN reachable BOOLEAN"))
            conn.commit()
        if "last_error" not in pc_cols:
            conn.execute(text("ALTER TABLE pihole_cache ADD COLUMN last_error VARCHAR"))
            conn.commit()
        if "blocking_enabled" not in pc_cols:
            conn.execute(text("ALTER TABLE pihole_cache ADD COLUMN blocking_enabled BOOLEAN"))
            conn.commit()
        if "version" not in pc_cols:
            conn.execute(text("ALTER TABLE pihole_cache ADD COLUMN version VARCHAR"))
            conn.commit()
        # ── system_settings: colour columns ──────────────────────────────────
        ss_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(system_settings)"))}
        if "location_type_colors" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN location_type_colors JSON"))
            conn.commit()
        if "device_category_colors" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN device_category_colors JSON"))
            conn.commit()
        if "device_status_colors" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN device_status_colors JSON"))
            conn.commit()

        if "location_id" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN location_id INTEGER REFERENCES locations(id)"))
            conn.commit()
            # One-time data migration: resolve existing location strings to FK IDs.
            # Devices whose location string doesn't match any Location row keep location_id = NULL.
            conn.execute(text("""
                UPDATE devices
                SET location_id = (
                    SELECT id FROM locations WHERE name = devices.location
                )
                WHERE location IS NOT NULL
            """))
            conn.commit()
            log.info("apply_migrations: location_id column added and populated from location strings")

        if "storage_location_id" not in device_cols:
            conn.execute(text("ALTER TABLE devices ADD COLUMN storage_location_id INTEGER REFERENCES locations(id)"))
            conn.commit()
            conn.execute(text("""
                UPDATE devices
                SET storage_location_id = (
                    SELECT id FROM locations WHERE name = devices.storage_location
                )
                WHERE storage_location IS NOT NULL
            """))
            conn.commit()
            log.info("apply_migrations: storage_location_id column added and populated")

        # ── devices: always reconcile location_id from location name ─────────
        # Keeps location_id in sync even if devices were created/edited by old
        # code paths that didn't set the FK, or if location names were changed.
        conn.execute(text("""
            UPDATE devices
            SET location_id = (SELECT id FROM locations WHERE name = devices.location)
            WHERE location IS NOT NULL
        """))
        conn.execute(text("""
            UPDATE devices SET location_id = NULL WHERE location IS NULL
        """))
        conn.execute(text("""
            UPDATE devices
            SET storage_location_id = (SELECT id FROM locations WHERE name = devices.storage_location)
            WHERE storage_location IS NOT NULL
        """))
        conn.execute(text("""
            UPDATE devices SET storage_location_id = NULL WHERE storage_location IS NULL
        """))
        conn.commit()

        # ── device_types: clear 'Undeployed' category (replaced by status) ───
        conn.execute(text(
            "UPDATE device_types SET category = NULL WHERE category = 'Undeployed'"
        ))
        conn.commit()

        # ── device_types: remove 'Storage' type (stock status covers this) ───
        conn.execute(text(
            "UPDATE devices SET device_type_id = NULL "
            "WHERE device_type_id IN (SELECT id FROM device_types WHERE name = 'Storage')"
        ))
        conn.execute(text("DELETE FROM device_types WHERE name = 'Storage'"))
        conn.commit()
