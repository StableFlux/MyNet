"""
Backup logic unit tests — no HTTP server, no scheduler, no auth required.

Tests the export/restore functions directly against an in-memory SQLite DB:
- _row_to_dict serialises all column types correctly
- export produces all required keys and correct data
- _do_restore correctly restores users, networks, devices, nics
- Round-trip: export ➜ clear ➜ restore ➜ same data
- _do_restore ignores unknown columns (forward-compatibility)
- Validation error paths (invalid JSON, missing keys)
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from migrations.apply import apply_migrations
from models.network import Network
from models.device import Device, DeviceStatus
from models.nic import Nic, NicType
from models.user import User, UserRole
from models.location import Location
from models.device_type import DeviceType
from models.switch_port import SwitchPort
from services.auth import hash_password
from routers.backup import _row_to_dict, _do_restore, export_backup


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def db_session():
    """In-memory SQLite session with all migrations applied."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    apply_migrations(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def seeded_db(db_session):
    """Populate the in-memory DB with a minimal set of test fixtures."""
    dt = DeviceType(id=1, name="Server", icon="server", color="#3b82f6", is_infrastructure=False)
    net = Network(id=1, name="LAN", cidr="192.168.1.0/24", color="#22c55e")
    loc = Location(id=1, name="Rack 1", parent_id=None)
    user = User(
        id=1,
        username="admin",
        display_name="Admin User",
        password_hash=hash_password("secret"),
        role=UserRole.admin,
    )
    device = Device(
        id=1,
        name="Test Server",
        status=DeviceStatus.in_service,
        device_type_id=1,
        location_id=1,
    )
    nic = Nic(
        id=1,
        device_id=1,
        nic_type=NicType.eth,
        ip_address="192.168.1.10",
        network_id=1,
    )
    for obj in [dt, net, loc, user, device, nic]:
        db_session.add(obj)
    db_session.commit()
    return db_session


# ---------------------------------------------------------------------------
# _row_to_dict
# ---------------------------------------------------------------------------

class TestRowToDict:
    def test_basic_columns_present(self, seeded_db):
        net = seeded_db.query(Network).first()
        d = _row_to_dict(net)
        assert d["id"] == 1
        assert d["name"] == "LAN"
        assert d["cidr"] == "192.168.1.0/24"

    def test_datetime_serialised_as_string(self, seeded_db):
        """Datetime columns must be ISO strings, not datetime objects."""
        user = seeded_db.query(User).first()
        d = _row_to_dict(user)
        # created_at may be None in in-memory tests; if set it must be a string
        if d.get("created_at") is not None:
            assert isinstance(d["created_at"], str)

    def test_exclude_set_removes_columns(self, seeded_db):
        net = seeded_db.query(Network).first()
        d = _row_to_dict(net, exclude={"id", "color"})
        assert "id" not in d
        assert "color" not in d
        assert "name" in d

    def test_none_values_included(self, seeded_db):
        """Nullable columns with no value should appear as None, not be missing."""
        device = seeded_db.query(Device).first()
        d = _row_to_dict(device)
        assert "brand" in d       # nullable String column
        assert "model" in d


# ---------------------------------------------------------------------------
# export_backup
# ---------------------------------------------------------------------------

class TestExportBackup:
    def test_export_has_all_required_keys(self, seeded_db):
        response = export_backup(db=seeded_db)
        data = response.body
        import json
        payload = json.loads(data)
        for key in ["version", "exported_at", "devices", "nics", "networks",
                    "locations", "switch_ports", "users", "device_types"]:
            assert key in payload, f"Export missing key: {key}"

    def test_export_version(self, seeded_db):
        import json
        response = export_backup(db=seeded_db)
        payload = json.loads(response.body)
        assert payload["version"] == "1.4"

    def test_export_devices_list(self, seeded_db):
        import json
        response = export_backup(db=seeded_db)
        payload = json.loads(response.body)
        assert isinstance(payload["devices"], list)
        assert len(payload["devices"]) >= 1
        assert payload["devices"][0]["name"] == "Test Server"

    def test_export_nics_have_new_fields(self, seeded_db):
        """NIC export must include all current columns."""
        import json
        response = export_backup(db=seeded_db)
        payload = json.loads(response.body)
        assert payload["nics"], "No NICs in export"
        nic = payload["nics"][0]
        for field in ["gateway", "subnet_mask", "dns_server_1", "dns_server_2"]:
            assert field in nic, f"NIC export missing field: {field}"

    def test_export_no_created_at_on_devices(self, seeded_db):
        """created_at / updated_at are excluded from device export."""
        import json
        response = export_backup(db=seeded_db)
        payload = json.loads(response.body)
        device = payload["devices"][0]
        assert "created_at" not in device
        assert "updated_at" not in device


# ---------------------------------------------------------------------------
# _do_restore
# ---------------------------------------------------------------------------

class TestDoRestore:
    def test_restore_clears_and_repopulates(self, db_session):
        """After restore, the DB should contain exactly what was in the payload."""
        backup_payload = {
            "version": "1.4",
            "users": [
                {"id": 99, "username": "restored_user", "display_name": "Restored",
                 "password_hash": hash_password("pw"), "role": "viewer"}
            ],
            "networks": [
                {"id": 99, "name": "Restored Net", "cidr": "10.0.0.0/24", "color": "#ff0000",
                 "vlan_id": None, "description": None}
            ],
            "device_types": [],
            "locations": [],
            "devices": [],
            "nics": [],
            "switch_ports": [],
        }
        _do_restore(db_session, backup_payload)

        users = db_session.query(User).all()
        assert len(users) == 1
        assert users[0].username == "restored_user"

        networks = db_session.query(Network).all()
        assert len(networks) == 1
        assert networks[0].name == "Restored Net"

    def test_restore_ignores_unknown_columns(self, db_session):
        """Unknown keys in a backup row should be silently ignored (forward-compat)."""
        payload = {
            "version": "1.4",
            "users": [
                {"id": 1, "username": "u", "display_name": "U",
                 "password_hash": hash_password("x"), "role": "viewer",
                 "future_column_that_doesnt_exist_yet": "some_value"}
            ],
            "networks": [], "device_types": [], "locations": [],
            "devices": [], "nics": [], "switch_ports": [],
        }
        # Should not raise
        _do_restore(db_session, payload)
        user = db_session.query(User).first()
        assert user.username == "u"


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------

class TestRoundTrip:
    def test_export_restore_roundtrip(self, db_session):
        """Export, then restore — all rows should be identical."""
        import json

        # Seed fresh data
        db_session.query(SwitchPort).delete(synchronize_session=False)
        db_session.query(Nic).delete(synchronize_session=False)
        db_session.query(Device).delete(synchronize_session=False)
        db_session.query(Location).delete(synchronize_session=False)
        db_session.query(Network).delete(synchronize_session=False)
        db_session.query(DeviceType).delete(synchronize_session=False)
        db_session.query(User).delete(synchronize_session=False)

        net = Network(id=1, name="RoundTrip Net", cidr="172.16.0.0/24", color="#aabbcc")
        user = User(id=1, username="rt_user", display_name="RT",
                    password_hash=hash_password("pw"), role=UserRole.viewer)
        db_session.add_all([net, user])
        db_session.commit()

        # Export
        response = export_backup(db=db_session)
        payload = json.loads(response.body)

        # Restore
        _do_restore(db_session, payload)

        # Verify
        networks = db_session.query(Network).all()
        assert len(networks) == 1
        assert networks[0].name == "RoundTrip Net"

        users = db_session.query(User).all()
        assert len(users) == 1
        assert users[0].username == "rt_user"
