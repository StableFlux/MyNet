"""
Tests for migrations/apply.py — verifies idempotency.
Runs apply_migrations() twice on a fresh in-memory DB and asserts no errors.
Also verifies all expected columns are present after migration.
"""
import pytest
from sqlalchemy import create_engine, text

from database import Base
import models  # noqa: F401
from migrations.apply import apply_migrations


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(e)
    yield e


def get_cols(engine, table):
    with engine.connect() as conn:
        return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}


class TestMigrationIdempotency:
    def test_runs_twice_without_error(self, engine):
        apply_migrations(engine)
        apply_migrations(engine)  # second run must be a no-op

    def test_nics_has_new_columns(self, engine):
        apply_migrations(engine)
        cols = get_cols(engine, "nics")
        assert "gateway"      in cols
        assert "subnet_mask"  in cols
        assert "dns_server_1" in cols
        assert "dns_server_2" in cols
        assert "switch_port_id" in cols

    def test_switch_ports_has_mgmt_columns(self, engine):
        apply_migrations(engine)
        cols = get_cols(engine, "switch_ports")
        assert "is_management"   in cols
        assert "mgmt_network_id" in cols
        assert "mgmt_ip_address" in cols

    def test_devices_has_uplink_columns(self, engine):
        apply_migrations(engine)
        cols = get_cols(engine, "devices")
        assert "uplink_port_id"      in cols
        assert "upstream_device_id"  in cols
        assert "upstream_port_id"    in cols
        assert "port_display_rows"   in cols
        assert "port_numbering"      in cols
        assert "storage_location_id" in cols
        assert "location_id"         in cols
        assert "services"            in cols
        assert "hardware_type"       in cols

    def test_system_settings_has_encryption_columns(self, engine):
        apply_migrations(engine)
        cols = get_cols(engine, "system_settings")
        assert "encryption_enabled"      in cols
        assert "encryption_salt"         in cols
        assert "encryption_verification" in cols

    def test_system_settings_has_pihole_columns(self, engine):
        apply_migrations(engine)
        cols = get_cols(engine, "system_settings")
        assert "pihole1_url"              in cols
        assert "pihole1_password"         in cols
        assert "pihole2_url"              in cols
        assert "pihole2_password"         in cols
        assert "pihole_poll_interval_secs" in cols

    def test_device_types_has_infrastructure_column(self, engine):
        apply_migrations(engine)
        cols = get_cols(engine, "device_types")
        assert "is_infrastructure" in cols
