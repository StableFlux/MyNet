from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.device_type import DeviceType
from models.user import User
from models.event import EventType
from services.auth import require_editor, require_viewer
from services.events import log_event

router = APIRouter(prefix="/api/device-types", tags=["device-types"])


class DeviceTypeIn(BaseModel):
    name: str
    category: Optional[str] = None
    icon: Optional[str] = None
    color: str = "#64748b"
    fields_schema: dict = {}


class DeviceTypeOut(DeviceTypeIn):
    id: int
    is_system: bool
    class Config:
        from_attributes = True


@router.get("", response_model=list[DeviceTypeOut])
def list_device_types(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return db.query(DeviceType).order_by(DeviceType.name).all()


@router.post("", response_model=DeviceTypeOut, status_code=201)
def create_device_type(
    body: DeviceTypeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    dt = DeviceType(**body.model_dump(), is_system=False)
    db.add(dt)
    db.flush()
    log_event(db, EventType.device_updated, f"Device type '{dt.name}' created",
              entity_type="device_type", entity_id=dt.id, entity_name=dt.name,
              username=current_user.username, user_id=current_user.id)
    db.commit()
    db.refresh(dt)
    return dt


@router.put("/{dt_id}", response_model=DeviceTypeOut)
def update_device_type(
    dt_id: int,
    body: DeviceTypeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    dt = db.get(DeviceType, dt_id)
    if not dt:
        raise HTTPException(404, "Device type not found")
    for k, v in body.model_dump().items():
        setattr(dt, k, v)
    log_event(db, EventType.device_updated, f"Device type '{dt.name}' updated",
              entity_type="device_type", entity_id=dt.id, entity_name=dt.name,
              username=current_user.username, user_id=current_user.id)
    db.commit()
    db.refresh(dt)
    return dt


@router.delete("/{dt_id}", status_code=204)
def delete_device_type(
    dt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_editor),
):
    dt = db.get(DeviceType, dt_id)
    if not dt:
        raise HTTPException(404, "Device type not found")
    if dt.is_system:
        raise HTTPException(400, "Cannot delete system device types")
    # Null out references on any devices using this type
    from models.device import Device
    db.query(Device).filter(Device.device_type_id == dt_id).update(
        {"device_type_id": None}, synchronize_session=False
    )
    log_event(db, EventType.device_updated, f"Device type '{dt.name}' deleted",
              entity_type="device_type", entity_id=dt.id, entity_name=dt.name,
              username=current_user.username, user_id=current_user.id)
    db.delete(dt)
    db.commit()
