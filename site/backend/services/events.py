"""
Unified event logging service.

Replaces both services/audit.py (AuditLog) and direct Alert creation.

Usage:
    from services.events import log_event, EventSeverity, EventCategory, EventType
    log_event(db, EventType.device_created, entity_type="device", entity_id=device.id,
              entity_name=device.name, username=user.username, user_id=user.id,
              detail={"name": device.name})
"""
import logging
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.orm import Session

from models.event import Event, EventSeverity, EventCategory, EventType

log = logging.getLogger(__name__)

# Map event_type → (severity, category) so callers don't need to specify both
_TYPE_META: dict[EventType, tuple[EventSeverity, EventCategory]] = {
    # Device
    EventType.device_created:          (EventSeverity.info,     EventCategory.device),
    EventType.device_updated:          (EventSeverity.info,     EventCategory.device),
    EventType.device_deleted:          (EventSeverity.info,     EventCategory.device),
    EventType.device_deployed:         (EventSeverity.info,     EventCategory.device),
    EventType.device_imported:         (EventSeverity.info,     EventCategory.device),
    # Network
    EventType.network_created:         (EventSeverity.info,     EventCategory.network),
    EventType.network_updated:         (EventSeverity.info,     EventCategory.network),
    EventType.network_deleted:         (EventSeverity.info,     EventCategory.network),
    # Monitoring
    EventType.device_offline:          (EventSeverity.critical, EventCategory.monitoring),
    EventType.device_recovered:        (EventSeverity.info,     EventCategory.monitoring),
    EventType.wan_offline:             (EventSeverity.critical, EventCategory.monitoring),
    EventType.wan_recovered:           (EventSeverity.info,     EventCategory.monitoring),
    # Conflict
    EventType.ip_conflict:             (EventSeverity.critical, EventCategory.conflict),
    EventType.ip_conflict_resolved:    (EventSeverity.info,     EventCategory.conflict),
    EventType.ip_out_of_subnet:        (EventSeverity.warning,  EventCategory.conflict),
    EventType.mac_conflict:            (EventSeverity.warning,  EventCategory.conflict),
    EventType.mac_conflict_resolved:   (EventSeverity.info,     EventCategory.conflict),
    EventType.mac_conflict_suppressed: (EventSeverity.info,     EventCategory.conflict),
    # Security
    EventType.user_login:              (EventSeverity.system,   EventCategory.security),
    EventType.user_login_failed:       (EventSeverity.warning,  EventCategory.security),
    EventType.user_created:            (EventSeverity.info,     EventCategory.security),
    EventType.user_deleted:            (EventSeverity.info,     EventCategory.security),
    # System
    EventType.system_startup:          (EventSeverity.system,   EventCategory.system),
    EventType.backup_created:          (EventSeverity.system,   EventCategory.system),
    EventType.backup_restored:         (EventSeverity.info,     EventCategory.system),
}

# Event types that are point-in-time — resolved immediately on creation
_POINT_IN_TIME = {
    EventType.device_created, EventType.device_updated, EventType.device_deleted,
    EventType.device_deployed, EventType.device_imported,
    EventType.network_created, EventType.network_updated, EventType.network_deleted,
    EventType.device_recovered,
    EventType.wan_recovered,
    EventType.ip_conflict_resolved, EventType.mac_conflict_resolved,
    EventType.mac_conflict_suppressed,
    EventType.user_login, EventType.user_login_failed,
    EventType.user_created, EventType.user_deleted,
    EventType.system_startup, EventType.backup_created, EventType.backup_restored,
}


def log_event(
    db: Session,
    event_type: EventType,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    entity_name: str | None = None,
    username: str | None = None,
    user_id: int | None = None,
    detail: dict[str, Any] | None = None,
) -> Event:
    severity, category = _TYPE_META[event_type]
    now = datetime.now(timezone.utc)
    resolved_at = now if event_type in _POINT_IN_TIME else None
    resolved_by = "system" if event_type in _POINT_IN_TIME else None

    event = Event(
        severity=severity,
        category=category,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        message=message,
        detail=detail,
        username=username,
        user_id=user_id,
        resolved_at=resolved_at,
        resolved_by=resolved_by,
    )
    db.add(event)
    return event


def resolve_events(
    db: Session,
    event_type: EventType,
    entity_id: int,
    resolved_by: str = "system",
) -> None:
    """Auto-resolve all active events of a given type for an entity."""
    now = datetime.now(timezone.utc)
    events = (
        db.query(Event)
        .filter(
            Event.event_type == event_type,
            Event.entity_id == entity_id,
            Event.resolved_at.is_(None),
        )
        .all()
    )
    for e in events:
        e.resolved_at = now
        e.resolved_by = resolved_by


def resolve_events_by_type(
    db: Session,
    event_type: EventType,
    resolved_by: str = "system",
    exclude_entity_ids: set[int] | None = None,
) -> None:
    """Auto-resolve all active events of a given type, optionally keeping some active."""
    now = datetime.now(timezone.utc)
    q = db.query(Event).filter(
        Event.event_type == event_type,
        Event.resolved_at.is_(None),
    )
    events = q.all()
    for e in events:
        if exclude_entity_ids and e.entity_id in exclude_entity_ids:
            continue
        e.resolved_at = now
        e.resolved_by = resolved_by
