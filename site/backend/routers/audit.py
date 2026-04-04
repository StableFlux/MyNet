from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.audit import AuditLog
from models.user import User
from services.auth import require_viewer

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
def list_audit(
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    q = db.query(AuditLog)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    if action:
        q = q.filter(AuditLog.action == action)

    total = q.count()
    entries = q.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "entries": [
            {
                "id": e.id,
                "entity_type": e.entity_type,
                "entity_id": e.entity_id,
                "entity_name": e.entity_name,
                "action": e.action.value,
                "changed_fields": e.changed_fields,
                "old_values": e.old_values,
                "new_values": e.new_values,
                "username": e.username,
                "timestamp": e.timestamp.isoformat(),
            }
            for e in entries
        ],
    }
