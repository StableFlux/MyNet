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
        if "inter_vlan_rules" in net_cols:
            conn.execute(text("ALTER TABLE networks DROP COLUMN inter_vlan_rules"))
            conn.commit()
            log.info("apply_migrations: networks.inter_vlan_rules dropped")
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

        if "mac_conflict_suppressed" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN mac_conflict_suppressed BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
        if "transceiver_type" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN transceiver_type VARCHAR"))
            conn.commit()
        if "transceiver_speed" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN transceiver_speed VARCHAR"))
            conn.commit()
        if "connection_type" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN connection_type VARCHAR"))
            conn.execute(text("UPDATE nics SET connection_type = 'built-in' WHERE nic_type IN ('ETH', 'WIFI')"))
            conn.commit()
            log.info("apply_migrations: connection_type added, existing ETH/WIFI NICs set to built-in")
        if "nic_speed" not in nic_cols:
            conn.execute(text("ALTER TABLE nics ADD COLUMN nic_speed VARCHAR"))
            conn.execute(text("UPDATE nics SET nic_speed = '1GbE' WHERE nic_type = 'ETH'"))
            conn.commit()
            log.info("apply_migrations: nic_speed added, existing ETH NICs set to 1GbE")

        # ── switch_ports ──────────────────────────────────────────────────────
        sp_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(switch_ports)"))}
        if "port_mode" not in sp_cols:
            conn.execute(text("ALTER TABLE switch_ports ADD COLUMN port_mode VARCHAR NOT NULL DEFAULT 'lan'"))
            conn.commit()
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

        # ── events table (unified audit + alert system) ───────────────────────
        tables = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
        if "events" not in tables:
            conn.execute(text("""
                CREATE TABLE events (
                    id INTEGER PRIMARY KEY,
                    severity VARCHAR NOT NULL,
                    category VARCHAR NOT NULL,
                    event_type VARCHAR NOT NULL,
                    entity_type VARCHAR,
                    entity_id INTEGER,
                    entity_name VARCHAR(255),
                    message TEXT NOT NULL,
                    detail JSON,
                    username VARCHAR(100),
                    user_id INTEGER,
                    created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
                    resolved_at DATETIME,
                    resolved_by VARCHAR(100),
                    acknowledged_at DATETIME,
                    acknowledged_by INTEGER
                )
            """))
            conn.execute(text("CREATE INDEX ix_events_severity ON events (severity)"))
            conn.execute(text("CREATE INDEX ix_events_category ON events (category)"))
            conn.execute(text("CREATE INDEX ix_events_event_type ON events (event_type)"))
            conn.execute(text("CREATE INDEX ix_events_entity_type ON events (entity_type)"))
            conn.execute(text("CREATE INDEX ix_events_entity_id ON events (entity_id)"))
            conn.execute(text("CREATE INDEX ix_events_created_at ON events (created_at)"))
            conn.execute(text("CREATE INDEX ix_events_resolved_at ON events (resolved_at)"))
            conn.commit()
            log.info("apply_migrations: events table created")

            # Migrate audit_log → events (info severity, resolved immediately)
            if "audit_log" in tables:
                conn.execute(text("""
                    INSERT INTO events (severity, category, event_type, entity_type, entity_id, entity_name, message, detail, username, user_id, created_at, resolved_at, resolved_by)
                    SELECT
                        'info',
                        CASE entity_type WHEN 'network' THEN 'network' ELSE 'device' END,
                        CASE action
                            WHEN 'create' THEN CASE entity_type WHEN 'network' THEN 'network_created' ELSE 'device_created' END
                            WHEN 'update' THEN CASE entity_type WHEN 'network' THEN 'network_updated' ELSE 'device_updated' END
                            WHEN 'delete' THEN CASE entity_type WHEN 'network' THEN 'network_deleted' ELSE 'device_deleted' END
                            WHEN 'deploy' THEN 'device_deployed'
                            WHEN 'import_csv' THEN 'device_imported'
                            ELSE 'device_updated'
                        END,
                        entity_type,
                        entity_id,
                        entity_name,
                        COALESCE(entity_type, '') || ' ' || COALESCE(action, '') || ': ' || COALESCE(entity_name, ''),
                        CASE WHEN new_values IS NOT NULL OR old_values IS NOT NULL
                            THEN json_object('old_values', old_values, 'new_values', new_values, 'changed_fields', changed_fields)
                            ELSE NULL END,
                        username,
                        user_id,
                        timestamp,
                        timestamp,
                        'system'
                    FROM audit_log
                """))
                conn.commit()
                log.info("apply_migrations: migrated audit_log → events")

            # Migrate alerts → events
            if "alerts" in tables:
                conn.execute(text("""
                    INSERT INTO events (severity, category, event_type, entity_type, entity_id, message, username, created_at, resolved_at, resolved_by, acknowledged_at, acknowledged_by)
                    SELECT
                        CASE severity WHEN 'critical' THEN 'critical' WHEN 'warning' THEN 'warning' ELSE 'info' END,
                        CASE alert_type
                            WHEN 'ip_conflict' THEN 'conflict'
                            WHEN 'mac_conflict' THEN 'conflict'
                            WHEN 'device_offline' THEN 'monitoring'
                            WHEN 'device_recovered' THEN 'monitoring'
                            ELSE 'system'
                        END,
                        CASE alert_type
                            WHEN 'ip_conflict' THEN 'ip_conflict'
                            WHEN 'mac_conflict' THEN 'mac_conflict'
                            WHEN 'device_offline' THEN 'device_offline'
                            WHEN 'device_recovered' THEN 'device_recovered'
                            ELSE 'system_startup'
                        END,
                        'device',
                        device_id,
                        message,
                        'system',
                        created_at,
                        acknowledged_at,
                        CASE WHEN acknowledged_at IS NOT NULL THEN 'acknowledged' ELSE NULL END,
                        acknowledged_at,
                        acknowledged_by
                    FROM alerts
                """))
                conn.commit()
                log.info("apply_migrations: migrated alerts → events")

        # ── wan_configs table ─────────────────────────────────────────────────
        tables = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
        if "wan_configs" not in tables:
            conn.execute(text("""
                CREATE TABLE wan_configs (
                    id INTEGER PRIMARY KEY,
                    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                    switch_port_id INTEGER NOT NULL UNIQUE REFERENCES switch_ports(id) ON DELETE CASCADE,
                    isp_name VARCHAR,
                    connection_type VARCHAR,
                    vlan_id INTEGER,
                    ip_address VARCHAR,
                    subnet_mask VARCHAR,
                    gateway VARCHAR,
                    pppoe_username VARCHAR,
                    pppoe_password VARCHAR,
                    mtu INTEGER,
                    dns_primary VARCHAR,
                    dns_secondary VARCHAR,
                    notes TEXT
                )
            """))
            conn.execute(text("CREATE INDEX ix_wan_configs_device_id ON wan_configs (device_id)"))
            conn.execute(text("CREATE INDEX ix_wan_configs_switch_port_id ON wan_configs (switch_port_id)"))
            conn.commit()
            log.info("apply_migrations: wan_configs table created")

        # ── wan_configs: add speed_down / speed_up / wan_ping_target columns ──
        wan_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(wan_configs)"))}
        if "speed_down" not in wan_cols:
            conn.execute(text("ALTER TABLE wan_configs ADD COLUMN speed_down VARCHAR"))
            conn.commit()
            log.info("apply_migrations: wan_configs.speed_down added")
        if "speed_up" not in wan_cols:
            conn.execute(text("ALTER TABLE wan_configs ADD COLUMN speed_up VARCHAR"))
            conn.commit()
            log.info("apply_migrations: wan_configs.speed_up added")
        if "wan_ping_target" not in wan_cols:
            conn.execute(text("ALTER TABLE wan_configs ADD COLUMN wan_ping_target VARCHAR"))
            conn.commit()
            log.info("apply_migrations: wan_configs.wan_ping_target added")
        if "wan_monitoring_enabled" not in wan_cols:
            conn.execute(text("ALTER TABLE wan_configs ADD COLUMN wan_monitoring_enabled BOOLEAN"))
            conn.commit()
            log.info("apply_migrations: wan_configs.wan_monitoring_enabled added")

        # ── system_settings: add wan_port_color ──────────────────────────────
        ss_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(system_settings)"))}
        if "wan_port_color" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN wan_port_color VARCHAR"))
            conn.commit()
            log.info("apply_migrations: system_settings.wan_port_color added")

        # ── system_settings: add dns_domain ──────────────────────────────────
        ss_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(system_settings)"))}
        if "dns_domain" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN dns_domain VARCHAR"))
            conn.commit()
            log.info("apply_migrations: system_settings.dns_domain added")

        # ── system_settings: add mynet_url (base URL for printable label QR codes) ──
        ss_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(system_settings)"))}
        if "mynet_url" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN mynet_url VARCHAR"))
            conn.commit()
            log.info("apply_migrations: system_settings.mynet_url added")

        # ── system_settings: UniFi integration columns ───────────────────────
        ss_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(system_settings)"))}
        if "unifi_host" not in ss_cols:
            # Migrate from old unifi_url column if it exists
            if "unifi_url" in ss_cols:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN unifi_host VARCHAR"))
                conn.execute(text("""
                    UPDATE system_settings
                    SET unifi_host = REPLACE(REPLACE(unifi_url, 'https://', ''), 'http://', '')
                    WHERE unifi_url IS NOT NULL
                """))
            else:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN unifi_host VARCHAR"))
            conn.commit()
            log.info("apply_migrations: system_settings.unifi_host added")
        if "unifi_api_key" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN unifi_api_key VARCHAR"))
            conn.commit()
            log.info("apply_migrations: system_settings.unifi_api_key added")
        if "unifi_auth_type" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN unifi_auth_type VARCHAR NOT NULL DEFAULT 'api_key'"))
            conn.commit()
            log.info("apply_migrations: system_settings.unifi_auth_type added")
        if "unifi_username" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN unifi_username VARCHAR"))
            conn.commit()
            log.info("apply_migrations: system_settings.unifi_username added")
        if "unifi_password" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN unifi_password VARCHAR"))
            conn.commit()
            log.info("apply_migrations: system_settings.unifi_password added")
        if "unifi_write_enabled" not in ss_cols:
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN unifi_write_enabled BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            log.info("apply_migrations: system_settings.unifi_write_enabled added")

        # ── drop old audit_log and alerts tables after migration ──────────────
        tables = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
        if "audit_log" in tables:
            conn.execute(text("DROP TABLE audit_log"))
            conn.commit()
            log.info("apply_migrations: dropped audit_log table")
        if "alerts" in tables:
            conn.execute(text("DROP TABLE alerts"))
            conn.commit()
            log.info("apply_migrations: dropped alerts table")
