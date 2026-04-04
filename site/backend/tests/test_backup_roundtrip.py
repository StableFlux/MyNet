"""
Backup export round-trip test — runs against the live server on port 8000.

Tests:
- Export produces valid JSON with all required tables
- All required keys are present in the export
- Import endpoint rejects invalid JSON
- Import endpoint rejects missing required keys

NOTE: Does NOT perform a destructive import against the live DB.
The import validation tests use clearly invalid payloads that will be
rejected before any data is modified.
"""
import json
import pytest
import urllib.request
import urllib.error

BASE = "http://localhost:8000/api"


def _get(path, token=None):
    req = urllib.request.Request(f"{BASE}{path}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, {}


def _post_file(path, data: bytes, token=None):
    """POST a file upload (multipart) to the given path."""
    import uuid
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="test.json"\r\n'
        f"Content-Type: application/json\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{BASE}{path}",
        data=body,
        method="POST",
    )
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


@pytest.fixture(scope="module")
def admin_token():
    """Log in as admin on the live server. Skip all tests if login fails."""
    import urllib.parse
    data = urllib.parse.urlencode({"username": "admin", "password": "admin"}).encode()
    req = urllib.request.Request(f"{BASE}/auth/login", data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            body = json.loads(r.read())
            return body.get("access_token")
    except Exception:
        pytest.skip("Live server not reachable or admin/admin credentials not valid — skipping integration tests")


# ---------------------------------------------------------------------------

class TestBackupExport:
    def test_export_requires_auth(self):
        status, _ = _get("/backup/export")
        assert status == 401

    def test_export_returns_all_tables(self, admin_token):
        status, data = _get("/backup/export", admin_token)
        assert status == 200
        for key in ["version", "devices", "nics", "networks", "locations",
                    "switch_ports", "users", "device_types"]:
            assert key in data, f"Missing key in export: {key}"

    def test_export_is_valid_json(self, admin_token):
        status, data = _get("/backup/export", admin_token)
        assert status == 200
        assert isinstance(data["devices"], list)
        assert isinstance(data["nics"], list)
        assert isinstance(data["networks"], list)

    def test_export_version_present(self, admin_token):
        status, data = _get("/backup/export", admin_token)
        assert status == 200
        assert data.get("version") is not None

    def test_export_nics_have_new_fields(self, admin_token):
        """Verifies new NIC columns are included in the backup."""
        status, data = _get("/backup/export", admin_token)
        assert status == 200
        if data["nics"]:
            nic = data["nics"][0]
            for field in ["gateway", "subnet_mask", "dns_server_1", "dns_server_2"]:
                assert field in nic, f"NIC export missing field: {field}"

    def test_export_switch_ports_have_mgmt_fields(self, admin_token):
        """Verifies new switch_port mgmt columns are included in the backup."""
        status, data = _get("/backup/export", admin_token)
        assert status == 200
        if data["switch_ports"]:
            port = data["switch_ports"][0]
            for field in ["mgmt_network_id", "mgmt_ip_address"]:
                assert field in port, f"SwitchPort export missing field: {field}"


class TestBackupImportValidation:
    def test_import_requires_auth(self):
        status, _ = _post_file("/backup/import", b'{"version":"1","devices":[]}')
        assert status == 401

    def test_import_rejects_invalid_json(self, admin_token):
        status, _ = _post_file("/backup/import", b"not valid json", admin_token)
        assert status == 400

    def test_import_rejects_missing_version(self, admin_token):
        bad = json.dumps({"devices": []}).encode()
        status, _ = _post_file("/backup/import", bad, admin_token)
        assert status == 400

    def test_import_rejects_missing_devices(self, admin_token):
        bad = json.dumps({"version": "1.4"}).encode()
        status, _ = _post_file("/backup/import", bad, admin_token)
        assert status == 400
