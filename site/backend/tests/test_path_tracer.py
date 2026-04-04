"""
Path tracer unit tests — in-memory SQLite, no HTTP server.

Tests services/path_tracer.py:
- Missing / unknown device IDs
- Direct two-device connection via uplink
- Multi-hop path (PC → switch → router)
- Connection via NIC → switch port (type="access")
- VM → hypervisor connection (type="vm")
- Port labels preserved at each hop
- BFS finds the shortest path when multiple routes exist
- VLAN boundary detection
- Disconnected topology returns found=False
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from migrations.apply import apply_migrations
from models.device import Device, DeviceStatus
from models.nic import Nic, NicType
from models.network import Network
from models.switch_port import SwitchPort, PortType
from services.path_tracer import trace_path


# ---------------------------------------------------------------------------
# DB fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    # SQLite FK support must be turned on per-connection
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(conn, _):
        conn.execute("PRAGMA foreign_keys = OFF")  # OFF so we can insert in any order

    Base.metadata.create_all(engine)
    apply_migrations(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


# ---------------------------------------------------------------------------
# Helper: commit + expire so relationships are re-loaded fresh
# ---------------------------------------------------------------------------

def _flush(db):
    db.commit()
    db.expire_all()


# ---------------------------------------------------------------------------
# Missing devices
# ---------------------------------------------------------------------------

class TestMissingDevices:
    def test_unknown_source_returns_not_found(self, db):
        device = Device(id=1, name="A", status=DeviceStatus.in_service)
        db.add(device)
        _flush(db)
        result = trace_path(db, 999, 1)
        assert result["found"] is False
        assert result["hops"] == []

    def test_unknown_target_returns_not_found(self, db):
        device = Device(id=1, name="A", status=DeviceStatus.in_service)
        db.add(device)
        _flush(db)
        result = trace_path(db, 1, 999)
        assert result["found"] is False

    def test_both_missing_returns_not_found(self, db):
        result = trace_path(db, 42, 99)
        assert result["found"] is False

    def test_disconnected_devices_returns_not_found(self, db):
        a = Device(id=1, name="A", status=DeviceStatus.in_service)
        b = Device(id=2, name="B", status=DeviceStatus.in_service)
        db.add_all([a, b])
        _flush(db)
        result = trace_path(db, 1, 2)
        assert result["found"] is False


# ---------------------------------------------------------------------------
# Direct uplink connection
# ---------------------------------------------------------------------------

class TestDirectUplink:
    def test_two_hops_via_uplink(self, db):
        """Switch ← (uplink) → Router"""
        router = Device(id=1, name="Router", status=DeviceStatus.in_service)
        switch = Device(id=2, name="Switch", status=DeviceStatus.in_service,
                        upstream_device_id=1)
        db.add_all([router, switch])
        _flush(db)

        result = trace_path(db, 2, 1)
        assert result["found"] is True
        assert len(result["hops"]) == 2
        assert result["hops"][0]["device_name"] == "Switch"
        assert result["hops"][1]["device_name"] == "Router"

    def test_path_is_bidirectional(self, db):
        """BFS edges are undirected — path from router to switch should also work."""
        router = Device(id=1, name="Router", status=DeviceStatus.in_service)
        switch = Device(id=2, name="Switch", status=DeviceStatus.in_service,
                        upstream_device_id=1)
        db.add_all([router, switch])
        _flush(db)

        result = trace_path(db, 1, 2)
        assert result["found"] is True
        assert len(result["hops"]) == 2

    def test_uplink_port_labels_preserved(self, db):
        """Port labels from uplink_port and upstream_port should appear in hops."""
        router = Device(id=1, name="Router", status=DeviceStatus.in_service)
        switch = Device(id=2, name="Switch", status=DeviceStatus.in_service)
        uplink_port = SwitchPort(id=1, device_id=2, port_number=8, port_type=PortType.sfp,
                                 port_name="Uplink")
        router_port = SwitchPort(id=2, device_id=1, port_number=1, port_type=PortType.eth)
        db.add_all([router, switch, uplink_port, router_port])
        db.flush()

        switch.upstream_device_id = 1
        switch.uplink_port_id = 1        # port on the switch
        switch.upstream_port_id = 2      # port on the router
        _flush(db)

        result = trace_path(db, 2, 1)
        assert result["found"] is True
        # exit_port on the RECEIVING hop is the port used to send to that device.
        # So hop[1] (router) carries the switch's uplink port label.
        router_hop = result["hops"][1]
        assert router_hop["exit_port"] is not None
        assert "8" in router_hop["exit_port"]  # "Port 8 / Uplink"


# ---------------------------------------------------------------------------
# NIC → switch port connection
# ---------------------------------------------------------------------------

class TestNicToSwitch:
    def test_access_connection_type(self, db):
        """PC's NIC plugged into a switch port → connection_type='access'"""
        switch = Device(id=1, name="Switch", status=DeviceStatus.in_service)
        pc = Device(id=2, name="PC", status=DeviceStatus.in_service)
        port = SwitchPort(id=1, device_id=1, port_number=3, port_type=PortType.eth)
        nic = Nic(id=1, device_id=2, nic_type=NicType.eth, switch_port_id=1)
        db.add_all([switch, pc, port, nic])
        _flush(db)

        result = trace_path(db, 2, 1)
        assert result["found"] is True
        assert len(result["hops"]) == 2
        # The edge connecting PC to switch is 'access'
        switch_hop = result["hops"][1]
        assert switch_hop["connection_type"] == "access"

    def test_nic_label_as_exit_port(self, db):
        switch = Device(id=1, name="Switch", status=DeviceStatus.in_service)
        pc = Device(id=2, name="PC", status=DeviceStatus.in_service)
        port = SwitchPort(id=1, device_id=1, port_number=5, port_type=PortType.eth)
        nic = Nic(id=1, device_id=2, nic_type=NicType.eth, switch_port_id=1, label="eth0")
        db.add_all([switch, pc, port, nic])
        _flush(db)

        result = trace_path(db, 2, 1)
        # The switch hop carries the NIC label as the exit_port (port used by PC to reach switch)
        switch_hop = result["hops"][1]
        assert switch_hop["exit_port"] == "eth0"


