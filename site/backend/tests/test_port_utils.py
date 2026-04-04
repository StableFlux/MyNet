"""
Tests for services/port_utils.py — resolve_port() logic.

Each test builds a minimal mock port/device graph and asserts that
resolve_port() returns the correct fields without hitting a real DB.
"""
from types import SimpleNamespace
from services.port_utils import resolve_port


def _port(**kwargs):
    """Build a minimal mock SwitchPort."""
    defaults = dict(
        id=1, device_id=1, port_number=1, port_name=None,
        port_type=SimpleNamespace(value="eth"),
        poe_enabled=False, poe_budget_w=None, speed=None,
        notes=None, label="Port 1", is_management=False,
        mgmt_network_id=None, mgmt_ip_address=None, mgmt_network=None,
        nics=[], downstream_devices=[],
    )
    defaults.update(kwargs)
    p = SimpleNamespace(**defaults)
    # device backref — overridden per test
    if "device" not in kwargs:
        p.device = SimpleNamespace(
            uplink_port_id=None, upstream_device=None,
            upstream_port=None, nics=[],
        )
    return p


def _nic(device_id=10, network=None, switch_port_id=None):
    return SimpleNamespace(
        device_id=device_id,
        network=network,
        switch_port_id=switch_port_id,
        label=None,
        nic_type=SimpleNamespace(value="ETH"),
        device=SimpleNamespace(name="Host"),
    )


def _network(vlan_id=10, color="#abc"):
    return SimpleNamespace(vlan_id=vlan_id, color=color)


# ---------------------------------------------------------------------------
# Empty / unconnected port
# ---------------------------------------------------------------------------

class TestEmptyPort:
    def test_empty_port_defaults(self):
        p = _port()
        r = resolve_port(p)
        assert r["is_downlink"] is False
        assert r["connected_device_id"] is None
        assert r["connected_device_name"] is None
        assert r["connected_vlan_id"] is None
        assert r["connected_network_color"] is None
        assert r["is_management"] is False

    def test_port_fields_passed_through(self):
        p = _port(port_number=7, port_name="Uplink", speed="10G", poe_enabled=True)
        r = resolve_port(p)
        assert r["port_number"] == 7
        assert r["port_name"] == "Uplink"
        assert r["speed"] == "10G"
        assert r["poe_enabled"] is True


# ---------------------------------------------------------------------------
# Uplink port (this device's own uplink out to upstream switch)
# ---------------------------------------------------------------------------

class TestUplinkPort:
    def test_uplink_shows_upstream_device(self):
        upstream = SimpleNamespace(id=99, name="Core Switch")
        upstream_port = SimpleNamespace(port_number=24, port_name="Downlink")
        p = _port(id=5)
        p.device = SimpleNamespace(
            uplink_port_id=5,
            upstream_device=upstream,
            upstream_port=upstream_port,
            nics=[],
        )
        r = resolve_port(p)
        assert r["connected_device_name"] == "Core Switch"
        assert r["connected_device_id"] == 99
        assert r["remote_port_number"] == 24
        assert r["connected_nic_label"] == "Uplink connection"

    def test_uplink_no_upstream_device_shows_sentinel(self):
        p = _port(id=5)
        p.device = SimpleNamespace(
            uplink_port_id=5,
            upstream_device=None,
            upstream_port=None,
            nics=[],
        )
        r = resolve_port(p)
        assert r["connected_device_name"] == "Upstream switch"
        assert r["connected_device_id"] == -1

    def test_uplink_enriches_vlan_from_device_nic(self):
        """Uplink port should pick up VLAN from device's own NICs."""
        net = _network(vlan_id=20, color="#ff0")
        nic = SimpleNamespace(network=net)
        upstream = SimpleNamespace(id=99, name="Core Switch")
        p = _port(id=5)
        p.device = SimpleNamespace(
            uplink_port_id=5,
            upstream_device=upstream,
            upstream_port=None,
            nics=[nic],
        )
        r = resolve_port(p)
        assert r["connected_vlan_id"] == 20
        assert r["connected_network_color"] == "#ff0"


# ---------------------------------------------------------------------------
# Downlink port (downstream device registered this as its upstream_port_id)
# ---------------------------------------------------------------------------

