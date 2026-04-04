from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from database import get_db
from models.alert import Alert
from models.user import User
from services.auth import require_viewer, require_editor

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
def list_alerts(
    acknowledged: bool | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    q = db.query(Alert)
    if acknowledged is False:
        q = q.filter(Alert.acknowledged_at.is_(None))
    elif acknowledged is True:
        q = q.filter(Alert.acknowledged_at.isnot(None))
    alerts = q.order_by(Alert.created_at.desc()).limit(100).all()
    return [
        {
            "id": a.id,
            "alert_type": a.alert_type.value,
            "device_id": a.device_id,
            "message": a.message,
            "severity": a.severity.value,
            "created_at": a.created_at.isoformat(),
            "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
        }
        for a in alerts
    ]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    count = db.query(Alert).filter(Alert.acknowledged_at.is_(None)).count()
    return {"count": count}


@router.post("/{alert_id}/acknowledge")
def acknowledge(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    alert.acknowledged_at = datetime.now(timezone.utc)
    alert.acknowledged_by = current_user.id
    db.commit()
    return {"acknowledged": True}


@router.post("/acknowledge-all")
def acknowledge_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    now = datetime.now(timezone.utc)
    db.query(Alert).filter(Alert.acknowledged_at.is_(None)).update(
        {"acknowledged_at": now, "acknowledged_by": current_user.id}
    )
    db.commit()
    return {"acknowledged": True}
