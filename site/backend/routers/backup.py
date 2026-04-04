"""
Backup & Restore router.
GET  /api/backup/export  — download full JSON backup (admin only)
POST /api/backup/import  — restore from JSON backup (admin only, destructive)

Note: encryption keys are never included in backups. If encryption is enabled,
password fields are exported as ciphertext. Restoring on a different instance
(with a different passphrase) will leave those fields unreadable.
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from services.auth import require_admin
from models.system_settings import SystemSettings
from models.network import Network
from models.device_type import DeviceType
from models.device import Device
from models.nic import Nic
from models.switch_port import SwitchPort
from models.location import Location
from models.user import User

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
            "system_name": sys.system_name if sys else "MyNet",
            "auth_required": sys.auth_required if sys else True,
            # encryption fields intentionally excluded — keys never leave the server
        },
        "users":         [_row_to_dict(r, ts) for r in db.query(User).order_by(User.id).all()],
        "networks":      [_row_to_dict(r, ts) for r in db.query(Network).order_by(Network.id).all()],
        "device_types":  [_row_to_dict(r, ts) for r in db.query(DeviceType).order_by(DeviceType.id).all()],
        "locations":     [_row_to_dict(r) for r in db.query(Location).order_by(Location.id).all()],
        "devices":       [_row_to_dict(r, ts) for r in db.query(Device).order_by(Device.id).all()],
        "nics":          [_row_to_dict(r, ts) for r in db.query(Nic).order_by(Nic.id).all()],
        "switch_ports":  [_row_to_dict(r) for r in db.query(SwitchPort).order_by(SwitchPort.id).all()],
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
        for row in rows:
            db.execute(model.__table__.insert(), {k: v for k, v in row.items() if k in cols})

    _insert_rows(User,               data.get("users",         []))
    _insert_rows(Network,            data.get("networks",      []))
    _insert_rows(DeviceType,         data.get("device_types",  []))
    _insert_rows(Location,           data.get("locations",     []))
    _insert_rows(Device,             data.get("devices",       []))
    _insert_rows(Nic,                data.get("nics",          []))
    _insert_rows(SwitchPort,         data.get("switch_ports",  []))

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

    db.commit()

    return {
        "users":         len(data.get("users",         [])),
        "networks":      len(data.get("networks",      [])),
        "device_types":  len(data.get("device_types",  [])),
        "locations":     len(data.get("locations",     [])),
        "devices":       len(data.get("devices",       [])),
        "nics":          len(data.get("nics",          [])),
        "switch_ports":  len(data.get("switch_ports",  [])),
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
        raise HTTPException(status_code=500, detail=f"Restore failed: {exc}")

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
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")

    # Warn if the backup came from an older version that had a fernet_key
    had_old_key = bool(data.get("fernet_key"))

    return {
        "success": True,
        "had_old_encryption_key": had_old_key,
        "restored": counts,
    }
