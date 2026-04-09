"""
Optional at-rest encryption for device credentials.

Disabled by default. Admins can enable it in Settings with a passphrase.
Key is derived from the passphrase using PBKDF2 (never stored anywhere).
After a server restart the key must be reloaded via the unlock endpoint.

States:
  - Off:    _encryption_configured=False  — passwords stored/returned as plaintext
  - Locked: _encryption_configured=True, _key=None  — key not in memory, decrypt returns None
  - Unlocked: _encryption_configured=True, _key set   — fully operational
"""
import base64
import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

log = logging.getLogger(__name__)

# ── Module-level state ───────────────────────────────────────────────────────
_key: Optional[bytes] = None         # url-safe base64 Fernet key, held in memory
_encryption_configured: bool = False  # mirrors DB encryption_enabled


# ── Internal helpers ─────────────────────────────────────────────────────────

def _derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=480_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))


# ── State accessors ──────────────────────────────────────────────────────────

def load_state_from_db(db) -> None:
    """Called on startup — reads encryption_enabled from DB, does NOT load the key."""
    global _encryption_configured
    from models.system_settings import SystemSettings
    s = db.query(SystemSettings).first()
    _encryption_configured = bool(s and s.encryption_enabled)


def is_locked() -> bool:
    """True when encryption is enabled but the passphrase has not been provided this session."""
    return _encryption_configured and _key is None


def unlock(passphrase: str, db) -> bool:
    """
    Derive and load the key into memory using the stored salt.
    Returns True on success, False if the passphrase is wrong.
    """
    global _key
    from models.system_settings import SystemSettings
    s = db.query(SystemSettings).first()
    if not s or not s.encryption_enabled or not s.encryption_salt or not s.encryption_verification:
        return False
    salt = base64.urlsafe_b64decode(s.encryption_salt)
    candidate = _derive_key(passphrase, salt)
    try:
        Fernet(candidate).decrypt(s.encryption_verification.encode())
    except InvalidToken:
        return False
    _key = candidate
    return True


# ── Enable / disable ─────────────────────────────────────────────────────────

def enable_encryption(passphrase: str, db) -> None:
    """
    Enable encryption: derive key, encrypt all existing plaintext passwords, persist state.
    Raises ValueError on precondition failure.
    """
    global _key, _encryption_configured
    from models.system_settings import SystemSettings
    from models.device import Device

    s = db.query(SystemSettings).first()
    if not s:
        raise ValueError("System settings not found")
    if s.encryption_enabled:
        raise ValueError("Encryption is already enabled")
    if not s.auth_required:
        raise ValueError("Require Login must be enabled before enabling encryption")

    salt = os.urandom(32)
    key = _derive_key(passphrase, salt)
    f = Fernet(key)

    for device in db.query(Device).filter(Device.password != None).all():
        if device.password:
            device.password = f.encrypt(device.password.encode()).decode()

    s.encryption_enabled = True
    s.encryption_salt = base64.urlsafe_b64encode(salt).decode()
    s.encryption_verification = f.encrypt(b"mynet-verify").decode()

    db.commit()
    _key = key
    _encryption_configured = True
    log.info("Encryption enabled")


def disable_encryption(passphrase: str, db) -> bool:
    """
    Disable encryption: verify passphrase, decrypt all passwords, clear state.
    Returns True on success, False if the passphrase is wrong.
    """
    global _key, _encryption_configured
    from models.system_settings import SystemSettings
    from models.device import Device

    s = db.query(SystemSettings).first()
    if not s or not s.encryption_enabled:
        raise ValueError("Encryption is not enabled")

    salt = base64.urlsafe_b64decode(s.encryption_salt)
    key = _derive_key(passphrase, salt)
    try:
        Fernet(key).decrypt(s.encryption_verification.encode())
    except InvalidToken:
        return False

    f = Fernet(key)
    for device in db.query(Device).filter(Device.password != None).all():
        try:
            device.password = f.decrypt(device.password.encode()).decode()
        except InvalidToken:
            log.warning("Device %s: password could not be decrypted (already plaintext or corrupted) — leaving as-is", device.id)
        except Exception as e:
            log.error("Device %s: unexpected error decrypting password: %s", device.id, e)

    s.encryption_enabled = False
    s.encryption_salt = None
    s.encryption_verification = None
    db.commit()

    _key = None
    _encryption_configured = False
    log.info("Encryption disabled")
    return True


# ── One-time migration from old env-based Fernet key ────────────────────────

def migrate_from_old_key(old_fernet_key: str, db) -> None:
    """
    Decrypt all passwords encrypted with the old FERNET_KEY env-based key
    and store them as plaintext. Sets encryption_enabled=False.
    Called once on startup when FERNET_KEY env var is detected.
    """
    global _key, _encryption_configured
    from models.system_settings import SystemSettings
    from models.device import Device

    try:
        f = Fernet(old_fernet_key.encode() if isinstance(old_fernet_key, str) else old_fernet_key)
    except Exception as e:
        log.error(f"Migration failed — invalid old Fernet key: {e}")
        return

    count = 0
    for device in db.query(Device).filter(Device.password != None).all():
        try:
            plain = f.decrypt(device.password.encode()).decode()
            device.password = plain
            count += 1
        except InvalidToken:
            pass  # already plaintext or encrypted with a different key — leave as-is
        except Exception as e:
            log.warning("Device %s: unexpected error during migration: %s", device.id, e)

    s = db.query(SystemSettings).first()
    if s:
        s.encryption_enabled = False
        s.encryption_salt = None
        s.encryption_verification = None

    db.commit()
    _key = None
    _encryption_configured = False
    log.info(f"Migrated {count} device password(s) from old Fernet key to plaintext")


# ── Encrypt / decrypt ────────────────────────────────────────────────────────

def encrypt(plain: Optional[str]) -> Optional[str]:
    """
    Encrypt a plaintext value.
    - Encryption off: returns plain as-is.
    - Encryption on + unlocked: returns ciphertext.
    - Encryption on + locked: raises ValueError (caller should return 423).
    """
    if not plain:
        return None
    if not _encryption_configured:
        return plain
    if _key is None:
        raise ValueError("Encryption is locked — unlock before saving credentials")
    return Fernet(_key).encrypt(plain.encode()).decode()


def decrypt(cipher: Optional[str]) -> Optional[str]:
    """
    Decrypt a value.
    - Encryption off: returns value as-is (stored as plaintext).
    - Encryption on + unlocked: returns decrypted plaintext.
    - Encryption on + locked: returns None (caller should signal locked state).
    """
    if not cipher:
        return None
    if not _encryption_configured:
        return cipher
    if _key is None:
        return None  # locked
    try:
        return Fernet(_key).decrypt(cipher.encode()).decode()
    except InvalidToken:
        return None
