"""
Tests for authentication security — pure unit tests, no HTTP server needed.

Tests the auth service functions directly:
- Token encoding/decoding
- Password hashing/verification
- Token tampering and expiry
- Role hierarchy logic
"""
import pytest
from datetime import datetime, timedelta, timezone
from jose import jwt

from services.auth import hash_password, verify_password, create_access_token, _decode_token
from models.user import UserRole

TEST_SECRET = "test-secret-key-for-unit-tests-only"


# Patch settings.jwt_secret_key for all tests in this module
@pytest.fixture(autouse=True)
def patch_secret(monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "jwt_secret_key", TEST_SECRET)
    monkeypatch.setattr(settings, "jwt_expire_minutes", 480)


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        h = hash_password("mysecret")
        assert h != "mysecret"
        assert len(h) > 20

    def test_correct_password_verifies(self):
        h = hash_password("correct")
        assert verify_password("correct", h) is True

    def test_wrong_password_fails(self):
        h = hash_password("correct")
        assert verify_password("wrong", h) is False

    def test_different_hashes_for_same_password(self):
        """bcrypt uses salt — same password → different hashes."""
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2
        assert verify_password("same", h1)
        assert verify_password("same", h2)


# ---------------------------------------------------------------------------
# JWT creation and decoding
# ---------------------------------------------------------------------------

class TestJWTTokens:
    def test_valid_token_decodes(self):
        token = create_access_token(1, "alice", UserRole.admin)
        payload = _decode_token(token)
        assert payload is not None
        assert payload["sub"] == "1"
        assert payload["username"] == "alice"
        assert payload["role"] == "admin"

    def test_expired_token_rejected(self):
        payload = {
            "sub": "1", "username": "alice", "role": "admin",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
        }
        token = jwt.encode(payload, TEST_SECRET, algorithm="HS256")
        assert _decode_token(token) is None

    def test_wrong_secret_rejected(self):
        payload = {
            "sub": "1", "username": "alice", "role": "admin",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        token = jwt.encode(payload, "wrong-secret", algorithm="HS256")
        assert _decode_token(token) is None

    def test_garbage_token_rejected(self):
        assert _decode_token("not.a.token") is None
        assert _decode_token("") is None
        assert _decode_token("aaa.bbb.ccc") is None

    def test_tampered_payload_rejected(self):
        """Modifying the payload without re-signing must fail."""
        import base64
        import json
        token = create_access_token(1, "alice", UserRole.viewer)
        header, payload_b64, sig = token.split(".")
        # Decode, escalate role, re-encode without re-signing
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        data["role"] = "admin"
        tampered_payload = base64.urlsafe_b64encode(
            json.dumps(data).encode()
        ).rstrip(b"=").decode()
        tampered_token = f"{header}.{tampered_payload}.{sig}"
        assert _decode_token(tampered_token) is None

    def test_roles_are_preserved(self):
        for role in [UserRole.admin, UserRole.editor, UserRole.viewer]:
            token = create_access_token(1, "user", role)
            payload = _decode_token(token)
            assert payload["role"] == role.value

    def test_token_contains_expiry(self):
        token = create_access_token(1, "alice", UserRole.admin)
        payload = _decode_token(token)
        assert "exp" in payload
        # Should expire in the future
        assert payload["exp"] > datetime.now(timezone.utc).timestamp()


# ---------------------------------------------------------------------------
# Role hierarchy checks (logic only, no DB)
# ---------------------------------------------------------------------------

class TestRoleHierarchy:
    def test_admin_is_not_viewer_only(self):
        assert UserRole.admin != UserRole.viewer

    def test_viewer_is_lowest_role(self):
        """Verify the role enum values exist and are distinct."""
        roles = {UserRole.admin, UserRole.editor, UserRole.viewer}
        assert len(roles) == 3

    def test_editor_check_logic(self):
        """Mirrors require_editor: viewer is denied, editor/admin allowed."""
        def can_edit(role: UserRole) -> bool:
            return role != UserRole.viewer

        assert can_edit(UserRole.admin) is True
        assert can_edit(UserRole.editor) is True
        assert can_edit(UserRole.viewer) is False

    def test_admin_check_logic(self):
        """Mirrors require_admin: only admin allowed."""
        def is_admin(role: UserRole) -> bool:
            return role == UserRole.admin

        assert is_admin(UserRole.admin) is True
        assert is_admin(UserRole.editor) is False
        assert is_admin(UserRole.viewer) is False
