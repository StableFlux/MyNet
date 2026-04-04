"""
Tests for _sync_nics() in routers/devices.py.
Verifies that monitor_nic_ids and monitor_target_nic_id are correctly
remapped to new NIC IDs after the delete-and-recreate cycle.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
import models  # noqa: F401
from models.device import Device, DeviceStatus
from models.nic import Nic, NicType, AddressType
from routers.devices import NicIn, _sync_nics


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _make_device(db, monitoring_enabled=True):
    d = Device(
        name="Test Device",
        status=DeviceStatus.in_service,
        monitoring_enabled=monitoring_enabled,
    )
    db.add(d)
    db.flush()
    return d


def _make_nic(db, device_id, nic_type=NicType.eth, ip="192.168.1.10"):
    n = Nic(device_id=device_id, nic_type=nic_type, address_type=AddressType.static,
            ip_address=ip)
    db.add(n)
    db.flush()
    return n


def _nic_in(nic_type=NicType.eth, ip="192.168.1.10"):
    return NicIn(
        nic_type=nic_type,
        address_type=AddressType.static,
        ip_address=ip,
        label=None, mac=None, dns_entry=None, notes=None, network_id=None,
        switch_port_id=None, band=None, ssid=None,
        gateway=None, subnet_mask=None, dns_server_1=None, dns_server_2=None,
    )


# ---------------------------------------------------------------------------

class TestMonitorNicIdsRemap:
    def test_monitored_nic_remapped_by_type_and_ip(self, db):
        device = _make_device(db)
        old_nic = _make_nic(db, device.id, NicType.eth, "10.0.0.1")
        device.monitor_nic_ids = [old_nic.id]
        db.flush()

        _sync_nics(device, [_nic_in(NicType.eth, "10.0.0.1")], db)

        assert device.monitor_nic_ids is not None
        assert len(device.monitor_nic_ids) == 1
        new_id = device.monitor_nic_ids[0]
        new_nic = db.get(Nic, new_id)
        # The remapped NIC must exist and have the matching IP
        assert new_nic is not None
        assert new_nic.ip_address == "10.0.0.1"
        assert new_nic.nic_type == NicType.eth

    def test_monitored_nic_cleared_when_removed(self, db):
        device = _make_device(db)
        old_nic = _make_nic(db, device.id, NicType.eth, "10.0.0.1")
        device.monitor_nic_ids = [old_nic.id]
        db.flush()

        # Sync with a completely different NIC
        _sync_nics(device, [_nic_in(NicType.wifi, "10.0.0.2")], db)

        assert device.monitor_nic_ids is None

    def test_multiple_monitored_nics_remapped(self, db):
        device = _make_device(db)
        nic1 = _make_nic(db, device.id, NicType.eth, "10.0.0.1")
        nic2 = _make_nic(db, device.id, NicType.eth, "10.0.0.2")
        device.monitor_nic_ids = [nic1.id, nic2.id]
        db.flush()

        _sync_nics(device, [
            _nic_in(NicType.eth, "10.0.0.1"),
            _nic_in(NicType.eth, "10.0.0.2"),
        ], db)

        assert device.monitor_nic_ids is not None
        assert len(device.monitor_nic_ids) == 2

    def test_unmonitored_device_unchanged(self, db):
        device = _make_device(db)
        device.monitor_nic_ids = None
        _make_nic(db, device.id)
        db.flush()

        _sync_nics(device, [_nic_in()], db)

        assert device.monitor_nic_ids is None


class TestMonitorTargetNicIdRemap:
    def test_target_nic_remapped(self, db):
        device = _make_device(db)
        old_nic = _make_nic(db, device.id, NicType.eth, "10.0.0.5")
        device.monitor_target_nic_id = old_nic.id
        db.flush()

        _sync_nics(device, [_nic_in(NicType.eth, "10.0.0.5")], db)

        assert device.monitor_target_nic_id is not None
        new_nic = db.get(Nic, device.monitor_target_nic_id)
        # The remapped NIC must exist and have the matching IP
        assert new_nic is not None
        assert new_nic.ip_address == "10.0.0.5"
        assert new_nic.nic_type == NicType.eth

    def test_target_nic_cleared_when_removed(self, db):
        device = _make_device(db)
        old_nic = _make_nic(db, device.id, NicType.eth, "10.0.0.5")
        device.monitor_target_nic_id = old_nic.id
        db.flush()

        # NIC no longer present after sync
        _sync_nics(device, [_nic_in(NicType.wifi, "10.0.0.99")], db)

        assert device.monitor_target_nic_id is None

    def test_target_nic_none_stays_none(self, db):
        device = _make_device(db)
        device.monitor_target_nic_id = None
        _make_nic(db, device.id)
        db.flush()

        _sync_nics(device, [_nic_in()], db)

        assert device.monitor_target_nic_id is None
