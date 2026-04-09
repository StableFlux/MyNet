"""
Backup & Restore router.
GET  /api/backup/export  — download full JSON backup (admin only)
POST /api/backup/import  — restore from JSON backup (admin only, destructive)

Note: encryption keys are never included in backups. If encryption is enabled,
password fields are exported as ciphertext. Restoring on a different instance
(with a different passphrase) will leave those fields unreadable.
"""
import json
import logging
from datetime import datetime, timezone
from sqlalchemy import DateTime, text

log = logging.getLogger(__name__)

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from services.auth import require_admin
from seed_device_types import seed_device_types
from models.system_settings import SystemSettings
from models.network import Network
from models.device_type import DeviceType
from models.device import Device
from models.nic import Nic
from models.switch_port import SwitchPort
from models.location import Location
from models.user import User
from models.monitoring import MonitoringResult
from models.pihole import PiHoleCache
from models.event import Event
from models.wan_config import WanConfig

router = APIRouter(prefix="/api/backup", tags=["backup"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_dict(obj, exclude: set[str] | None = None) -> dict:
    """Serialize a SQLAlchemy row to a plain dict."""
    skip = exclude or set()
    result = {}
    for col in obj.__table__.columns:
        if col.name in skip:
            continue
        val = getattr(obj, col.name)
        if isinstance(val, datetime):
            val = val.isoformat()
        result[col.name] = val
    return result


def _col_names(model) -> set[str]:
    return {c.name for c in model.__table__.columns}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@router.get("/export", dependencies=[Depends(require_admin)])
def export_backup(db: Session = Depends(get_db)):
    ts = {"created_at", "updated_at"}

    sys = db.query(SystemSettings).first()
    payload = {
        "version": "1.4",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "system_settings": {
            "system_name":              sys.system_name if sys else "MyNet",
            "auth_required":            sys.auth_required if sys else True,
            "pihole_poll_interval_secs": sys.pihole_poll_interval_secs if sys else 300,
            "dns_domain":               sys.dns_domain if sys else None,
            "location_type_colors":     sys.location_type_colors if sys else None,
            "device_category_colors":   sys.device_category_colors if sys else None,
            "device_status_colors":     sys.device_status_colors if sys else None,
            "wan_port_color":           sys.wan_port_color if sys else None,
            # encryption fields intentionally excluded — keys never leave the server
        },
        "users":         [_row_to_dict(r, ts) for r in db.query(User).order_by(User.id).all()],
        "networks":      [_row_to_dict(r, ts) for r in db.query(Network).order_by(Network.id).all()],
        "device_types":  [_row_to_dict(r, ts) for r in db.query(DeviceType).order_by(DeviceType.id).all()],
        "locations":     [_row_to_dict(r) for r in db.query(Location).order_by(Location.id).all()],
        "devices":       [_row_to_dict(r, ts) for r in db.query(Device).order_by(Device.id).all()],
        "nics":          [_row_to_dict(r, ts) for r in db.query(Nic).order_by(Nic.id).all()],
        "switch_ports":  [_row_to_dict(r) for r in db.query(SwitchPort).order_by(SwitchPort.id).all()],
        "wan_configs":   [_row_to_dict(r) for r in db.query(WanConfig).order_by(WanConfig.id).all()],
    }

    filename = f"mynet-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Import (destructive restore)
# ---------------------------------------------------------------------------

def _do_restore(db: Session, data: dict) -> dict:
    """Core restore logic shared by both restore endpoints."""
    # Defer FK checks to commit time — allows inserts in any order within the transaction.
    # Required for self-referential tables (locations.parent_id, devices.upstream_device_id).
    # SQLite resets this automatically after each commit.
    db.execute(text("PRAGMA defer_foreign_keys = ON"))

    # Clear tables that reference devices/users but are not included in the backup.
    # Must be deleted before their parent rows to satisfy FK constraints at commit.
    db.query(MonitoringResult).delete(synchronize_session=False)
    db.query(PiHoleCache).delete(synchronize_session=False)
    db.query(Event).delete(synchronize_session=False)
    db.query(WanConfig).delete(synchronize_session=False)
    db.query(SwitchPort).delete(synchronize_session=False)
    db.query(Nic).delete(synchronize_session=False)
    db.query(Device).delete(synchronize_session=False)
    db.query(Location).delete(synchronize_session=False)
    db.query(Network).delete(synchronize_session=False)
    db.query(DeviceType).delete(synchronize_session=False)
    db.query(User).delete(synchronize_session=False)
    db.flush()

    def _insert_rows(model, rows: list[dict]):
        cols = _col_names(model)
        # Identify DateTime columns so ISO strings can be parsed back to datetime objects
        dt_cols = {
            c.name for c in model.__table__.columns
            if isinstance(c.type, DateTime)
        }
        def _coerce(k, v):
            if k in dt_cols and isinstance(v, str):
                try:
                    return datetime.fromisoformat(v)
                except ValueError:
                    return None
            return v
        for row in rows:
            db.execute(
                model.__table__.insert(),
                {k: _coerce(k, v) for k, v in row.items() if k in cols},
            )

    _insert_rows(User,               data.get("users",         []))
    _insert_rows(Network,            data.get("networks",      []))
    _insert_rows(DeviceType,         data.get("device_types",  []))
    _insert_rows(Location,           data.get("locations",     []))
    _insert_rows(Device,             data.get("devices",       []))
    _insert_rows(Nic,                data.get("nics",          []))
    _insert_rows(SwitchPort,         data.get("switch_ports",  []))
    _insert_rows(WanConfig,          data.get("wan_configs",   []))

    # Restore system settings (non-encryption fields only)
    ss = data.get("system_settings")
    if ss:
        s = db.query(SystemSettings).first()
        if not s:
            s = SystemSettings(id=1)
            db.add(s)
        if "system_name" in ss:
            s.system_name = ss["system_name"] or "MyNet"
        if "auth_required" in ss:
            s.auth_required = ss["auth_required"]
        if "pihole_poll_interval_secs" in ss:
            s.pihole_poll_interval_secs = ss["pihole_poll_interval_secs"] or 300
        if "dns_domain" in ss:
            s.dns_domain = ss["dns_domain"]
        if "location_type_colors" in ss:
            s.location_type_colors = ss["location_type_colors"]
        if "device_category_colors" in ss:
            s.device_category_colors = ss["device_category_colors"]
        if "device_status_colors" in ss:
            s.device_status_colors = ss["device_status_colors"]
        if "wan_port_color" in ss:
            s.wan_port_color = ss["wan_port_color"]

    db.commit()

    return {
        "users":         len(data.get("users",         [])),
        "networks":      len(data.get("networks",      [])),
        "device_types":  len(data.get("device_types",  [])),
        "locations":     len(data.get("locations",     [])),
        "devices":       len(data.get("devices",       [])),
        "nics":          len(data.get("nics",          [])),
        "switch_ports":  len(data.get("switch_ports",  [])),
        "wan_configs":   len(data.get("wan_configs",   [])),
    }


@router.post("/restore-setup")
async def restore_setup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Restore from backup during initial setup — only callable when no users exist."""
    if db.query(User).count() > 0:
        raise HTTPException(status_code=403, detail="Setup already completed — use the normal restore endpoint")

    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    if "version" not in data or "devices" not in data:
        raise HTTPException(status_code=400, detail="Unrecognised backup format — missing required keys")

    try:
        counts = _do_restore(db, data)
    except Exception as exc:
        db.rollback()
        log.error("Restore (setup) failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Restore failed — check server logs for details.")

    return {"success": True, "users": counts["users"]}


@router.post("/import", dependencies=[Depends(require_admin)])
async def import_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    if "version" not in data or "devices" not in data:
        raise HTTPException(status_code=400, detail="Unrecognised backup format — missing required keys")

    try:
        counts = _do_restore(db, data)
    except Exception as exc:
        db.rollback()
        log.error("Backup import failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Import failed — check server logs for details.")

    # Warn if the backup came from an older version that had a fernet_key
    had_old_key = bool(data.get("fernet_key"))

    return {
        "success": True,
        "had_old_encryption_key": had_old_key,
        "restored": counts,
    }


# ---------------------------------------------------------------------------
# Factory Reset
# ---------------------------------------------------------------------------

@router.post("/factory-reset", dependencies=[Depends(require_admin)])
def factory_reset(
    confirm: str = Body(..., embed=True),
    db: Session = Depends(get_db),
):
    """
    Wipe all user data and return the system to a freshly installed state.
    The caller must supply {"confirm": "RESET"} in the request body.
    Device types are re-seeded immediately; the setup wizard is shown on next page load.
    """
    if confirm != "RESET":
        raise HTTPException(status_code=400, detail='Send {"confirm": "RESET"} to proceed')

    try:
        db.execute(text("PRAGMA defer_foreign_keys = ON"))

        # Delete all user/network/device data in FK-safe order
        db.query(MonitoringResult).delete(synchronize_session=False)
        db.query(PiHoleCache).delete(synchronize_session=False)
        db.query(Event).delete(synchronize_session=False)
        db.query(WanConfig).delete(synchronize_session=False)
        db.query(SwitchPort).delete(synchronize_session=False)
        db.query(Nic).delete(synchronize_session=False)
        db.query(Device).delete(synchronize_session=False)
        db.query(Location).delete(synchronize_session=False)
        db.query(Network).delete(synchronize_session=False)
        db.query(DeviceType).delete(synchronize_session=False)
        db.query(User).delete(synchronize_session=False)
        db.flush()

        # Reset system settings to defaults
        s = db.query(SystemSettings).first()
        if not s:
            s = SystemSettings(id=1)
            db.add(s)
        s.system_name = "MyNet"
        s.auth_required = True
        s.encryption_enabled = False
        s.encryption_salt = None
        s.encryption_verification = None
        s.pihole_poll_interval_secs = 300
        s.dns_domain = None
        s.location_type_colors = None
        s.device_category_colors = None
        s.device_status_colors = None
        s.wan_port_color = None

        db.commit()

        # Re-seed the standard device types so they're available immediately
        seed_device_types(db)

    except Exception as exc:
        db.rollback()
        log.error("Factory reset failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Factory reset failed. Check server logs for details.")

    return {"success": True}
