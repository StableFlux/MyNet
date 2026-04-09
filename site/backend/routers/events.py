"""
Unified events endpoint — replaces both /api/alerts and /api/audit.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from typing import Optional

from database import get_db
from models.event import Event, EventSeverity, EventCategory, EventType
from models.user import User
from services.auth import require_viewer, require_editor

router = APIRouter(prefix="/api/events", tags=["events"])


def _event_out(e: Event) -> dict:
    return {
        "id": e.id,
        "severity": e.severity.value,
        "category": e.category.value,
        "event_type": e.event_type.value,
        "entity_type": e.entity_type,
        "entity_id": e.entity_id,
        "entity_name": e.entity_name,
        "message": e.message,
        "detail": e.detail,
        "username": e.username,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "resolved_at": e.resolved_at.isoformat() if e.resolved_at else None,
        "resolved_by": e.resolved_by,
        "acknowledged_at": e.acknowledged_at.isoformat() if e.acknowledged_at else None,
        "is_active": e.resolved_at is None,
    }


@router.get("")
def list_events(
    severity: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[int] = Query(None),
    active_only: bool = Query(False),
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    q = db.query(Event)

    if severity:
        try:
            q = q.filter(Event.severity == EventSeverity(severity))
        except ValueError:
            pass
    if category:
        try:
            q = q.filter(Event.category == EventCategory(category))
        except ValueError:
            pass
    if entity_type:
        q = q.filter(Event.entity_type == entity_type)
    if entity_id:
        q = q.filter(Event.entity_id == entity_id)
    if active_only:
        q = q.filter(Event.resolved_at.is_(None))
    if search:
        q = q.filter(Event.message.ilike(f"%{search}%"))

    total = q.count()
    events = q.order_by(Event.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [_event_out(e) for e in events],
    }


@router.get("/active-count")
def active_count(
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    """Count of unresolved warning/critical events — used by AlertBell."""
    count = (
        db.query(Event)
        .filter(
            Event.resolved_at.is_(None),
            Event.severity.in_([EventSeverity.warning, EventSeverity.critical]),
        )
        .count()
    )
    return {"count": count}


@router.post("/{event_id}/acknowledge")
def acknowledge_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    now = datetime.now(timezone.utc)
    event.acknowledged_at = now
    event.acknowledged_by = current_user.id
    # Acknowledging also resolves it
    if not event.resolved_at:
        event.resolved_at = now
        event.resolved_by = current_user.username
    db.commit()
    return {"acknowledged": True}


@router.post("/acknowledge-all")
def acknowledge_all(
    severity: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    now = datetime.now(timezone.utc)
    q = db.query(Event).filter(Event.resolved_at.is_(None))
    if severity:
        try:
            q = q.filter(Event.severity == EventSeverity(severity))
        except ValueError:
            pass
    q.update(
        {"resolved_at": now, "resolved_by": current_user.username,
         "acknowledged_at": now, "acknowledged_by": current_user.id},
        synchronize_session=False,
    )
    db.commit()
    return {"acknowledged": True}
