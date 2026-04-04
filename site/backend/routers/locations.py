from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from typing import Optional

from database import get_db
from models.location import Location
from models.device import Device, DeviceStatus
from models.user import User
from services.auth import require_viewer, require_editor

router = APIRouter(prefix="/api/locations", tags=["locations"])

PERMANENT_NAMES = {'storage'}


class LocationIn(BaseModel):
    name: str
    type: Optional[str] = None
    parent_id: Optional[int] = None


def _build_tree(locs: list[Location], counts: dict) -> list[dict]:
    by_id = {
        loc.id: {
            "id": loc.id, "name": loc.name, "type": loc.type,
            "parent_id": loc.parent_id,
            "device_count": counts.get(loc.name, 0),
            "is_permanent": loc.name.lower() in PERMANENT_NAMES,
            "children": [],
        }
        for loc in locs
    }
    roots = []
    for node in by_id.values():
        pid = node["parent_id"]
        if pid and pid in by_id:
            by_id[pid]["children"].append(node)
        else:
            roots.append(node)

    def sort_tree(nodes):
        nodes.sort(key=lambda n: n["name"])
        for n in nodes:
            sort_tree(n["children"])

    def rollup(nodes):
        for node in nodes:
            rollup(node["children"])
            node["device_count"] += sum(c["device_count"] for c in node["children"])

    sort_tree(roots)
    rollup(roots)
    return roots


def _flat(locs: list[Location], counts: dict) -> list[dict]:
    return [
        {"id": loc.id, "name": loc.name, "type": loc.type,
         "parent_id": loc.parent_id, "device_count": counts.get(loc.name, 0)}
        for loc in sorted(locs, key=lambda loc: loc.name)
    ]


@router.get("")
def list_locations(flat: bool = False, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    # Deployed (in_service) devices counted by their operational location
    deployed_counts = dict(
        db.query(Device.location, func.count(Device.id))
        .filter(Device.location != None, Device.status == DeviceStatus.in_service)
        .group_by(Device.location)
        .all()
    )
    # Stock / undeployed items counted by their storage location
    storage_counts = dict(
        db.query(Device.storage_location, func.count(Device.id))
        .filter(Device.storage_location != None)
        .group_by(Device.storage_location)
        .all()
    )
    counts: dict = {}
    for name, cnt in deployed_counts.items():
        counts[name] = counts.get(name, 0) + cnt
    for name, cnt in storage_counts.items():
        counts[name] = counts.get(name, 0) + cnt
    locs = db.query(Location).all()
    return _flat(locs, counts) if flat else _build_tree(locs, counts)


@router.get("/types")
def list_types(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    """Returns the distinct user-defined type labels."""
    rows = db.query(Location.type).filter(Location.type != None, Location.type != "").distinct().all()
    return sorted(set(r[0] for r in rows))


@router.post("", status_code=201)
def create_location(body: LocationIn, db: Session = Depends(get_db), _: User = Depends(require_editor)):
    if body.parent_id and not db.get(Location, body.parent_id):
        raise HTTPException(404, "Parent location not found")
    loc = Location(name=body.name, type=body.type or None, parent_id=body.parent_id)
    db.add(loc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, f'A location named "{body.name}" already exists in this container')
    db.refresh(loc)
    return {"id": loc.id, "name": loc.name, "type": loc.type, "parent_id": loc.parent_id, "device_count": 0, "children": []}


@router.put("/{location_id}")
def update_location(location_id: int, body: LocationIn, db: Session = Depends(get_db), _: User = Depends(require_editor)):
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    if body.parent_id:
        if body.parent_id == location_id:
            raise HTTPException(400, "A location cannot be its own parent")
        if not db.get(Location, body.parent_id):
            raise HTTPException(404, "Parent location not found")
    old_name = loc.name
    loc.name = body.name
    loc.type = body.type or None
    loc.parent_id = body.parent_id
    # Cascade rename to all devices linked by location_id
    if old_name != loc.name:
        db.query(Device).filter(Device.location_id == location_id).update(
            {"location": loc.name}, synchronize_session=False
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, f'A location named "{body.name}" already exists in this container')
    db.refresh(loc)
    counts = dict(db.query(Device.location, func.count(Device.id)).filter(Device.location == loc.name).group_by(Device.location).all())
    return {"id": loc.id, "name": loc.name, "type": loc.type, "parent_id": loc.parent_id, "device_count": counts.get(loc.name, 0), "children": []}


@router.delete("/{location_id}", status_code=204)
def delete_location(location_id: int, db: Session = Depends(get_db), _: User = Depends(require_editor)):
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    if loc.name.lower() in PERMANENT_NAMES:
        raise HTTPException(400, f'"{loc.name}" is a permanent location and cannot be deleted')

    # Collect all descendant IDs recursively, then delete bottom-up.
    def collect_descendants(parent_id: int) -> list[int]:
        ids = []
        children = db.query(Location.id).filter(Location.parent_id == parent_id).all()
        for (child_id,) in children:
            ids.extend(collect_descendants(child_id))
            ids.append(child_id)
        return ids

    to_delete = collect_descendants(location_id) + [location_id]
    db.query(Location).filter(Location.id.in_(to_delete)).delete(synchronize_session="fetch")
    db.commit()
