"""
Audit logging helper — called explicitly from routers on create/update/delete.
"""
from typing import Optional
from sqlalchemy.orm import Session
from models.audit import AuditLog, AuditAction


def log(
    db: Session,
    entity_type: str,
    entity_id: Optional[int],
    entity_name: Optional[str],
    action: AuditAction,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
) -> None:
    changed_fields = None
    if old_values and new_values:
        changed_fields = [k for k in new_values if new_values.get(k) != old_values.get(k)]

    entry = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        action=action,
        changed_fields=changed_fields,
        old_values=old_values,
        new_values=new_values,
        user_id=user_id,
        username=username,
    )
    db.add(entry)
    db.flush()