# ---------------------------------------------------------------------------
# VM → hypervisor
# ---------------------------------------------------------------------------

class TestVmHypervisor:
    def test_vm_connection_type(self, db):
        hypervisor = Device(id=1, name="Proxmox", status=DeviceStatus.in_service)
        vm = Device(id=2, name="VM-web", status=DeviceStatus.in_service,
                    hypervisor_device_id=1)
        db.add_all([hypervisor, vm])
        _flush(db)

        result = trace_path(db, 2, 1)
        assert result["found"] is True
        hypervisor_hop = result["hops"][1]
        assert hypervisor_hop["connection_type"] == "vm"


# ---------------------------------------------------------------------------
# Multi-hop path
# ---------------------------------------------------------------------------

class TestMultiHop:
    def test_three_hop_path(self, db):
        """PC → switch → router: 3 hops"""
        router = Device(id=1, name="Router", status=DeviceStatus.in_service)
        switch = Device(id=2, name="Switch", status=DeviceStatus.in_service,
                        upstream_device_id=1)
        pc = Device(id=3, name="PC", status=DeviceStatus.in_service)
        port = SwitchPort(id=1, device_id=2, port_number=1, port_type=PortType.eth)
        nic = Nic(id=1, device_id=3, nic_type=NicType.eth, switch_port_id=1)
        db.add_all([router, switch, pc, port, nic])
        _flush(db)

        result = trace_path(db, 3, 1)
        assert result["found"] is True
        assert len(result["hops"]) == 3
        names = [h["device_name"] for h in result["hops"]]
        assert names == ["PC", "Switch", "Router"]

    def test_device_names_in_hops(self, db):
        router = Device(id=1, name="Router", status=DeviceStatus.in_service)
        switch = Device(id=2, name="Switch", status=DeviceStatus.in_service,
                        upstream_device_id=1)
        db.add_all([router, switch])
        _flush(db)

        result = trace_path(db, 2, 1)
        assert result["hops"][0]["device_name"] == "Switch"
        assert result["hops"][1]["device_name"] == "Router"


# ---------------------------------------------------------------------------
# BFS shortest path
# ---------------------------------------------------------------------------

