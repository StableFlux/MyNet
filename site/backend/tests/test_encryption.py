"""
Encryption service unit tests — no HTTP server required.

Tests services/encryption.py:
- Key derivation (deterministic, salt-sensitive, passphrase-sensitive)
- encrypt/decrypt round-trip at each state (off / locked / unlocked)
- Null/empty passthrough
- Invalid ciphertext handling
- enable_encryption: DB state, password encryption, precondition checks
- disable_encryption: correct / wrong passphrase
- unlock: correct / wrong passphrase
- migrate_from_old_key: old Fernet passwords decrypted to plaintext
"""
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import services.encryption as enc
from services.encryption import (
    _derive_key, encrypt, decrypt, is_locked,
    enable_encryption, disable_encryption, unlock,
    migrate_from_old_key,
)
from database import Base
from migrations.apply import apply_migrations
from models.system_settings import SystemSettings
from models.device import Device, DeviceStatus
from services.auth import hash_password
from models.user import User, UserRole


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_enc_state():
    """Guarantee each test starts with encryption fully off."""
    enc._key = None
    enc._encryption_configured = False
    yield
    enc._key = None
    enc._encryption_configured = False


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    apply_migrations(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Minimal SystemSettings row with auth_required=True
    ss = SystemSettings(id=1, auth_required=True, encryption_enabled=False)
    session.add(ss)
    session.commit()

    yield session
    session.close()


@pytest.fixture
def db_with_device(db):
    """DB with one device that has a plaintext password."""
    user = User(
        id=1, username="admin", display_name="Admin",
        password_hash=hash_password("pw"), role=UserRole.admin,
    )
    device = Device(
        id=1, name="Server", status=DeviceStatus.in_service,
        password="supersecret",
    )
    db.add_all([user, device])
    db.commit()
    return db


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------

class TestKeyDerivation:
    def test_deterministic(self):
        salt = b"fixed_salt_value_"
        k1 = _derive_key("passphrase", salt)
        k2 = _derive_key("passphrase", salt)
        assert k1 == k2

    def test_different_salt_gives_different_key(self):
        k1 = _derive_key("passphrase", b"salt_one")
        k2 = _derive_key("passphrase", b"salt_two")
        assert k1 != k2

    def test_different_passphrase_gives_different_key(self):
        salt = b"same_salt_bytes__"
        k1 = _derive_key("phrase_a", salt)
        k2 = _derive_key("phrase_b", salt)
        assert k1 != k2

    def test_output_is_valid_fernet_key(self):
        key = _derive_key("any_passphrase", b"any_salt_bytes__")
        # Should not raise
        f = Fernet(key)
        assert f is not None


# ---------------------------------------------------------------------------
# encrypt / decrypt — off state (passthrough)
# ---------------------------------------------------------------------------

class TestEncryptDecryptOff:
    def test_encrypt_returns_plaintext_when_off(self):
        assert encrypt("hello") == "hello"

    def test_decrypt_returns_value_when_off(self):
        assert decrypt("hello") == "hello"

    def test_encrypt_none_returns_none(self):
        assert encrypt(None) is None

    def test_decrypt_none_returns_none(self):
        assert decrypt(None) is None

    def test_encrypt_empty_string_returns_none(self):
        assert encrypt("") is None

    def test_decrypt_empty_string_returns_none(self):
        assert decrypt("") is None


# ---------------------------------------------------------------------------
# encrypt / decrypt — locked state
# ---------------------------------------------------------------------------

class TestEncryptDecryptLocked:
    @pytest.fixture(autouse=True)
    def set_locked(self):
        enc._encryption_configured = True
        enc._key = None

    def test_is_locked_returns_true(self):
        assert is_locked() is True

    def test_encrypt_raises_when_locked(self):
        with pytest.raises(ValueError, match="locked"):
            encrypt("secret")

    def test_decrypt_returns_none_when_locked(self):
        assert decrypt("some_ciphertext") is None


# ---------------------------------------------------------------------------
# encrypt / decrypt — unlocked state
# ---------------------------------------------------------------------------

class TestEncryptDecryptUnlocked:
    @pytest.fixture(autouse=True)
    def set_unlocked(self):
        raw_key = Fernet.generate_key()
        enc._encryption_configured = True
        enc._key = raw_key

    def test_round_trip(self):
        cipher = encrypt("my_password")
        assert cipher != "my_password"
        assert decrypt(cipher) == "my_password"

    def test_same_plaintext_produces_different_ciphertext(self):
        """Fernet uses a random nonce — each encrypt call produces a unique token."""
        c1 = encrypt("same")
        c2 = encrypt("same")
        assert c1 != c2
        assert decrypt(c1) == "same"
        assert decrypt(c2) == "same"

    def test_decrypt_invalid_token_returns_none(self):
        assert decrypt("not-valid-fernet-ciphertext") is None

    def test_decrypt_none_returns_none(self):
        assert decrypt(None) is None

    def test_is_locked_returns_false(self):
        assert is_locked() is False


# ---------------------------------------------------------------------------
# enable_encryption
# ---------------------------------------------------------------------------

class TestEnableEncryption:
    def test_encrypts_device_passwords(self, db_with_device):
        enable_encryption("mypassphrase", db_with_device)
        device = db_with_device.query(Device).first()
        assert device.password != "supersecret"
        # Must decrypt back to original
        assert decrypt(device.password) == "supersecret"

    def test_sets_encryption_enabled_in_db(self, db_with_device):
        enable_encryption("mypassphrase", db_with_device)
        ss = db_with_device.query(SystemSettings).first()
        assert ss.encryption_enabled is True
        assert ss.encryption_salt is not None
        assert ss.encryption_verification is not None

    def test_module_state_unlocked_after_enable(self, db_with_device):
        enable_encryption("mypassphrase", db_with_device)
        assert enc._encryption_configured is True
        assert enc._key is not None
        assert is_locked() is False

    def test_raises_if_already_enabled(self, db_with_device):
        enable_encryption("pass1", db_with_device)
        with pytest.raises(ValueError, match="already enabled"):
            enable_encryption("pass2", db_with_device)

    def test_raises_if_auth_not_required(self, db):
        ss = db.query(SystemSettings).first()
        ss.auth_required = False
        db.commit()
        with pytest.raises(ValueError, match="Require Login"):
            enable_encryption("pass", db)


# ---------------------------------------------------------------------------
# disable_encryption
# ---------------------------------------------------------------------------

class TestDisableEncryption:
    def test_correct_passphrase_decrypts_passwords(self, db_with_device):
        enable_encryption("mypassphrase", db_with_device)
        result = disable_encryption("mypassphrase", db_with_device)
        assert result is True
        device = db_with_device.query(Device).first()
        assert device.password == "supersecret"

    def test_wrong_passphrase_returns_false(self, db_with_device):
        enable_encryption("correct_pass", db_with_device)
        result = disable_encryption("wrong_pass", db_with_device)
        assert result is False
        # Password must still be encrypted
        device = db_with_device.query(Device).first()
        assert device.password != "supersecret"

    def test_clears_module_state_after_disable(self, db_with_device):
        enable_encryption("mypassphrase", db_with_device)
        disable_encryption("mypassphrase", db_with_device)
        assert enc._key is None
        assert enc._encryption_configured is False

    def test_clears_db_state_after_disable(self, db_with_device):
        enable_encryption("mypassphrase", db_with_device)
        disable_encryption("mypassphrase", db_with_device)
        ss = db_with_device.query(SystemSettings).first()
        assert ss.encryption_enabled is False
        assert ss.encryption_salt is None

    def test_raises_if_not_enabled(self, db):
        with pytest.raises(ValueError, match="not enabled"):
            disable_encryption("pass", db)


# ---------------------------------------------------------------------------
# unlock
# ---------------------------------------------------------------------------

class TestUnlock:
    def test_correct_passphrase_returns_true(self, db_with_device):
        enable_encryption("correct", db_with_device)
        # Simulate server restart: clear key but keep configured flag
        enc._key = None
        assert unlock("correct", db_with_device) is True
        assert enc._key is not None

    def test_wrong_passphrase_returns_false(self, db_with_device):
        enable_encryption("correct", db_with_device)
        enc._key = None
        assert unlock("wrong", db_with_device) is False
        assert enc._key is None

    def test_unlock_allows_decrypt(self, db_with_device):
        enable_encryption("correct", db_with_device)
        enc._key = None  # simulate restart
        unlock("correct", db_with_device)
        device = db_with_device.query(Device).first()
        assert decrypt(device.password) == "supersecret"


# ---------------------------------------------------------------------------
# migrate_from_old_key
# ---------------------------------------------------------------------------

class TestMigrateFromOldKey:
    def test_decrypts_passwords_to_plaintext(self, db):
        old_key = Fernet.generate_key()
        f = Fernet(old_key)
        device = Device(
            id=1, name="Legacy", status=DeviceStatus.in_service,
            password=f.encrypt(b"oldpassword").decode(),
        )
        db.add(device)
        db.commit()

        migrate_from_old_key(old_key.decode(), db)
        device = db.query(Device).first()
        assert device.password == "oldpassword"

    def test_leaves_plaintext_passwords_unchanged(self, db):
        device = Device(
            id=1, name="Plain", status=DeviceStatus.in_service,
            password="already_plain",
        )
        db.add(device)
        db.commit()

        old_key = Fernet.generate_key()
        migrate_from_old_key(old_key.decode(), db)
        device = db.query(Device).first()
        assert device.password == "already_plain"

    def test_invalid_key_does_not_raise(self, db):
        # Should log error and return gracefully
        migrate_from_old_key("not-a-valid-fernet-key", db)

    def test_clears_encryption_state(self, db):
        old_key = Fernet.generate_key()
        migrate_from_old_key(old_key.decode(), db)
        ss = db.query(SystemSettings).first()
        assert ss.encryption_enabled is False
        assert enc._encryption_configured is False