class TestDownlinkPort:
    def test_downlink_marked_correctly(self):
        downstream = SimpleNamespace(
            id=20, name="Access Switch",
            uplink_port=SimpleNamespace(port_number=1, port_name=None),
            nics=[],
        )
        p = _port(downstream_devices=[downstream])
        r = resolve_port(p)
        assert r["is_downlink"] is True
        assert r["connected_device_id"] == 20
        assert r["connected_device_name"] == "Access Switch"
        assert r["connected_nic_label"] == "Uplink"

    def test_downlink_vlan_from_exact_nic_match(self):
        """NIC on the port whose device_id matches the downstream → exact match."""
        net = _network(vlan_id=30, color="#0f0")
        downstream = SimpleNamespace(id=20, name="Access Switch",
                                     uplink_port=None, nics=[])
        nic = _nic(device_id=20, network=net)
        p = _port(downstream_devices=[downstream], nics=[nic])
        r = resolve_port(p)
        assert r["connected_vlan_id"] == 30
        assert r["connected_network_color"] == "#0f0"

    def test_downlink_vlan_fallback_to_downstream_nic(self):
        """No exact NIC match on port → fall back to downstream device's NICs."""
        net = _network(vlan_id=40, color="#00f")
        downstream_nic = SimpleNamespace(network=net)
        downstream = SimpleNamespace(id=20, name="Access Switch",
                                     uplink_port=None, nics=[downstream_nic])
        p = _port(downstream_devices=[downstream], nics=[])
        r = resolve_port(p)
        assert r["connected_vlan_id"] == 40

    def test_downlink_remote_port_from_uplink_port(self):
        uplink_port = SimpleNamespace(port_number=48, port_name="Uplink")
        downstream = SimpleNamespace(id=20, name="Access Switch",
                                     uplink_port=uplink_port, nics=[])
        p = _port(downstream_devices=[downstream])
        r = resolve_port(p)
        assert r["remote_port_number"] == 48
        assert r["remote_port_name"] == "Uplink"


# ---------------------------------------------------------------------------
# NIC connected (endpoint device plugged directly into port)
# ---------------------------------------------------------------------------

class TestNicConnected:
    def test_nic_connected_device(self):
        net = _network(vlan_id=50, color="#f00")
        nic = _nic(device_id=30, network=net)
        p = _port(nics=[nic])
        r = resolve_port(p)
        assert r["connected_device_id"] == 30
        assert r["connected_vlan_id"] == 50
        assert r["is_downlink"] is False

    def test_nic_connected_no_network(self):
        nic = _nic(device_id=30, network=None)
        p = _port(nics=[nic])
        r = resolve_port(p)
        assert r["connected_device_id"] == 30
        assert r["connected_vlan_id"] is None


# ---------------------------------------------------------------------------
# Management port
# ---------------------------------------------------------------------------

class TestManagementPort:
    def test_mgmt_port_with_ip(self):
        p = _port(is_management=True, mgmt_ip_address="192.168.1.1")
        r = resolve_port(p)
        assert r["connected_device_name"] == "192.168.1.1"
        assert r["connected_device_id"] == -1
        assert r["connected_nic_label"] == "OOB management"

    def test_mgmt_port_with_network_id(self):
        p = _port(is_management=True, mgmt_network_id=5, mgmt_ip_address=None)
        r = resolve_port(p)
        assert r["connected_device_id"] == -1
        assert r["connected_nic_label"] == "OOB management"

    def test_mgmt_port_no_config_empty(self):
        p = _port(is_management=True)
        r = resolve_port(p)
        assert r["connected_device_id"] is None
        assert r["connected_device_name"] is None

    def test_mgmt_port_oob_switch_via_nic(self):
        """Management NIC's switch_port_id points to a different device → OOB switch."""
        oob_switch = SimpleNamespace(id=88, name="OOB Switch")
        oob_port = SimpleNamespace(device_id=99, device=oob_switch,
                                   port_number=1, port_name=None)
        nic = SimpleNamespace(switch_port_rel=oob_port)
        p = _port(is_management=True, device_id=10)
        p.device.nics = [nic]
        r = resolve_port(p)
        assert r["connected_device_id"] == 88
        assert r["connected_device_name"] == "OOB Switch"
        assert r["remote_port_number"] == 1