class TestShortestPath:
    def test_bfs_prefers_shorter_path(self, db):
        """
        Topology:
            PC ─── SwitchA ─── Router
            PC ─── SwitchA ─── SwitchB ─── Router  (longer route, via extra uplink)

        BFS should find the 3-hop path, not the 4-hop path.
        """
        router  = Device(id=1, name="Router",  status=DeviceStatus.in_service)
        switchA = Device(id=2, name="SwitchA", status=DeviceStatus.in_service,
                         upstream_device_id=1)
        switchB = Device(id=3, name="SwitchB", status=DeviceStatus.in_service,
                         upstream_device_id=1)   # also connected to router directly
        pc      = Device(id=4, name="PC",      status=DeviceStatus.in_service)

        # PC is plugged into SwitchA
        portA = SwitchPort(id=1, device_id=2, port_number=1, port_type=PortType.eth)
        nic   = Nic(id=1, device_id=4, nic_type=NicType.eth, switch_port_id=1)

        # SwitchA is also connected to SwitchB (so there's a longer path PC→A→B→Router)
        portA2 = SwitchPort(id=2, device_id=2, port_number=2, port_type=PortType.eth)
        switchB.upstream_device_id = 2  # SwitchB uplinks to SwitchA (making A→B reachable)

        db.add_all([router, switchA, switchB, pc, portA, portA2, nic])
        _flush(db)

        result = trace_path(db, 4, 1)
        assert result["found"] is True
        # Shortest: PC → SwitchA → Router (3 hops)
        assert len(result["hops"]) == 3


# ---------------------------------------------------------------------------
# VLAN boundary detection
# ---------------------------------------------------------------------------

class TestVlanBoundary:
    def test_no_vlan_boundary_same_vlan(self, db):
        lan = Network(id=1, name="LAN", cidr="192.168.1.0/24", color="#green", vlan_id=10)
        router = Device(id=1, name="Router", status=DeviceStatus.in_service)
        switch = Device(id=2, name="Switch", status=DeviceStatus.in_service,
                        upstream_device_id=1)
        pc = Device(id=3, name="PC", status=DeviceStatus.in_service)
        port = SwitchPort(id=1, device_id=2, port_number=1, port_type=PortType.eth)
        nic_pc = Nic(id=1, device_id=3, nic_type=NicType.eth, switch_port_id=1, network_id=1)
        nic_sw = Nic(id=2, device_id=2, nic_type=NicType.eth, network_id=1)
        nic_rt = Nic(id=3, device_id=1, nic_type=NicType.eth, network_id=1)
        db.add_all([lan, router, switch, pc, port, nic_pc, nic_sw, nic_rt])
        _flush(db)

        result = trace_path(db, 3, 1)
        assert result["found"] is True
        assert all(not h["is_vlan_boundary"] for h in result["hops"])

    def test_vlan_boundary_detected_on_transition(self, db):
        vlan10 = Network(id=1, name="VLAN10", cidr="10.10.0.0/24", color="#blue", vlan_id=10)
        vlan20 = Network(id=2, name="VLAN20", cidr="10.20.0.0/24", color="#red",  vlan_id=20)
        router = Device(id=1, name="Router", status=DeviceStatus.in_service)
        switch = Device(id=2, name="Switch", status=DeviceStatus.in_service,
                        upstream_device_id=1)
        pc     = Device(id=3, name="PC",     status=DeviceStatus.in_service)
        port = SwitchPort(id=1, device_id=2, port_number=1, port_type=PortType.eth)
        nic_pc = Nic(id=1, device_id=3, nic_type=NicType.eth, switch_port_id=1, network_id=1)
        nic_sw = Nic(id=2, device_id=2, nic_type=NicType.eth, network_id=1)
        # Router is on a different VLAN
        nic_rt = Nic(id=3, device_id=1, nic_type=NicType.eth, network_id=2)
        db.add_all([vlan10, vlan20, router, switch, pc, port, nic_pc, nic_sw, nic_rt])
        _flush(db)

        result = trace_path(db, 3, 1)
        assert result["found"] is True
        # At least one hop should be a VLAN boundary
        assert any(h["is_vlan_boundary"] for h in result["hops"])
