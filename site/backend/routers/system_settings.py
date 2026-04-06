from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.system_settings import SystemSettings, DEFAULT_LOCATION_TYPE_COLORS, DEFAULT_DEVICE_CATEGORY_COLORS, DEFAULT_DEVICE_STATUS_COLORS
from services.auth import require_admin
import services.encryption as enc

router = APIRouter(prefix="/system-settings", tags=["system-settings"])


def _get_or_create(db: Session) -> SystemSettings:
    s = db.query(SystemSettings).first()
    if not s:
        s = SystemSettings(id=1, system_name="MyNet", auth_required=True, encryption_enabled=False)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _settings_response(s: SystemSettings) -> dict:
    return {
        "system_name": s.system_name,
        "auth_required": s.auth_required,
        "encryption_enabled": s.encryption_enabled,
        "encryption_locked": enc.is_locked(),
        "pihole_poll_interval_secs": s.pihole_poll_interval_secs or 300,
        "dns_domain": s.dns_domain or "",
        # Colour settings — merge stored values on top of defaults
        "location_type_colors": {**DEFAULT_LOCATION_TYPE_COLORS, **(s.location_type_colors or {})},
        "device_category_colors": {**DEFAULT_DEVICE_CATEGORY_COLORS, **(s.device_category_colors or {})},
        "device_status_colors": {**DEFAULT_DEVICE_STATUS_COLORS, **(s.device_status_colors or {})},
        "wan_port_color": s.wan_port_color or "#ef4444",
        "mynet_url": s.mynet_url or "",
    }


# ── GET ──────────────────────────────────────────────────────────────────────

@router.get("")
def get_system_settings(db: Session = Depends(get_db)):
    """Public — no auth required so the frontend can read system_name before login."""
    s = _get_or_create(db)
    return _settings_response(s)


# ── PATCH (system_name + auth_required) ─────────────────────────────────────

class SystemSettingsIn(BaseModel):
    system_name: Optional[str] = None
    auth_required: Optional[bool] = None
    pihole_poll_interval_secs: Optional[int] = None
    dns_domain: Optional[str] = None
    location_type_colors: Optional[dict] = None
    device_category_colors: Optional[dict] = None
    device_status_colors: Optional[dict] = None
    wan_port_color: Optional[str] = None
    mynet_url: Optional[str] = None


@router.patch("")
def update_system_settings(
    body: SystemSettingsIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    s = _get_or_create(db)

    if body.system_name is not None:
        s.system_name = body.system_name.strip() or "MyNet"

    if body.auth_required is not None:
        if body.auth_required is False and s.encryption_enabled:
            raise HTTPException(
                status_code=409,
                detail="Disable encryption before turning off the login requirement.",
            )
        s.auth_required = body.auth_required

    if body.pihole_poll_interval_secs is not None:
        s.pihole_poll_interval_secs = max(60, body.pihole_poll_interval_secs)

    if body.dns_domain is not None:
        # Normalise: strip whitespace, ensure leading dot if non-empty
        domain = body.dns_domain.strip()
        if domain and not domain.startswith("."):
            domain = "." + domain
        s.dns_domain = domain or None

    if body.location_type_colors is not None:
        s.location_type_colors = {k: v for k, v in body.location_type_colors.items() if isinstance(v, str)}
    if body.device_category_colors is not None:
        s.device_category_colors = {k: v for k, v in body.device_category_colors.items() if isinstance(v, str)}
    if body.device_status_colors is not None:
        s.device_status_colors = {k: v for k, v in body.device_status_colors.items() if isinstance(v, str)}
    if body.wan_port_color is not None:
        s.wan_port_color = body.wan_port_color

    if body.mynet_url is not None:
        url = body.mynet_url.strip().rstrip('/')
        s.mynet_url = url or None

    db.commit()
    return _settings_response(s)


# ── Encryption: enable ───────────────────────────────────────────────────────

class PassphraseIn(BaseModel):
    passphrase: str


class EnableEncryptionIn(BaseModel):
    passphrase: str
    confirm: str


@router.post("/encryption/enable")
def encryption_enable(
    body: EnableEncryptionIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if body.passphrase != body.confirm:
        raise HTTPException(status_code=422, detail="Passphrases do not match.")
    if len(body.passphrase) < 8:
        raise HTTPException(status_code=422, detail="Passphrase must be at least 8 characters.")
    try:
        enc.enable_encryption(body.passphrase, db)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    s = _get_or_create(db)
    return _settings_response(s)


# ── Encryption: disable ──────────────────────────────────────────────────────

@router.post("/encryption/disable")
def encryption_disable(
    body: PassphraseIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    try:
        ok = enc.disable_encryption(body.passphrase, db)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not ok:
        raise HTTPException(status_code=401, detail="Incorrect passphrase.")
    s = _get_or_create(db)
    return _settings_response(s)


# ── Encryption: unlock (after server restart) ────────────────────────────────

@router.post("/encryption/unlock")
def encryption_unlock(
    body: PassphraseIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    ok = enc.unlock(body.passphrase, db)
    if not ok:
        raise HTTPException(status_code=401, detail="Incorrect passphrase.")
    s = _get_or_create(db)
    return _settings_response(s)
